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
import { getPlausibilityRule } from './admin.js';
import { loadProductTimeline, limitsOf } from './productAt.js';
import { loadProductCatalogue } from './productLimits.js';
import { driftThresholdG, MIN_DAYS_HELD } from './attention.js';
import { consecutiveProductionDays } from './plantClock.js';

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
  /** Signed grams against the product target, or null when none was recorded. */
  vsTargetG: number | null;
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

  // The target is the product in force at the END of the window: it is what
  // the line is making now, and the table is read to decide what to do next.
  // Its limits come from the versioned history AT that instant, not from the
  // mirror's current values (productLimits.ts). Still one line-wide target:
  // with up to six materials running on different machines (Sep 2026 data),
  // a per-machine target is the honest next step — recorded, not built.
  const endMs = new Date(`${to}T23:59:59Z`).getTime();
  const product = timeline.at(endMs);
  const limits = product ? (catalogue.limitsAt(product.productId, endMs) ?? limitsOf(product)) : null;

  // Every logged adjustment restarts the station's centreline and sigma as
  // well as its run (calibration.ts header, Phase 9).
  const restarts = adjustmentRestarts(adjustments);

  const [drift, rejectStats] = await Promise.all([
    getStationDrift(pool, lineId, from, to, plausibility, { restarts }),
    rejectRatesByStation(pool, lineId, from, to),
  ]);
  const rejects = rejectStats.rates;

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

    const r = rejects.get(st.station);
    return {
      station: st.station,
      n: st.n,
      meanG: round(st.grandMean),
      medianG: st.medianG == null ? null : round(st.medianG),
      sdG: round(st.stdevWithin ?? 0),
      vsLineG: lineMeanG == null ? 0 : round(runMean - lineMeanG),
      vsTargetG: limits == null ? null : round(runMean - limits.targetG),
      daysHeld,
      flagged,
      rejectRatePct: r == null ? null : round(r, 2),
      lastAdjustedUtc: lastAdjusted.get(st.station) ?? null,
      restartedOn: st.restartedOn ?? null,
      centrelineG: round(st.centrelineG ?? st.grandMean),
      sigmaDayToDay: st.sigmaDayToDay ?? 0,
      longestRun: st.longestRun ?? 0,
      // Only a flagged station is projected: the line is fitted over the run
      // the finding names, and a station with no finding has no run.
      projection: flagged ? projectDaysToLimit(run, limits ? { loG: limits.loG, hiG: limits.hiG, targetG: limits.targetG } : null) : null,
      days: st.days,
    };
  });

  // Flagged first, then by distance from target when there is one, else from
  // the line. The column header states the sort, so it is never a mystery.
  const key = (s: WeightStationRow) => Math.abs((limits ? s.vsTargetG : s.vsLineG) ?? 0);
  stations.sort((a, b) => Number(b.flagged) - Number(a.flagged) || key(b) - key(a));

  // Volume-weighted, not an average of the stations' own percentages — a
  // mean-of-ratios treats a station handling 200 cones/day the same as one
  // handling 20,000, which is exactly wrong for a LINE total. Fixed Sep 2026
  // (finding H2): this used to average the per-station rates and read 2.03%
  // on real data where the true line rate is 2.16%.
  const lineTotal = rejectStats.totalCones + rejectStats.totalRejects;
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
    thresholdG,
    minDaysHeld: MIN_DAYS_HELD,
    lineRejectRatePct,
    stations,
    rules: drift.rules ?? [],
  };
}

/**
 * Reject rate per station: rejects over everything that station handled.
 *
 * The denominator is cones PLUS rejects, because a rejected cone never became
 * a cone_event row — dividing by cones alone would understate every station.
 */
/** Exported for the finding-H2 regression test — the line-rate volume-
 *  weighting is exercised through this function's totals, not by mocking the
 *  much larger getWeightStations call graph. */
export async function rejectRatesByStation(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
): Promise<{ rates: Map<number, number>; totalCones: number; totalRejects: number }> {
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

  const out = new Map<number, number>();
  for (const row of r.recordset) {
    const cones = Number(row.cones);
    const rejects = Number(row.rejects);
    const total = cones + rejects;
    if (total > 0) out.set(Number(row.st), (100 * rejects) / total);
  }

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
  return {
    rates: out,
    totalCones: Number(t?.cones ?? 0),
    totalRejects: Number(t?.rejects ?? 0),
  };
}
