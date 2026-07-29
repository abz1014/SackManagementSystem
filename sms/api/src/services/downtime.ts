/**
 * Downtime & Throughput — inferred from inter-cone timestamp gaps only. There
 * is no PLC status feed and no planned-downtime schedule, so a "stoppage" here
 * means exactly one thing: the whole line produced zero cones for longer than
 * `thresholdSeconds`. We cannot distinguish a planned break from a fault —
 * that caveat must ship in the UI, not just this comment.
 *
 * Threshold default (120s) is empirically chosen: on a real production day,
 * normal inter-cone gaps have p99 ≈ 31s, then jump straight to 180s+ for real
 * stops — a clean bimodal split with no ambiguous middle ground.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface Stoppage {
  startTs: string;
  endTs: string;
  durationSeconds: number;
}
export interface HourBucket {
  hourTs: string;
  count: number;
}
export interface DowntimeData {
  date: string;
  thresholdSeconds: number;
  coneCount: number;
  firstTs: string | null;
  lastTs: string | null;
  totalSpanSeconds: number;
  totalDownSeconds: number;
  totalRunSeconds: number;
  availabilityPct: number | null;
  stoppageCount: number;
  mtbfSeconds: number | null;
  mttrSeconds: number | null;
  typicalGapSeconds: number | null;
  stoppages: Stoppage[];
  hourly: HourBucket[];
}

export interface StoppagePatternData {
  from: string;
  to: string;
  thresholdSeconds: number;
  dayCount: number;
  stoppages: Stoppage[];
}

/**
 * Every stoppage across a DATE RANGE, in one query.
 *
 * The per-day endpoint above is right for "what happened on this shift", but
 * hour-of-day clustering needs many days to mean anything, and calling the
 * per-day route once per day is one HTTP round trip per day of history — fine
 * over an 18-day snapshot, unusable once the live line has a year behind it.
 *
 * Gaps are partitioned BY shift_date so a gap spanning the roll to the next
 * day is never counted: that time is a day boundary, not a stoppage.
 */
export async function getStoppagePatterns(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  thresholdSeconds: number,
): Promise<StoppagePatternData> {
  const res = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .input('thr', mssql.Int, thresholdSeconds)
    .query<{ gap_start: Date; gap_end: Date; gap_s: number }>(
      `;WITH ordered AS (
         SELECT production_ts_utc, shift_date,
                LAG(production_ts_utc) OVER (PARTITION BY shift_date ORDER BY production_ts_utc) AS prev_ts
         FROM sms.cone_event
         WHERE line_id=@line AND shift_date BETWEEN @from AND @to
       )
       SELECT prev_ts AS gap_start, production_ts_utc AS gap_end,
              DATEDIFF(SECOND, prev_ts, production_ts_utc) AS gap_s
       FROM ordered
       WHERE prev_ts IS NOT NULL AND DATEDIFF(SECOND, prev_ts, production_ts_utc) >= @thr
       ORDER BY prev_ts`,
    );

  const dayRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ n: number }>(
      `SELECT COUNT(DISTINCT shift_date) n FROM sms.cone_event
       WHERE line_id=@line AND shift_date BETWEEN @from AND @to`,
    );

  return {
    from,
    to,
    thresholdSeconds,
    dayCount: dayRes.recordset[0]?.n ?? 0,
    stoppages: res.recordset.map((g) => ({
      startTs: new Date(g.gap_start).toISOString(),
      endTs: new Date(g.gap_end).toISOString(),
      durationSeconds: g.gap_s,
    })),
  };
}

export async function getDowntime(
  pool: ConnectionPool,
  lineId: number,
  date: string,
  thresholdSeconds: number,
): Promise<DowntimeData> {
  const span = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('date', mssql.Date, date)
    .query<{ n: number; first_ts: Date | null; last_ts: Date | null }>(
      `SELECT COUNT(*) n, MIN(production_ts_utc) first_ts, MAX(production_ts_utc) last_ts
       FROM sms.cone_event WHERE line_id=@line AND shift_date=@date`,
    );
  const { n, first_ts, last_ts } = span.recordset[0]!;

  const gaps = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('date', mssql.Date, date)
    .query<{ gap_start: Date; gap_end: Date; gap_s: number }>(
      `;WITH ordered AS (
         SELECT production_ts_utc,
                LAG(production_ts_utc) OVER (ORDER BY production_ts_utc) AS prev_ts
         FROM sms.cone_event WHERE line_id=@line AND shift_date=@date
       )
       SELECT prev_ts AS gap_start, production_ts_utc AS gap_end,
              DATEDIFF(SECOND, prev_ts, production_ts_utc) AS gap_s
       FROM ordered WHERE prev_ts IS NOT NULL`,
    );

  const stoppages: Stoppage[] = [];
  let totalDown = 0;
  let normalSum = 0;
  let normalCount = 0;
  for (const g of gaps.recordset) {
    if (g.gap_s >= thresholdSeconds) {
      stoppages.push({
        startTs: new Date(g.gap_start).toISOString(),
        endTs: new Date(g.gap_end).toISOString(),
        durationSeconds: g.gap_s,
      });
      totalDown += g.gap_s;
    } else {
      normalSum += g.gap_s;
      normalCount += 1;
    }
  }

  const totalSpan = first_ts && last_ts ? Math.round((last_ts.getTime() - first_ts.getTime()) / 1000) : 0;
  const totalRun = Math.max(0, totalSpan - totalDown);
  const failureCount = stoppages.length;

  const hourlyRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('date', mssql.Date, date)
    .query<{ hour_ts: Date; n: number }>(
      `SELECT DATEADD(HOUR, DATEDIFF(HOUR, 0, production_ts_utc), 0) AS hour_ts, COUNT(*) AS n
       FROM sms.cone_event WHERE line_id=@line AND shift_date=@date
       GROUP BY DATEADD(HOUR, DATEDIFF(HOUR, 0, production_ts_utc), 0)
       ORDER BY hour_ts`,
    );

  return {
    date,
    thresholdSeconds,
    coneCount: n,
    firstTs: first_ts ? new Date(first_ts).toISOString() : null,
    lastTs: last_ts ? new Date(last_ts).toISOString() : null,
    totalSpanSeconds: totalSpan,
    totalDownSeconds: totalDown,
    totalRunSeconds: totalRun,
    availabilityPct: totalSpan > 0 ? Math.round((10000 * totalRun) / totalSpan) / 100 : null,
    stoppageCount: failureCount,
    mtbfSeconds: failureCount > 0 ? Math.round(totalRun / failureCount) : null,
    mttrSeconds: failureCount > 0 ? Math.round(totalDown / failureCount) : null,
    typicalGapSeconds: normalCount > 0 ? Math.round((10 * normalSum) / normalCount) / 10 : null,
    stoppages: stoppages.sort((a, b) => b.durationSeconds - a.durationSeconds),
    hourly: hourlyRes.recordset.map((h) => ({ hourTs: new Date(h.hour_ts).toISOString(), count: h.n })),
  };
}
