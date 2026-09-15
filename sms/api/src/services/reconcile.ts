/**
 * Weight reconciliation for a period — roadmap Phase 4 item 3 (14 Sep 2026).
 *
 * `sms verify --weights` reconciles the SOURCE against raw and canonical per
 * generation (cli/src/commands/verify.ts). This is the other half: within
 * canonical, for a period, how many cone readings there are and what they
 * weigh, split by the ONE classification state and by plausibility — so a
 * manager can see that the count on the Report, the population under the
 * Weight chart and the register's states are one set of numbers, and so the
 * report can print "N readings, of which M implausible excluded" from the
 * same query that computes the averages those M were excluded from.
 *
 * ONE QUERY, GROUPED BY THE STATE CASE coneState.ts builds. The plausibility
 * split is not a second query with a second predicate: 'unknown' readings
 * are further split by whether the population rule excluded them (implausible)
 * or they simply had no limits to be judged by, using the same `plausibleWhere`
 * text every weight statistic uses. Sums are of the recorded weight, as the
 * scale wrote it — no basis adjustment (Q4/Q5 open), and the response says so.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { ConeState } from '@sms/shared';
import { bindStateCase, loadStateContext, plausibleWhere, type StateContext } from './coneState.js';

export interface WeightAggregate {
  n: number;
  sumG: number | null;
  avgG: number | null;
  minG: number | null;
  maxG: number | null;
}

export interface ReconciliationData {
  from: string;
  to: string;
  shift: string | null;
  /** Every cone reading in the period, whatever its state. */
  total: WeightAggregate;
  /** The population every weight statistic in the application uses. */
  plausible: WeightAggregate;
  /** The readings that population excludes. Always 'unknown' in `byState`. */
  implausible: WeightAggregate;
  /** Readings with no weight at all (never plausible, never implausible). */
  noWeight: number;
  byState: Record<ConeState, WeightAggregate>;
  plausibility: { loG: number; hiG: number };
  /** How many (product, limits-version) windows the classification had. */
  limitWindows: number;
  basis: 'as_recorded';
  note: string;
}

const empty = (): WeightAggregate => ({ n: 0, sumG: null, avgG: null, minG: null, maxG: null });
const num = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 100) / 100);

function merge(parts: WeightAggregate[]): WeightAggregate {
  const n = parts.reduce((a, p) => a + p.n, 0);
  if (n === 0) return empty();
  const sum = parts.reduce((a, p) => a + (p.sumG ?? 0), 0);
  const mins = parts.map((p) => p.minG).filter((x): x is number => x != null);
  const maxs = parts.map((p) => p.maxG).filter((x): x is number => x != null);
  return {
    n,
    sumG: Math.round(sum * 100) / 100,
    avgG: Math.round((sum / n) * 100) / 100,
    minG: mins.length ? Math.min(...mins) : null,
    maxG: maxs.length ? Math.max(...maxs) : null,
  };
}

export async function getReconciliation(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  shift: string | null = null,
  ctx?: StateContext,
): Promise<ReconciliationData> {
  const context = ctx ?? (await loadStateContext(pool, lineId));
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  if (shift) req.input('shift', mssql.VarChar(10), shift);
  const stateCase = bindStateCase(req, context, '', 'cs');
  const plausible = plausibleWhere(req, 'weight_g', context.plausibility);

  // One row per (state, plausibility bucket): 0 = plausible, 1 = implausible,
  // 2 = no weight. The buckets are exhaustive, so `total` is their sum.
  const r = await req.query<{ state: string; bucket: number; n: number; s: unknown; mn: unknown; mx: unknown }>(
    `SELECT ${stateCase} AS state,
            CASE WHEN weight_g IS NULL THEN 2 WHEN ${plausible} THEN 0 ELSE 1 END AS bucket,
            COUNT(*) n, SUM(weight_g) s, MIN(weight_g) mn, MAX(weight_g) mx
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to
        ${shift ? 'AND shift_code = @shift' : ''}
      GROUP BY ${stateCase}, CASE WHEN weight_g IS NULL THEN 2 WHEN ${plausible} THEN 0 ELSE 1 END`,
  );

  const byStateParts: Record<ConeState, WeightAggregate[]> = { within: [], low: [], high: [], rejected: [], unknown: [] };
  const plausibleParts: WeightAggregate[] = [];
  const implausibleParts: WeightAggregate[] = [];
  let noWeight = 0;
  for (const row of r.recordset) {
    const agg: WeightAggregate = { n: Number(row.n), sumG: num(row.s), avgG: null, minG: num(row.mn), maxG: num(row.mx) };
    agg.avgG = agg.n > 0 && agg.sumG != null ? Math.round((agg.sumG / agg.n) * 100) / 100 : null;
    const bucket = Number(row.bucket);
    if (bucket === 2) noWeight += agg.n;
    else if (bucket === 1) implausibleParts.push(agg);
    else plausibleParts.push(agg);
    const st = row.state as ConeState;
    if (st in byStateParts) byStateParts[st].push(agg);
  }
  const byState: Record<ConeState, WeightAggregate> = {
    within: merge(byStateParts.within),
    low: merge(byStateParts.low),
    high: merge(byStateParts.high),
    rejected: merge(byStateParts.rejected),
    unknown: merge(byStateParts.unknown),
  };
  const plausibleAgg = merge(plausibleParts);
  const implausibleAgg = merge(implausibleParts);
  // The total counts every reading, but averages only the ones with a weight:
  // a reading with none must not dilute the mean.
  const weighed = merge([plausibleAgg, implausibleAgg]);
  const total: WeightAggregate = { ...weighed, n: weighed.n + noWeight };

  return {
    from,
    to,
    shift,
    total,
    plausible: plausibleAgg,
    implausible: implausibleAgg,
    noWeight,
    byState,
    plausibility: context.plausibility,
    limitWindows: context.windows.length,
    basis: 'as_recorded',
    note:
      'Weights as the scale recorded them; no tube or tare adjustment. The plausibility window is the rule on file, ' +
      'which IFL has not yet confirmed. Every weight statistic in the application is computed over the plausible population.',
  };
}
