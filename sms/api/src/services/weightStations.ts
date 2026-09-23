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
import { driftThresholdG, MIN_DAYS_HELD } from './attention.js';
import { consecutiveProductionDays } from './plantClock.js';
import { getUnmatchedRejects } from './rejects.js';

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
  /** Signed grams against the line's own mean. */
  vsLineG: number;
  /**
   * Signed grams against this row's own target (see `targetBasis`) — null
   * when no target could be resolved, or when the station ran more than one
   * material in the window and there is therefore no single target to be
   * signed against.
   */
  vsTargetG: number | null;
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
  targetG: number | null;
  /** The product's limits in force at the window's end, the edges the projection extends to. */
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
  const targetEffectiveFromUtc = product ? (catalogue.versionAt(product.productId, endMs)?.effectiveFromUtc ?? null) : null;
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
      if (runN > 0) runMean = run.reduce((s, d) => s + d.n * d.mean, 0) / runN;
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
    let rowVsTargetG: number | null = limits == null ? null : round(runMean - limits.targetG);
    if (distinctMaterials.length === 1) {
      targetBasis = 'station_material';
      const mLimits = catalogue.limitsAt(distinctMaterials[0]!, endMs);
      stationLimits = mLimits;
      rowVsTargetG = mLimits == null ? null : round(runMean - mLimits.targetG);
    } else if (distinctMaterials.length > 1) {
      targetBasis = 'mixed';
      materialsInWindow = distinctMaterials.length;
      stationLimits = null; // no single target to project toward either
      rowVsTargetG = null; // NO NUMBER — there is no single target, so printing one would be over-claiming.
    }

    const r = rejects.get(st.station);
    return {
      station: st.station,
      n: st.n,
      meanG: round(st.grandMean),
      medianG: st.medianG == null ? null : round(st.medianG),
      sdG: round(st.stdevWithin ?? 0),
      vsLineG: lineMeanG == null ? 0 : round(runMean - lineMeanG),
      vsTargetG: rowVsTargetG,
      targetBasis,
      ...(materialsInWindow != null ? { materialsInWindow } : {}),
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
    targetG: limits?.targetG ?? null,
    limits: limits ? { loG: limits.loG, hiG: limits.hiG } : null,
    productId: product?.productId ?? null,
    productLabel: product?.label ?? null,
    targetEffectiveFromUtc,
    limitsChangedInWindow,
    productChangesInWindow,
    thresholdG,
    minDaysHeld: MIN_DAYS_HELD,
    lineRejectRatePct,
    stations,
    rules: drift.rules ?? [],
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
  const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const plaus = plausibleWhere(req, 'weight_g', { loG: plausibility.coneLoG, hiG: plausibility.coneHiG });
  const r = await req.query<{ st: number; mat: number | null; n: number }>(
    `SELECT source_station st, material_id mat, COUNT(*) n
       FROM sms.cone_event
      WHERE line_id=@line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL AND ${plaus}
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
): Promise<{ rates: Map<number, number>; totalCones: number; totalRejects: number; totalUnmatchedRejects: number }> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ st: number; cones: number; rejects: number }>(`
      WITH c AS (
        SELECT source_station AS st, COUNT(*) AS n
          FROM sms.cone_event
         WHERE line_id = @line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL
         GROUP BY source_station
      ),
      r AS (
        SELECT source_station AS st, COUNT(*) AS n
          FROM sms.reject_event
         WHERE line_id = @line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL
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
  const totals = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ cones: number; rejects: number }>(`
      SELECT
        (SELECT COUNT(*) FROM sms.cone_event
          WHERE line_id = @line AND shift_date BETWEEN @from AND @to) AS cones,
        (SELECT COUNT(*) FROM sms.reject_event
          WHERE line_id = @line AND shift_date BETWEEN @from AND @to) AS rejects`);
  const t = totals.recordset[0];

  /**
   * THIRD query on this pool, issued after the two above (their order is
   * pinned positionally by several fixture-based sibling tests). The ONE
   * shared definition of "this reject is not already a cone_event row" —
   * see this function's header. Grouped by station with the station-less
   * rows collected under `NO_STATION` so a single query answers both the
   * per-station denominators and the line total.
   */
  const unmatchedOf = await getUnmatchedRejects(
    pool,
    lineId,
    { from, to },
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
  };
}
