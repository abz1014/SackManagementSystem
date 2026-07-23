/**
 * Inferred OEE = Availability × Performance × Quality — computed entirely
 * from event data. There is NO PLC status feed and NO planned-downtime
 * schedule, so every input here is an estimate, not a certified figure:
 *
 *  - Availability = Run Time / Planned Time. Planned Time defaults to the
 *    full calendar span of the range (24h × days) since the line runs three
 *    back-to-back shifts with no gap; override via plannedHoursPerDay if
 *    IFL confirms a real scheduled-downtime allowance. Planned Time is then
 *    capped at the actual observed data span (first event → last event in
 *    the range): gap-based stoppage detection can only see a stoppage
 *    BETWEEN two observed timestamps, so time before the first event or
 *    after the last event in the queried window would otherwise silently
 *    count as "running" rather than "unknown." This matters most for the
 *    most recent day in any range — including "today" once live, which is
 *    always partial while a shift is in progress — verified against a real
 *    partial day in the 18-day snapshot (2026-07-10, cut off mid-day) where
 *    the uncapped formula understated OEE by ~25pp for no operational reason.
 *  - Performance = (Ideal Cycle Time × Count Produced) / Run Time. Ideal
 *    Cycle Time is NOT given — we infer it from the 95th-percentile HOURLY
 *    throughput rate actually observed (cones/hour → seconds/cone), i.e. the
 *    line's best sustained combined output. NOT from raw inter-cone gaps:
 *    with 14 parallel stations feeding one timestamp stream, consecutive
 *    gaps are dominated by how many stations happen to finish near-
 *    simultaneously, not by true cycle time — verified on real data (547
 *    sub-1-second gaps in a single day, entirely from station interleaving,
 *    which made a raw gap-percentile approach return a nonsensical 0.6s).
 *    Override with idealCycleSeconds if IFL has a spec.
 *  - Quality = Produced / (Produced + Rejected) — the SAME convention
 *    already shipped on the Dashboard's reject-rate tile, kept consistent
 *    rather than introducing a second definition.
 *
 * Ship this labelled "Estimated OEE" with every input visible and editable —
 * a wrong OEE is worse than none, and a plant manager will know what OEE
 * should look like.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { SHIFT_BOUNDARIES } from '@sms/shared';

export interface OeeData {
  from: string;
  to: string;
  thresholdSeconds: number;
  plannedHoursPerDay: number;
  plannedSeconds: number;
  downSeconds: number;
  runSeconds: number;
  availabilityPct: number;
  idealCycleSeconds: number;
  idealCycleSource: 'inferred' | 'manual';
  producedCount: number;
  rejectedCount: number;
  performancePct: number;
  qualityPct: number;
  oeePct: number;
  stoppageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  headGapSeconds: number;
  tailGapSeconds: number;
  possiblyPartial: boolean;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx]!;
}

export async function getOee(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  thresholdSeconds: number,
  plannedHoursPerDay: number,
  manualIdealCycleSeconds: number | null,
): Promise<OeeData> {
  const tsRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ ts: Date }>(
      `SELECT production_ts_utc ts FROM sms.cone_event
       WHERE line_id=@line AND shift_date BETWEEN @from AND @to
       ORDER BY production_ts_utc`,
    );
  const times = tsRes.recordset.map((r) => r.ts.getTime());
  const producedCount = times.length;

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i]! - times[i - 1]!) / 1000);

  let downSeconds = 0;
  let stoppageCount = 0;
  for (const g of gaps) {
    if (g >= thresholdSeconds) {
      downSeconds += g;
      stoppageCount++;
    }
  }

  let idealCycleSeconds: number;
  if (manualIdealCycleSeconds != null) {
    idealCycleSeconds = manualIdealCycleSeconds;
  } else {
    const hourlyRes = await pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('from', mssql.Date, from)
      .input('to', mssql.Date, to)
      .query<{ n: number }>(
        `SELECT COUNT(*) n FROM sms.cone_event
         WHERE line_id=@line AND shift_date BETWEEN @from AND @to
         GROUP BY DATEADD(HOUR, DATEDIFF(HOUR, 0, production_ts_utc), 0)`,
      );
    const hourlyCounts = hourlyRes.recordset.map((r) => r.n).sort((a, b) => a - b);
    const bestHourly = percentile(hourlyCounts, 0.95) || 1;
    idealCycleSeconds = 3600 / bestHourly;
  }
  const idealCycleSource: 'inferred' | 'manual' = manualIdealCycleSeconds != null ? 'manual' : 'inferred';

  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  const calendarPlannedSeconds = days * plannedHoursPerDay * 3600;

  // shift_date runs 06:00 → next-day 06:00 (SHIFT_BOUNDARIES.morningStart), matching
  // how the sync-worker assigns shift_date — not calendar midnight.
  const morningStartMs = SHIFT_BOUNDARIES.morningStart * 60_000;
  const rangeStartMs = Date.parse(`${from}T00:00:00.000Z`) + morningStartMs;
  const rangeEndMs = Date.parse(`${to}T00:00:00.000Z`) + 86_400_000 + morningStartMs;

  const firstEventMs = producedCount > 0 ? times[0]! : null;
  const lastEventMs = producedCount > 0 ? times[producedCount - 1]! : null;
  const headGapSeconds = firstEventMs != null ? Math.max(0, (firstEventMs - rangeStartMs) / 1000) : 0;
  const tailGapSeconds = lastEventMs != null ? Math.max(0, (rangeEndMs - lastEventMs) / 1000) : 0;
  // possiblyPartial: the gap at either edge of the queried window is itself big enough
  // that it would count as a detected stoppage if it were between two observed events —
  // we just can't tell "down" from "no data yet" out here at the boundary.
  const possiblyPartial = producedCount > 0 && (headGapSeconds > thresholdSeconds || tailGapSeconds > thresholdSeconds);

  const observedSpanSeconds = firstEventMs != null && lastEventMs != null ? (lastEventMs - firstEventMs) / 1000 : 0;
  const plannedSeconds = observedSpanSeconds > 0 ? Math.min(calendarPlannedSeconds, observedSpanSeconds) : calendarPlannedSeconds;
  const runSeconds = Math.max(0, plannedSeconds - downSeconds);
  const availabilityPct = plannedSeconds > 0 ? (100 * runSeconds) / plannedSeconds : 0;

  const rejRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ n: number }>(
      `SELECT COUNT(*) n FROM sms.reject_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to`,
    );
  const rejectedCount = rejRes.recordset[0]?.n ?? 0;

  const performancePct = runSeconds > 0 ? (100 * (idealCycleSeconds * producedCount)) / runSeconds : 0;
  const denom = producedCount + rejectedCount;
  const qualityPct = denom > 0 ? (100 * producedCount) / denom : 0;
  const oeePct = (availabilityPct / 100) * (performancePct / 100) * (qualityPct / 100) * 100;

  return {
    from,
    to,
    thresholdSeconds,
    plannedHoursPerDay,
    plannedSeconds: round(plannedSeconds, 1),
    downSeconds: round(downSeconds, 1),
    runSeconds: round(runSeconds, 1),
    availabilityPct: round(availabilityPct),
    idealCycleSeconds: round(idealCycleSeconds, 2),
    idealCycleSource,
    producedCount,
    rejectedCount,
    performancePct: round(performancePct),
    qualityPct: round(qualityPct),
    oeePct: round(oeePct),
    stoppageCount,
    firstTs: firstEventMs != null ? new Date(firstEventMs).toISOString() : null,
    lastTs: lastEventMs != null ? new Date(lastEventMs).toISOString() : null,
    headGapSeconds: round(headGapSeconds, 1),
    tailGapSeconds: round(tailGapSeconds, 1),
    possiblyPartial,
  };
}
