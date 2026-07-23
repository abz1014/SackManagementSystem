/**
 * Reject control chart (p-chart) — is the reject RATE per bucket within normal
 * variation, or a statistical anomaly? And are anomalies scattered (random)
 * or clustered in time (a burst — a specific event: bad batch, mis-calibration)?
 *
 * This is a p-chart for VARYING sample size: each bucket produces a different
 * number of cones, so each bucket gets its own control limits rather than one
 * flat band — using a pooled/fixed band here would be wrong methodology and
 * would misjudge low-volume hours (e.g. around a stoppage).
 *
 * p̄ = total rejects / total produced (pooled across the whole range)
 * UCL_i = p̄ + 3·√(p̄(1−p̄)/n_i),  LCL_i = max(0, p̄ − 3·√(p̄(1−p̄)/n_i))
 * A bucket is out-of-control if its rate exceeds its own UCL_i.
 * "Episodes" = runs of 1+ consecutive out-of-control buckets — a run of 2+ is
 * the practical definition of a burst; a lone bucket is an isolated spike.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export type RejectBucketSize = 'hour' | 'day';
export type RejectTypeFilter = 'all' | 'quality' | 'weight';

export interface RejectBucket {
  bucketTs: string;
  produced: number;
  rejects: number;
  rate: number | null;
  ucl: number | null;
  lcl: number | null;
  outOfControl: boolean;
}
export interface RejectEpisode {
  startTs: string;
  endTs: string;
  bucketCount: number;
  totalRejects: number;
  totalProduced: number;
}
export interface RejectSpcData {
  bucketSize: RejectBucketSize;
  rejectTypeFilter: RejectTypeFilter;
  totalProduced: number;
  totalRejects: number;
  pBar: number | null;
  outOfControlCount: number;
  buckets: RejectBucket[];
  episodes: RejectEpisode[];
}

function round(n: number, dp = 5): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function getRejectSpc(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  bucketSize: RejectBucketSize,
  rejectType: RejectTypeFilter,
): Promise<RejectSpcData> {
  const bucketExprCone =
    bucketSize === 'hour'
      ? 'DATEADD(HOUR, DATEDIFF(HOUR, 0, production_ts_utc), 0)'
      : 'CAST(shift_date AS DATETIME2(3))';

  const producedRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ bucket_ts: Date; n: number }>(
      `SELECT ${bucketExprCone} AS bucket_ts, COUNT(*) AS n
       FROM sms.cone_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to
       GROUP BY ${bucketExprCone}`,
    );

  // parameterised even though rejectType is already enum-validated upstream —
  // "parameterised queries only, no exceptions" per project rules, no literal
  // string-building even when provably safe today.
  const typeClause = rejectType === 'all' ? '' : 'AND reject_type=@rejType';
  const rejectsReq = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  if (rejectType !== 'all') rejectsReq.input('rejType', mssql.VarChar(10), rejectType);
  const rejectsRes = await rejectsReq.query<{ bucket_ts: Date; n: number }>(
    `SELECT ${bucketExprCone} AS bucket_ts, COUNT(*) AS n
     FROM sms.reject_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to ${typeClause}
     GROUP BY ${bucketExprCone}`,
  );

  const producedMap = new Map(producedRes.recordset.map((r) => [r.bucket_ts.getTime(), r.n]));
  const rejectsMap = new Map(rejectsRes.recordset.map((r) => [r.bucket_ts.getTime(), r.n]));
  const allTimes = new Set([...producedMap.keys(), ...rejectsMap.keys()]);
  const sortedTimes = [...allTimes].sort((a, b) => a - b);

  const totalProduced = [...producedMap.values()].reduce((s, v) => s + v, 0);
  const totalRejects = [...rejectsMap.values()].reduce((s, v) => s + v, 0);
  const pBar = totalProduced > 0 ? totalRejects / totalProduced : null;

  const buckets: RejectBucket[] = sortedTimes.map((t) => {
    const produced = producedMap.get(t) ?? 0;
    const rejects = rejectsMap.get(t) ?? 0;
    let rate: number | null = null;
    let ucl: number | null = null;
    let lcl: number | null = null;
    let outOfControl = false;
    if (produced > 0 && pBar != null) {
      rate = rejects / produced;
      const sigma = Math.sqrt((pBar * (1 - pBar)) / produced);
      ucl = pBar + 3 * sigma;
      lcl = Math.max(0, pBar - 3 * sigma);
      outOfControl = rate > ucl;
    }
    return {
      bucketTs: new Date(t).toISOString(),
      produced,
      rejects,
      rate: rate != null ? round(rate, 5) : null,
      ucl: ucl != null ? round(ucl, 5) : null,
      lcl: lcl != null ? round(lcl, 5) : null,
      outOfControl,
    };
  });

  // episodes: runs of consecutive out-of-control buckets
  const episodes: RejectEpisode[] = [];
  let i = 0;
  while (i < buckets.length) {
    if (!buckets[i]!.outOfControl) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < buckets.length && buckets[j + 1]!.outOfControl) j++;
    const run = buckets.slice(i, j + 1);
    episodes.push({
      startTs: run[0]!.bucketTs,
      endTs: run[run.length - 1]!.bucketTs,
      bucketCount: run.length,
      totalRejects: run.reduce((s, b) => s + b.rejects, 0),
      totalProduced: run.reduce((s, b) => s + b.produced, 0),
    });
    i = j + 1;
  }

  return {
    bucketSize,
    rejectTypeFilter: rejectType,
    totalProduced,
    totalRejects,
    pBar: pBar != null ? round(pBar, 5) : null,
    outOfControlCount: buckets.filter((b) => b.outOfControl).length,
    buckets,
    episodes: episodes.sort((a, b) => b.bucketCount - a.bucketCount || b.totalRejects - a.totalRejects),
  };
}
