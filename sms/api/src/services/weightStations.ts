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
 *  - DAYS HELD, counted over the run the figure describes, not the window.
 *  - REJECT RATE per station, so the cross-reference ("high rejects AND a
 *    weight bias — look here first") lives in the same row.
 *  - LAST ADJUSTED, because a recommendation with no record of what was
 *    already done about it is one an engineer cannot act on.
 *
 * WHAT IT DELIBERATELY DOES NOT REPORT: grams to adjust by, or days until a
 * limit is reached. Weighing data cannot tell a scale that reads nine grams
 * heavy from cones that genuinely are nine grams heavy, and those two need
 * opposite actions. The row states what was measured and stops.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { getStationDrift, listCalibrationAdjustments, type StationDriftDay } from './calibration.js';
import { getPlausibilityRule } from './admin.js';
import { loadProductTimeline, limitsOf } from './productAt.js';
import { driftThresholdG, MIN_DAYS_HELD } from './attention.js';
import { toPlantMs } from './plantClock.js';

export interface WeightStationRow {
  station: number;
  /** Cones weighed at this station in the window. */
  n: number;
  meanG: number;
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
  productId: number | null;
  productLabel: string | null;
  /** How far from the line a station must sit to be worth acting on. */
  thresholdG: number;
  minDaysHeld: number;
  lineRejectRatePct: number | null;
  stations: WeightStationRow[];
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export async function getWeightStations(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
): Promise<WeightStationsData> {
  const [plausibility, timeline, adjustments] = await Promise.all([
    getPlausibilityRule(pool, lineId),
    loadProductTimeline(pool, lineId),
    listCalibrationAdjustments(pool, lineId),
  ]);

  // The target is the product in force at the END of the window: it is what
  // the line is making now, and the table is read to decide what to do next.
  const product = timeline.at(`${to}T23:59:59Z`);
  const limits = limitsOf(product);

  const [drift, rejects] = await Promise.all([
    getStationDrift(pool, lineId, from, to, plausibility),
    rejectRatesByStation(pool, lineId, from, to),
  ]);

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
    const adjustedAtMs = lastAdjusted.has(st.station) ? toPlantMs(lastAdjusted.get(st.station)!) : null;
    // A logged adjustment restarts the station: days before it say nothing
    // about the scale as it stands now.
    const days =
      adjustedAtMs == null
        ? st.days
        : st.days.filter((d) => new Date(`${d.date}T23:59:59Z`).getTime() >= adjustedAtMs);

    let daysHeld = 0;
    let flagged = false;
    let runMean = st.grandMean;
    if (days.length > 0 && lineMeanG != null) {
      const side = sign(days[days.length - 1]!.mean - lineMeanG);
      const run: StationDriftDay[] = [];
      for (let i = days.length - 1; i >= 0; i--) {
        if (sign(days[i]!.mean - lineMeanG) !== side) break;
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

    const r = rejects.get(st.station);
    return {
      station: st.station,
      n: st.n,
      meanG: round(st.grandMean),
      vsLineG: lineMeanG == null ? 0 : round(runMean - lineMeanG),
      vsTargetG: limits == null ? null : round(runMean - limits.targetG),
      daysHeld,
      flagged,
      rejectRatePct: r == null ? null : round(r, 2),
      lastAdjustedUtc: lastAdjusted.get(st.station) ?? null,
      days: st.days,
    };
  });

  // Flagged first, then by distance from target when there is one, else from
  // the line. The column header states the sort, so it is never a mystery.
  const key = (s: WeightStationRow) => Math.abs((limits ? s.vsTargetG : s.vsLineG) ?? 0);
  stations.sort((a, b) => Number(b.flagged) - Number(a.flagged) || key(b) - key(a));

  const lineRejects = [...rejects.values()];
  return {
    from,
    to,
    days: drift.days,
    lineMeanG: lineMeanG == null ? null : round(lineMeanG),
    targetG: limits?.targetG ?? null,
    productId: product?.productId ?? null,
    productLabel: product?.label ?? null,
    thresholdG,
    minDaysHeld: MIN_DAYS_HELD,
    lineRejectRatePct: lineRejects.length ? round(lineRejects.reduce((s, v) => s + v, 0) / lineRejects.length, 2) : null,
    stations,
  };
}

/**
 * Reject rate per station: rejects over everything that station handled.
 *
 * The denominator is cones PLUS rejects, because a rejected cone never became
 * a cone_event row — dividing by cones alone would understate every station.
 */
async function rejectRatesByStation(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
): Promise<Map<number, number>> {
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
    const total = Number(row.cones) + Number(row.rejects);
    if (total > 0) out.set(Number(row.st), (100 * Number(row.rejects)) / total);
  }
  return out;
}
