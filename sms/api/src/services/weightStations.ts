/**
 * The station table — the one station ranking in the whole application.
 *
 * The audit found three separate screens ranking the same fourteen stations:
 * Weight's spread table, the calibration drift table, and Rejects "by station",
 * each with its own verdict. IFL's representative called that out as the
 * residue of the duplication they complained about. This is the single answer,
 * and Rejects links into it rather than growing a fourth.
 *
 * WHAT IT REPORTS, AND WHY EACH FIGURE IS THERE:
 *
 *  - vs LINE and vs TARGET, both, always. The old table gave only "difference
 *    from the line", which reads "Fine" for all fourteen stations on a line
 *    that is twelve grams heavy everywhere — the exact case a process engineer
 *    most needs to see.
 *
 *    ONE POPULATION PER ROW (friction audit F4, 23 Sep 2026). `meanG`,
 *    `medianG`, `sdG`, `n`, `vsLineG` and `vsTargetG` are ALL computed over
 *    the whole window. They are printed side by side and an engineer
 *    subtracts one from another without being told not to, so they must
 *    reconcile. Before this they did not: the two signed columns were
 *    computed over the recent drift RUN, and on real data (epoch 9, 5 Aug -
 *    7 Sep) five of fourteen rows carried a `vs line` whose sign contradicted
 *    their own `Mean`. The run figure is still reported — `runMeanG` /
 *    `runVsLineG`, under its own name, beside `daysHeld` which states the
 *    run's length — and it is still what `flagged` and `projection` are
 *    computed from, because those are claims about a recent run and say so.
 *  - MEDIAN and SD beside the mean (roadmap Phase 9 items 1 and 2, 15 Sep
 *    2026). The SD was computed all along and rendered nowhere; the median
 *    was computed nowhere. A station whose mean and median disagree has a
 *    skewed day, not a biased scale, and the SD says how tight the scale
 *    reads regardless of where it sits.
 *  - DAYS HELD, counted over the run the figure describes, not the window.
 *  - REJECT RATE per station, so the cross-reference ("high rejects AND a
 *    weight bias — look here first") lives in the same row.
 *  - LAST ADJUSTED, because a recommendation with no record of what was
 *    already done about it is one an engineer cannot act on.
 *  - A PROJECTION for a flagged station (Phase 9 item 6): the straight line
 *    through its run's daily means, extended to the product's limit — "at
 *    N g/day over D days, reaches the limit in about K days". It is a
 *    projection from recent readings under a stated linear assumption, not a
 *    prediction, and it is only offered when a product with limits was in
 *    force. The screen prints the assumption beside it.
 *
 * WHAT IT DELIBERATELY DOES NOT REPORT: grams to adjust by. Weighing data
 * cannot tell a scale that reads nine grams heavy from cones that genuinely
 * are nine grams heavy, and those two need opposite actions. The row states
 * what was measured, projects the measured trend, and stops.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import {
  adjustmentRestarts, getStationDrift, latestRestart, listCalibrationAdjustments, projectDaysToLimit,
  type DriftProjection, type StationDriftDay,
} from './calibration.js';
import type { NelsonRuleInfo } from './nelson.js';
import { getPlausibilityRule, type PlausibilityRule } from './admin.js';
import { loadProductTimeline, limitsOf } from './productAt.js';
import { loadProductCatalogue } from './productLimits.js';
import { plausibleWhere } from './coneState.js';
// The §8 rule's ONE resolver (friction audit F6, 23 Sep 2026). It lives under
// `reports/` because reports were the first consumer, not because it is
// report-specific: it is a pure decision about whether a limits version may
// be used to judge a period at all, and this service is where that question
// is asked FIRST — the reports below compose their station rows from here.
// The import direction is safe: reports/common.ts imports no service, only
// `@sms/shared` types and its own arithmetic, so there is no cycle.
import { resolvePeriodTarget } from './reports/common.js';
import { driftThresholdG, MIN_DAYS_HELD } from './attention.js';
import { consecutiveProductionDays } from './plantClock.js';
import { getUnmatchedRejects } from './rejects.js';
// WS-A1 (23 Sep 2026, red-team remediation): this file's own reject-rate
// queries — rejectRatesByStation's per-station/totals SQL and
// stationMaterialCounts — read sms.cone_event/sms.reject_event with NO
// generation predicate at all, so a window spanning IFL's 2026-08-05 table
// rebuild (or, on this dev copy, the plant simulator's overlapping
// DATA_TP1U2_SIM generation) pools two physical generations of a table whose
// identities both start at 1. Each function resolves ITS OWN scope —
// generation.ts's file header explains why that is safe: keyed on
// (lineId, from, to) only, so two independent resolves over the same window
// are guaranteed to agree — rather than threading one scope object through
// this file's signatures.
import { andEpoch, epochWhere, noteOf, resolveGenerationScope, type GenerationNote } from './generation.js';

/**
 * Group key for unmatched rejects that carry no station id. A literal that
 * can never collide with `CAST(source_station AS varchar(12))`, which is
 * only ever digits or a minus sign.
 */
const NO_STATION = '__no_station__';

export interface WeightStationRow {
  station: number;
  /** Cones weighed at this station in the window. */
  n: number;
  meanG: number;
  /** Median of the same population as meanG (Phase 9). */
  medianG: number | null;
  /** Within-day standard deviation of the station's cone weights, pooled over the window (Phase 9). */
  sdG: number;
  /**
   * Signed grams against the line's own mean, over THE SAME POPULATION AS
   * `meanG` — the whole window. `meanG - lineMeanG` to within rounding, and
   * a test (`weightStations.basis.test.ts`) fails if it ever stops being.
   *
   * FRICTION AUDIT F4, 23 Sep 2026 — this used to be computed from `runMean`,
   * the mean over the station's most recent consecutive-drift run (`daysHeld`
   * days: 1, 2, 3, 7, 15 in the Aug-Sep period), while the `Mean` column
   * printed beside it was the period mean. Two populations, adjacent columns,
   * nothing saying so — and on real data (epoch 9, 5 Aug - 7 Sep) they
   * disagreed in SIGN on five of fourteen stations. Station 11 printed
   * `Mean 1950.4 g` against a line mean of `1951.5 g` and `vs line +1.2 g`:
   * the row said the station read heavy while its own mean said it read
   * light. On the calibration table, whose whole purpose is to say which
   * scale is off and in which direction, that is worse than printing no
   * column at all.
   *
   * The run mean is not discarded — it is a genuinely different and useful
   * quantity, and it survives under its own name as `runVsLineG` below, and
   * as the basis of `flagged` and `projection`, which are about a RECENT RUN
   * and are labelled as such by `daysHeld`. What it may not do is sit
   * unlabelled next to a period figure.
   */
  vsLineG: number;
  /**
   * Signed grams against this row's own target (see `targetBasis`) — null
   * when no target could be resolved, when the station ran more than one
   * material in the window and there is therefore no single target to be
   * signed against, or when the only limits version on record for that
   * material BEGINS AFTER the window ended (`targetAfterWindowEnd`).
   *
   * THE THIRD CASE, AND WHY IT WITHHOLDS RATHER THAN FLAGS (F6, 23 Sep 2026).
   * `29f4e70` added `targetAfterWindowEnd` and left the number in place,
   * leaving the decision to each consumer. `71ac170` had already made the
   * opposite choice for the reports, through `resolvePeriodTarget`. On real
   * data (epoch 9, 5-20 Aug) those two choices collided ON ONE PAGE: Report ›
   * Cone weight printed "No target is stated: the earliest limits this system
   * holds for that product were first recorded on 2026-09-11, after this
   * period ended on 2026-08-20" at the top, and seven stations' `vs target`
   * numbers (-14.2 g, -12.52 g, -12.4 g, -11.66 g …) in the table beneath it,
   * judged against those very limits. A reader comparing the two halves
   * concludes either that the caption is boilerplate or that the numbers are
   * authoritative. Both conclusions are wrong.
   *
   * Withholding wins on three counts, not one:
   *  - THE READER. The refusal is a sentence a manager can act on; a column
   *    of numbers under it is a contradiction they cannot resolve.
   *  - THIS FILE'S OWN PRECEDENT. `targetBasis: 'mixed'` already returns null
   *    here, for the weaker reason that the target is AMBIGUOUS between two
   *    products. A target that did not yet exist is a stronger reason to
   *    withhold than one that is merely ambiguous.
   *  - THE COST OF THE ALTERNATIVE, counted. Five render sites consume
   *    `vsTargetG` (report/Calibration.tsx:101, report/ConeWeight.tsx:76,
   *    report/Station.tsx:86, StationSheet.tsx:227, Weight.tsx:1026) plus
   *    three CSV writers. Every one of them ALREADY handles null — the
   *    'mixed' path proves it, and epoch 1 exercises it on real data. NONE of
   *    them handles the flags. Flagging is eight edits in three owners'
   *    files, any one of which restates F6 by omission; withholding is zero.
   *
   * What is NOT lost: `targetIsLowerBound` and `targetAfterWindowEnd` stay on
   * the row, and `WeightStationsData.targetOmittedReason` states the reason
   * in words, so the column is blank WITH an explanation rather than blank.
   *
   * Same population as `meanG` and `vsLineG` (F4): `meanG - targetG`. The
   * Weight screen's `lineOffsetSentence` already assumed exactly this — it
   * derives each station's implied target as `meanG - vsTargetG` and refuses
   * to speak when they disagree (`web/src/screens/Weight.tsx:629`), so the
   * run basis was silently poisoning that check too.
   */
  vsTargetG: number | null;
  /**
   * THE RUN BASIS, NAMED (F4). The mean over the most recent consecutive run
   * of production days on one side of the line — `daysHeld` days long, the
   * population the pattern test and the projection are computed over. Null
   * when there is no run (no days after the last logged adjustment, or no
   * line mean to take a side against).
   *
   * This is the more sensitive figure for "where does this scale sit NOW",
   * and the less representative one for "what did this station weigh over
   * the period". Both are true; neither may be printed as the other. A
   * consumer that shows `runVsLineG` must also show `daysHeld` beside it, or
   * it has reintroduced F4 under a new name.
   */
  runMeanG: number | null;
  /** `runMeanG - lineMeanG`. Null exactly when `runMeanG` is. See `runMeanG`. */
  runVsLineG: number | null;
  /**
   * Where this row's target came from (roadmap Phase 9 item 4 / UX Phase 5
   * Brief 1, 16 Sep 2026): up to six materials can run concurrently on
   * different machines (Sep 2026 data), so the line-wide target used to be
   * applied to every station regardless of what it actually ran.
   *  - 'station_material': this station ran exactly one material_id in the
   *    window; the target is THAT material's own limits, in force at the
   *    window's end — never the line-wide product.
   *  - 'mixed': this station ran more than one material_id in the window.
   *    There is no single honest target, so `vsTargetG` is null and
   *    `materialsInWindow` says how many it ran instead of a number that
   *    would silently average two different products' tolerances.
   *  - 'line_product': every reading at this station carries no material_id
   *    (the July generation predates the column). Falls back to the
   *    line-wide Current Product timeline, exactly as coneState.ts does for
   *    the same readings.
   */
  targetBasis: 'station_material' | 'mixed' | 'line_product';
  /** Only set when `targetBasis` is 'mixed' — how many distinct materials this station ran in the window. */
  materialsInWindow?: number;
  /**
   * F6 (23 Sep 2026), the row-level half of the same defect as
   * `WeightStationsData.targetEffectiveIsLowerBound`: this row's target came
   * from a limits version that the app merely OBSERVED already in place, so
   * its instant means NO LATER THAN, not exactly then. False when the version
   * is dated, or when there is no target at all.
   */
  targetIsLowerBound: boolean;
  /**
   * F6: this row's target version's effective instant falls AFTER the
   * window's end — limits that demonstrably did not exist while these
   * readings were taken.
   *
   * REVISED 23 Sep 2026: `vsTargetG` is now NULL whenever this is true — the
   * service withholds the number itself rather than leaving each consumer to
   * remember. See `vsTargetG` for the evidence behind that choice. This flag
   * remains, and is no longer gated on the number's presence, because it is
   * the REASON the column is blank and a consumer needs to be able to say so.
   */
  targetAfterWindowEnd: boolean;
  /** Consecutive most-recent production days on the same side of the line. */
  daysHeld: number;
  /** The pattern test fired inside that run. */
  flagged: boolean;
  rejectRatePct: number | null;
  lastAdjustedUtc: string | null;
  /** Production day the pattern test restarted from (a logged adjustment inside the window), or null. */
  restartedOn: string | null;
  /** The centreline the pattern test measured this station's days from (see calibration.ts). */
  centrelineG: number;
  /** Day-to-day sigma of the daily mean, the width the pattern zones used. */
  sigmaDayToDay: number;
  /** Longest calendar-contiguous run of days the pattern rules had; rules needing more can never have fired. */
  longestRun: number;
  /** Only for a flagged station with product limits in force; see calibration.ts. */
  projection: DriftProjection | null;
  /** Daily means, for the station sheet's trend. */
  days: StationDriftDay[];
}

export interface WeightStationsData {
  from: string;
  to: string;
  /** Production days actually holding data in the window. */
  days: number;
  lineMeanG: number | null;
  /**
   * The line-wide target for THIS PERIOD, or null when none may be stated.
   *
   * Null in two cases now: no product was in force at the window's end (as
   * before), and — F6, 23 Sep 2026 — the product's only limits version begins
   * after the window ended, in which case `targetOmittedReason` says so in
   * words. Every consumer of this field already had a written "no target
   * recorded" branch (`W.reports.noTarget`, `W.weight.headlineNoTarget`,
   * `W.weight.sortNoteNoTarget`), and epoch 1 exercises that branch on real
   * data, so the second case reuses a path that was already live rather than
   * introducing one.
   */
  targetG: number | null;
  /**
   * The product's limits as RECORDED — the edges the projection extends to
   * and the width `driftThresholdG` scales itself from.
   *
   * DELIBERATELY NOT WITHHELD alongside `targetG` (F6, 23 Sep 2026), because
   * the two answer different questions. `targetG` answers "what should these
   * readings have weighed?", which is a claim ABOUT THE PERIOD and cannot be
   * made from limits recorded after it. `limits` answers "where are the edges
   * this station's current drift is heading for?", which is a claim about the
   * FUTURE, and for that the limits now on record are the right ones. Keeping
   * it also means `thresholdG`, `flagged`, the attention list and every guard
   * built on them are untouched by the withholding above.
   */
  limits: { loG: number; hiG: number } | null;
  productId: number | null;
  productLabel: string | null;
  /**
   * When the line-wide target (above) was last recorded — the same instant
   * convention as spc.ts's `limitsEffectiveFromUtc` — so a consumer (the
   * cone-weight report, UX Phase 5 Brief 1) can print a version qualifier
   * beside the figure instead of a bare number.
   */
  targetEffectiveFromUtc: string | null;
  /**
   * FRICTION AUDIT F6, 23 Sep 2026 — `ProductCatalogue.versionAt` is already
   * honest: when NO version began at or before the asked-for instant it
   * returns the nearest one and marks it `effectiveIsLowerBound: true`. This
   * service read `.effectiveFromUtc` off that result and DROPPED the flag, so
   * `targetEffectiveFromUtc` reached three report types as a bare instant and
   * was printed under captions promising "in force at the end of this
   * period". Carried through at last.
   *
   * True means `targetEffectiveFromUtc` is a LOWER BOUND — the limits were in
   * place NO LATER THAN that instant, and may have been in place long before.
   * Product › Catalogue already renders exactly this case as "no later than
   * …" (`web/src/screens/product/ProductLimitsBlock.tsx:137`); a consumer
   * printing this instant without the qualifier is restating F6.
   */
  targetEffectiveIsLowerBound: boolean;
  /**
   * F6's demonstrated case, separated from the one above because they are not
   * the same claim. True when the resolved version's effective instant falls
   * AFTER the window's end: limits that demonstrably did not exist while the
   * readings were taken. Observed on the dev copy for the period
   * 2026-08-05 → 2026-09-07, whose only version for product 12 begins
   * 2026-09-11 — four days after the period ended.
   *
   * REVISED 23 Sep 2026: withholding is NO LONGER the consumer's call. It was
   * made here, once, because leaving it to the consumer produced exactly the
   * disagreement it was meant to avoid — see `WeightStationRow.vsTargetG`.
   * When this is true, `targetG` and every row's `vsTargetG` are null and
   * `targetOmittedReason` carries the sentence to print instead.
   */
  targetEffectiveAfterWindowEnd: boolean;
  /**
   * WHY no target is stated, in words fit to print, from the one resolver
   * (`reports/common.ts`'s `resolvePeriodTarget`) — so every surface that
   * blanks a target for this reason gives the SAME reason, and none of them
   * has to compose the sentence itself.
   *
   * Null when a target IS stated, and null for the ordinary "no product was
   * in force" case, which needs no explanation beyond itself.
   */
  targetOmittedReason: string | null;
  /** How many station rows had their `vsTargetG` withheld for that reason — so a caption can say how much of the column is blank and why. */
  stationsWithTargetWithheld: number;
  /**
   * How many times the line-wide product's OWN limits changed inside the
   * window — a version that BEGAN inside `[from, to]`, mirroring spc.ts's
   * getSpec (:218-231): the version in force at the window's end is not
   * itself "a change inside the window" unless it also began inside it.
   * Null when there is no line-wide product at all (nothing to have changed).
   */
  limitsChangedInWindow: number | null;
  /**
   * How many times the line-wide Current Product ITSELF changed inside the
   * window (a new product_timeline entry, not just a limits revision on the
   * same product) — the qualifier the chart already implies but the table
   * never printed.
   */
  productChangesInWindow: number;
  /** How far from the line a station must sit to be worth acting on. */
  thresholdG: number;
  minDaysHeld: number;
  lineRejectRatePct: number | null;
  stations: WeightStationRow[];
  /** The pattern rules, with the run length each needs, for naming a flag and stating which could not fire. */
  rules: NelsonRuleInfo[];
  /**
   * WS-A1 (23 Sep 2026): which source generation `lineRejectRatePct`, every
   * station's `rejectRatePct` and `targetBasis: 'station_material'` counts
   * were confined to, and what was left out — `rejectRatesByStation`'s own
   * resolve. `stationMaterialCounts` resolves the SAME generation
   * independently (generation.ts's guarantee: keyed on (lineId, from, to)
   * only), so one note describes both.
   */
  generationNote: GenerationNote;
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export async function getWeightStations(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
): Promise<WeightStationsData> {
  // T3 (15 Sep 2026): bound the ledger fetch to `{ to }`, never `from`. This
  // used to call listCalibrationAdjustments with no window filter at all, so
  // TOP (500) ORDER BY adjusted_at_utc DESC returned the newest 500
  // adjustments on the LINE — whatever period this function is reporting. An
  // adjustment logged AFTER `to` (an August report run after a September
  // recalibration) then became `latestRestart`'s answer below, and the days
  // filter at line ~156 dropped EVERY day of the window for every station: an
  // August report read "0 days held" for all fourteen stations, and
  // reports/summary.ts's prior-period comparison inherited the same
  // fabricated zero. An adjustment AT OR BEFORE `to` is still the correct
  // restart marker (that is the whole point of the ledger), so only `to` is
  // bound — `from` is deliberately omitted.
  const [plausibility, timeline, adjustments, catalogue] = await Promise.all([
    getPlausibilityRule(pool, lineId),
    loadProductTimeline(pool, lineId),
    listCalibrationAdjustments(pool, lineId, { to }),
    loadProductCatalogue(pool),
  ]);

  // The line-wide target is the product in force at the END of the window:
  // it is what the line is making now, and the table is read to decide what
  // to do next. Its limits come from the versioned history AT that instant,
  // not from the mirror's current values (productLimits.ts). This is now
  // only the FALLBACK target — see `stationTarget` below — for a station
  // whose readings carry no material_id at all (the July generation).
  const startMs = new Date(`${from}T00:00:00Z`).getTime();
  const endMs = new Date(`${to}T23:59:59Z`).getTime();
  const product = timeline.at(endMs);
  const limits = product ? (catalogue.limitsAt(product.productId, endMs) ?? limitsOf(product)) : null;
  // Same rule as spc.ts's getSpec (:218-231): a version in force at the
  // window's end is not itself "a change inside the window" unless it also
  // BEGAN inside it.
  const limitsChangedInWindow = product
    ? catalogue.versionsAscending(product.productId).filter((v) => v.effectiveFromMs > startMs && v.effectiveFromMs <= endMs).length
    : null;
  // F6 (23 Sep 2026), completed 23 Sep 2026: read the VERSION, not just its
  // instant, and put the USABILITY decision through the one shared resolver
  // rather than re-deciding it here. `resolvePeriodTarget` owns exactly one
  // rule — a version that BEGINS after the period ended may not be used to
  // judge that period — and it is the only place that rule is written.
  //
  // The two booleans below describe the VERSION and are deliberately NOT
  // taken from the resolver's own collapsed output: a refused version is
  // still a lower-bound record, and a consumer is entitled to know that.
  // `afterWindowEnd` is nonetheless DERIVED from the resolver's verdict
  // (`v != null && !usable`) rather than re-testing `effectiveFromMs > endMs`
  // a second time, so the comparison lives in one file only.
  const resolveTarget = (productId: number | null) => {
    const v = productId == null ? null : catalogue.versionAt(productId, endMs);
    const t = resolvePeriodTarget(v, endMs, to);
    return {
      usable: t.usable,
      effectiveFromUtc: t.inForceAtUtc,
      isLowerBound: v?.effectiveIsLowerBound === true,
      afterWindowEnd: v != null && !t.usable,
      omittedReason: t.omittedReason,
    };
  };
  const lineTargetProvenance = resolveTarget(product?.productId ?? null);
  const targetEffectiveFromUtc = lineTargetProvenance.effectiveFromUtc;
  // How many times the line-wide Current Product itself changed (a new
  // product_timeline entry), not merely a limits revision on the same product.
  const productChangesInWindow = timeline.entries.filter((e) => e.effectiveFromMs > startMs && e.effectiveFromMs <= endMs).length;

  // Every logged adjustment restarts the station's centreline and sigma as
  // well as its run (calibration.ts header, Phase 9).
  const restarts = adjustmentRestarts(adjustments);

  // stationMaterialCounts runs AFTER the pair above, not alongside them:
  // rejectRatesByStation issues two queries on this same pool in a fixed
  // order that several existing tests pin positionally (fakePool(...
  // responses) helpers in weightStations.test.ts, .window.test.ts,
  // .gap.test.ts, .phase9.test.ts), and running a third query concurrently
  // would race with — and silently steal a response slot from — those two.
  // Sequencing it after keeps their two-response fixtures correct unchanged;
  // a fixture that supplies no third response simply gets an empty
  // recordset here, which resolves to every station falling back to
  // targetBasis 'line_product' — the same target those tests already expect.
  const [drift, rejectStats] = await Promise.all([
    getStationDrift(pool, lineId, from, to, plausibility, { restarts }),
    rejectRatesByStation(pool, lineId, from, to),
  ]);
  const rejects = rejectStats.rates;
  const stationMaterials = await stationMaterialCounts(pool, lineId, from, to, plausibility);
  const generationNote = rejectStats.generationNote;

  const active = drift.stations.filter((s) => s.n > 0);
  const totalN = active.reduce((s, x) => s + x.n, 0);
  const lineMeanG = totalN > 0 ? active.reduce((s, x) => s + x.n * x.grandMean, 0) / totalN : null;
  const thresholdG = driftThresholdG(
    active.map((s) => s.grandMean),
    limits ? limits.hiG - limits.loG : null,
  );

  const lastAdjusted = new Map<number, string>();
  for (const a of adjustments) {
    if (a.stationId == null) continue;
    const prev = lastAdjusted.get(a.stationId);
    if (prev == null || a.adjustedAtUtc > prev) lastAdjusted.set(a.stationId, a.adjustedAtUtc);
  }

  const stations: WeightStationRow[] = active.map((st) => {
    const adjustedAtMs = latestRestart(restarts, st.station);
    // A logged adjustment restarts the station: days before it say nothing
    // about the scale as it stands now.
    const days =
      adjustedAtMs == null
        ? st.days
        : st.days.filter((d) => new Date(`${d.date}T23:59:59Z`).getTime() >= adjustedAtMs);

    let daysHeld = 0;
    let flagged = false;
    let runMean = st.grandMean;
    /** Whether `runMean` is actually a RUN mean, or merely the period mean standing in for one. */
    let runMeanIsRun = false;
    let run: StationDriftDay[] = [];
    if (days.length > 0 && lineMeanG != null) {
      const side = sign(days[days.length - 1]!.mean - lineMeanG);
      for (let i = days.length - 1; i >= 0; i--) {
        if (sign(days[i]!.mean - lineMeanG) !== side) break;
        // A hole in the calendar ends the run as surely as a change of side.
        // `days` holds only days WITH readings, so array neighbours are not
        // calendar neighbours: with the record's gap (10 Jul → 5 Aug, IFL's
        // table rebuild), 2026-07-10 and 2026-08-05 would otherwise count as a
        // two-day run and the screen would say "heavier for 2 days".
        if (i < days.length - 1 && !consecutiveProductionDays(days[i]!.date, days[i + 1]!.date)) break;
        run.unshift(days[i]!);
      }
      daysHeld = run.length;
      const runN = run.reduce((s, d) => s + d.n, 0);
      if (runN > 0) {
        runMean = run.reduce((s, d) => s + d.n * d.mean, 0) / runN;
        runMeanIsRun = true;
      }
      // EXACTLY the rule the attention list uses. When these differed, the
      // table said "3 stations need a look" on a screen whose home page said
      // "Nothing needs attention" — two screens disagreeing about the same
      // question, which is the incoherence this redesign exists to remove.
      flagged =
        run.some((d) => d.nelson.length > 0) &&
        run.length >= MIN_DAYS_HELD &&
        Math.abs(runMean - lineMeanG) >= thresholdG;
    }
    if (!flagged) run = [];

    // Per-station, per-material target (roadmap Phase 9 item 4 / UX Phase 5
    // Brief 1, 16 Sep 2026). See WeightStationRow.targetBasis for the three
    // outcomes. `nonNull` excludes rows with no material_id (July generation)
    // from the "how many materials" count — those are judged by the
    // line-wide fallback below, exactly as coneState.ts's limitWindowsFor
    // does for the same readings.
    const matRows = stationMaterials.get(st.station) ?? [];
    const nonNull = matRows.filter((m) => m.materialId != null);
    const distinctMaterials = [...new Set(nonNull.map((m) => m.materialId!))];
    let targetBasis: WeightStationRow['targetBasis'] = 'line_product';
    let materialsInWindow: number | undefined;
    let stationLimits: { loG: number; hiG: number; targetG: number } | null = limits;
    // F6 (23 Sep 2026): `vsTargetG` is a JUDGEMENT OF THESE READINGS against a
    // target, so it is withheld outright — not merely flagged — when the only
    // limits version on record begins after the window ended. See the
    // `vsTargetG` doc comment for why withholding beat flagging here.
    // F4: signed against `st.grandMean`, the same population `meanG` prints —
    // NEVER `runMean`. See WeightStationRow.vsTargetG.
    // F6: the line-wide fallback's provenance is the line target's own.
    let rowTargetProvenance = lineTargetProvenance;
    let rowVsTargetG: number | null =
      limits == null || !rowTargetProvenance.usable ? null : round(st.grandMean - limits.targetG);
    if (distinctMaterials.length === 1) {
      targetBasis = 'station_material';
      const mLimits = catalogue.limitsAt(distinctMaterials[0]!, endMs);
      stationLimits = mLimits;
      rowTargetProvenance = resolveTarget(distinctMaterials[0]!);
      rowVsTargetG = mLimits == null || !rowTargetProvenance.usable ? null : round(st.grandMean - mLimits.targetG);
    } else if (distinctMaterials.length > 1) {
      targetBasis = 'mixed';
      materialsInWindow = distinctMaterials.length;
      stationLimits = null; // no single target to project toward either
      rowVsTargetG = null; // NO NUMBER — there is no single target, so printing one would be over-claiming.
      // No single target means no single target provenance either.
      rowTargetProvenance = { usable: false, effectiveFromUtc: null, isLowerBound: false, afterWindowEnd: false, omittedReason: null };
    }

    const r = rejects.get(st.station);
    return {
      station: st.station,
      n: st.n,
      meanG: round(st.grandMean),
      medianG: st.medianG == null ? null : round(st.medianG),
      sdG: round(st.stdevWithin ?? 0),
      // F4: `st.grandMean`, the same population `meanG` above prints. The run
      // figure is below, under its own name.
      vsLineG: lineMeanG == null ? 0 : round(st.grandMean - lineMeanG),
      vsTargetG: rowVsTargetG,
      runMeanG: runMeanIsRun ? round(runMean) : null,
      runVsLineG: runMeanIsRun && lineMeanG != null ? round(runMean - lineMeanG) : null,
      targetBasis,
      ...(materialsInWindow != null ? { materialsInWindow } : {}),
      // F6: these describe the VERSION this row resolved, and they are no
      // longer gated on `vsTargetG != null` — under the withholding rule
      // above, `targetAfterWindowEnd` is precisely the reason the number is
      // absent, so gating it on the number's presence would erase the
      // explanation exactly when it is needed. A row with no version at all
      // (no product, or 'mixed') resolves to false on both, as before.
      targetIsLowerBound: rowTargetProvenance.isLowerBound,
      targetAfterWindowEnd: rowTargetProvenance.afterWindowEnd,
      daysHeld,
      flagged,
      rejectRatePct: r == null ? null : round(r, 2),
      lastAdjustedUtc: lastAdjusted.get(st.station) ?? null,
      restartedOn: st.restartedOn ?? null,
      centrelineG: round(st.centrelineG ?? st.grandMean),
      sigmaDayToDay: st.sigmaDayToDay ?? 0,
      longestRun: st.longestRun ?? 0,
      // Only a flagged station is projected, and only when it has a single
      // target to project toward: `projectDaysToLimit` must return null for
      // a 'mixed' station (stationLimits is null there) — there is no one
      // limit to head for, so a projection would be exactly the over-claim
      // this table exists to refuse.
      projection: flagged ? projectDaysToLimit(run, stationLimits ? { loG: stationLimits.loG, hiG: stationLimits.hiG, targetG: stationLimits.targetG } : null) : null,
      days: st.days,
    };
  });

  // Flagged first, then by distance from target when there is one, else from
  // the line. The column header states the sort, so it is never a mystery.
  const key = (s: WeightStationRow) => Math.abs((s.vsTargetG != null ? s.vsTargetG : s.vsLineG) ?? 0);
  stations.sort((a, b) => Number(b.flagged) - Number(a.flagged) || key(b) - key(a));

  // Volume-weighted, not an average of the stations' own percentages — a
  // mean-of-ratios treats a station handling 200 cones/day the same as one
  // handling 20,000, which is exactly wrong for a LINE total. Fixed Sep 2026
  // (finding H2): this used to average the per-station rates and read 2.03%
  // on real data where the true line rate is 2.16%.
  // Denominator corrected 23 Sep 2026 — see `rejectRatesByStation`'s header.
  // Cones plus only the rejects that are not already one of those cones.
  const lineTotal = rejectStats.totalCones + rejectStats.totalUnmatchedRejects;
  const lineRejectRatePct = lineTotal > 0 ? round((100 * rejectStats.totalRejects) / lineTotal, 2) : null;
  return {
    from,
    to,
    days: drift.days,
    lineMeanG: lineMeanG == null ? null : round(lineMeanG),
    // F6: withheld, not flagged, when the version is refused — see
    // `targetOmittedReason`. `limits` below is deliberately NOT withheld with
    // it: see its own doc comment.
    targetG: lineTargetProvenance.usable ? (limits?.targetG ?? null) : null,
    limits: limits ? { loG: limits.loG, hiG: limits.hiG } : null,
    productId: product?.productId ?? null,
    productLabel: product?.label ?? null,
    targetEffectiveFromUtc,
    targetEffectiveIsLowerBound: lineTargetProvenance.isLowerBound,
    targetEffectiveAfterWindowEnd: lineTargetProvenance.afterWindowEnd,
    targetOmittedReason: lineTargetProvenance.omittedReason,
    stationsWithTargetWithheld: stations.filter((s) => s.targetAfterWindowEnd && s.vsTargetG == null).length,
    limitsChangedInWindow,
    productChangesInWindow,
    thresholdG,
    minDaysHeld: MIN_DAYS_HELD,
    lineRejectRatePct,
    stations,
    rules: drift.rules ?? [],
    generationNote,
  };
}

/**
 * Per-station, per-material cone counts over the window (UX Phase 5 Brief 1,
 * 16 Sep 2026) — the same window and the same plausibility predicate every
 * other weight statistic in this file uses (coneState.ts's plausibleWhere,
 * the ONE population rule), so a station's material mix here is the same
 * population its mean/median/SD above are computed over.
 */
async function stationMaterialCounts(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  plausibility: PlausibilityRule,
): Promise<Map<number, { materialId: number | null; n: number }[]>> {
  // WS-A1: this function's own scope, resolved independently of
  // rejectRatesByStation's (see this file's import header) — the two are
  // guaranteed to agree over the same (lineId, from, to) by construction.
  const scope = await resolveGenerationScope(pool, lineId, { from, to });
  const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const plaus = plausibleWhere(req, 'weight_g', { loG: plausibility.coneLoG, hiG: plausibility.coneHiG });
  const where = andEpoch(
    `line_id=@line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL AND ${plaus}`,
    req,
    scope,
    'cone_event',
  );
  const r = await req.query<{ st: number; mat: number | null; n: number }>(
    `SELECT source_station st, material_id mat, COUNT(*) n
       FROM sms.cone_event
      WHERE ${where}
      GROUP BY source_station, material_id`,
  );
  const out = new Map<number, { materialId: number | null; n: number }[]>();
  for (const row of r.recordset) {
    const list = out.get(row.st) ?? [];
    list.push({ materialId: row.mat == null ? null : Number(row.mat), n: Number(row.n) });
    out.set(row.st, list);
  }
  return out;
}

/**
 * Reject rate per station: rejects over everything that station handled.
 *
 * The denominator is cones PLUS the rejects with NO matching cone_event row.
 *
 * CORRECTED 23 Sep 2026 — this was the third and last copy of finding H1's
 * follow-up defect (`rejectSpc.ts` fixed in 4f68945, `report.ts` and
 * `rejects.ts` in ede05e9; this file was named there as the known remaining
 * instance). It used to divide by cones + EVERY reject, on the premise
 * written above it that "a rejected cone never became a cone_event row".
 * That premise is false: matching rejectQCS1_TP1U2/rejectWeight1_TP1U2 to
 * pack1_TP1U2 on (ProductionDate, HangerNum) — cone_event's own merge key —
 * finds an existing cone row for 98%+ of quality rejects and 41/41 (Sept) /
 * 244/246 (July) weight rejects, so those cones were already counted once in
 * `cones`. Adding them again inflated every denominator and understated
 * every rate, which is why the Weight screen read 4.393% where the Rejects
 * screen and the management summary read 4.590% for the same September
 * period.
 *
 * The rule is NOT re-derived here: `getUnmatchedRejects` (rejects.ts, built
 * on `coneMatchPredicate`) is the single definition every reject-rate path
 * in the application now calls. Two copies of one rule is exactly how this
 * divergence happened three times.
 *
 * PER-STATION ATTRIBUTION — measured, not assumed. An unmatched reject
 * carries its own `source_station`, so it can be attributed to the station
 * that produced it: across every real generation in the dev copy exactly ONE
 * unmatched reject per real epoch (3 rows in total, all on the 1969-12-31
 * clock-fault day) has a NULL station. Those rows cannot be attributed and
 * are deliberately excluded from the per-station denominators and INCLUDED
 * in the line total — the same asymmetry the line totals already had for
 * station-less cones and rejects, and for the same reason (the Rejects
 * screen counts them, so the line figure here must too).
 */
/** Exported for the finding-H2 regression test — the line-rate volume-
 *  weighting is exercised through this function's totals, not by mocking the
 *  much larger getWeightStations call graph. */
export async function rejectRatesByStation(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
): Promise<{
  rates: Map<number, number>;
  totalCones: number;
  totalRejects: number;
  totalUnmatchedRejects: number;
  /** WS-A1, 23 Sep 2026: this function's own generation scope — see this file's import header. */
  generationNote: GenerationNote;
}> {
  // Resolved ONCE and reused for every query below (the per-station query,
  // the totals query, and the getUnmatchedRejects call) so this function's
  // own three queries cannot land on different generations of the same
  // window — but NOT shared with stationMaterialCounts's own resolve (see
  // that function), which is the point: each service/function resolves for
  // itself rather than threading one object across the file's exports.
  const scope = await resolveGenerationScope(pool, lineId, { from, to });

  const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const coneWhere = andEpoch('line_id = @line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL', req, scope, 'cone_event', { prefix: 'wsc' });
  const rejWhere = andEpoch('line_id = @line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL', req, scope, 'reject_event', { prefix: 'wsr' });
  const r = await req.query<{ st: number; cones: number; rejects: number }>(`
      WITH c AS (
        SELECT source_station AS st, COUNT(*) AS n
          FROM sms.cone_event
         WHERE ${coneWhere}
         GROUP BY source_station
      ),
      r AS (
        SELECT source_station AS st, COUNT(*) AS n
          FROM sms.reject_event
         WHERE ${rejWhere}
         GROUP BY source_station
      )
      SELECT COALESCE(c.st, r.st) AS st, COALESCE(c.n, 0) AS cones, COALESCE(r.n, 0) AS rejects
        FROM c FULL OUTER JOIN r ON r.st = c.st`);

  /**
   * The LINE totals are counted WITHOUT the station filter, unlike the
   * per-station rates above, which cannot exist without a station.
   *
   * Summing the per-station rows instead silently excluded every reading that
   * carries no station id — and the transform raises a `no_station` DQ
   * finding precisely because those are expected. The Rejects screen's
   * headline counts them (rejectSpc.ts filters on neither), so the two
   * screens' "line reject rate" measured different populations and would have
   * disagreed the moment such a row appeared. Today there are none in the
   * real data, which is exactly why this had gone unnoticed.
   */
  const totalsReq = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const coneTotalsWhere = andEpoch('line_id = @line AND shift_date BETWEEN @from AND @to', totalsReq, scope, 'cone_event', { prefix: 'wstc' });
  const rejTotalsWhere = andEpoch('line_id = @line AND shift_date BETWEEN @from AND @to', totalsReq, scope, 'reject_event', { prefix: 'wstr' });
  const totals = await totalsReq.query<{ cones: number; rejects: number }>(`
      SELECT
        (SELECT COUNT(*) FROM sms.cone_event
          WHERE ${coneTotalsWhere}) AS cones,
        (SELECT COUNT(*) FROM sms.reject_event
          WHERE ${rejTotalsWhere}) AS rejects`);
  const t = totals.recordset[0];

  /**
   * THIRD query on this pool, issued after the two above (their order is
   * pinned positionally by several fixture-based sibling tests). The ONE
   * shared definition of "this reject is not already a cone_event row" —
   * see this function's header. Grouped by station with the station-less
   * rows collected under `NO_STATION` so a single query answers both the
   * per-station denominators and the line total.
   *
   * WS-A1, 23 Sep 2026: `scope` is now carried onto the filter bag, so both
   * sides of getUnmatchedRejects's own NOT EXISTS match — the reject_event
   * side (bindRejectFilters -> andEpoch) and the cone_event side it matches
   * against (the `um`-prefixed epochWhere already in rejects.ts) — are
   * confined to THIS function's own resolved generation. Before this, a
   * reject in one generation could be "matched" by a cone in another that
   * happened to share (production_ts_utc_ms, hanger_num) — the audit's own
   * planning note; see this file's `weightStations.generations.test.ts` for
   * the proof.
   */
  const unmatchedOf = await getUnmatchedRejects(
    pool,
    lineId,
    { from, to, scope },
    `ISNULL(CAST(re.source_station AS varchar(12)), '${NO_STATION}')`,
  );
  let totalUnmatchedRejects = 0;
  for (const n of unmatchedOf.values()) totalUnmatchedRejects += n;

  const out = new Map<number, number>();
  for (const row of r.recordset) {
    const cones = Number(row.cones);
    const rejects = Number(row.rejects);
    // A station whose rejects ALL matched a cone row has no group in
    // `unmatchedOf` at all (a zero count produces no GROUP BY row), which is
    // 0 unmatched, not "unknown" — so the `?? 0` here is the real answer and
    // not a fallback. `rejects` stays the numerator: the cone WAS rejected,
    // it is only the denominator that must not count it twice.
    const total = cones + (unmatchedOf.get(String(row.st)) ?? 0);
    if (total > 0) out.set(Number(row.st), (100 * rejects) / total);
  }

  return {
    rates: out,
    totalCones: Number(t?.cones ?? 0),
    totalRejects: Number(t?.rejects ?? 0),
    totalUnmatchedRejects,
    generationNote: noteOf(scope),
  };
}
