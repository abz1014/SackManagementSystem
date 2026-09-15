/**
 * Cone weight report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * Mean, median, spread, the five-state counts, the 20 g histogram, and the
 * per-station table — the Weight screen's figures on paper. Every one comes
 * from the service the screen uses: weights.ts for the mean, SD and the
 * histogram (its CONE_BUCKET is already 20 g), production.ts for the state
 * counts, weightStations.ts for the station rows, all over the ONE
 * population rule.
 *
 * THE MEDIAN. Roadmap Phase 9 added `median` to /api/weights in this same
 * wave; when the service reports one it is used as-is. Otherwise it is
 * computed HERE with the same `plausibleWhere` predicate the mean uses — the
 * same readings, so the two figures describe one population.
 * PERCENTILE_CONT(0.5) is the interpolated median (the mean of the two
 * middle values on an even count), as a spreadsheet's MEDIAN() would give.
 *
 * NO FILTERS on this report in this phase: weights.ts takes no shift and
 * weightStations.ts takes no shift or station, and a report that honoured a
 * filter on some tables and not on others would print two populations under
 * one heading. The route refuses a filter rather than ignoring it.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { getPlausibilityRule } from '../admin.js';
import { plausibleWhere, type StateCounts } from '../coneState.js';
import { getProduction } from '../production.js';
import type { ResolvedPeriod } from '../report.js';
import { getWeights, type Basis, type Bucket } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

export interface ConeWeightReportData {
  period: ResolvedPeriod;
  /** Whatever Setup has on file (H8, 15 Sep 2026) — this used to be hardcoded. */
  basis: Basis;
  /** Every cone reading in the period. */
  cones: number;
  /** The plausible population every statistic below is computed over. */
  weighed: number;
  implausible: number;
  meanG: number | null;
  medianG: number | null;
  /** Where the median came from — the weights service (Phase 9) or this report's own query. */
  medianSource: 'weights_service' | 'report_query';
  sdG: number | null;
  minG: number | null;
  maxG: number | null;
  states: StateCounts | null;
  bucketSizeG: number;
  histogram: Bucket[];
  target: { setpointG: number; source: 'current_product' | 'fallback'; label: string | null };
  byStation: { station: number; n: number; meanG: number; vsLineG: number; vsTargetG: number | null; flagged: boolean }[];
  lineMeanG: number | null;
  plausibility: { loG: number; hiG: number };
  note: string;
}

/**
 * The interpolated median over the plausible population, one query. Exported
 * so the test can pin the predicate it binds.
 */
export async function medianConeWeight(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  window: { loG: number; hiG: number },
): Promise<number | null> {
  const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const plaus = plausibleWhere(req, 'weight_g', window);
  const r = await req.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(weight_g AS float)) OVER () AS med
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to AND ${plaus}`,
  );
  return round(r.recordset[0]?.med ?? null);
}

export async function getConeWeightReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  _filters: ReportFilters,
): Promise<ConeWeightReportData> {
  const { from, to } = resolved;
  const [w, prod, stations, plausibility] = await Promise.all([
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded' — getWeights
    // resolves that to the basis Setup has on file (weights.ts's loadWeightRule),
    // the same row every other basis-aware figure in the app reads.
    getWeights(pool, lineId, undefined, from, to),
    getProduction(pool, lineId, { from, to, groupBy: 'none', withStates: true }),
    getWeightStations(pool, lineId, from, to),
    getPlausibilityRule(pool, lineId),
  ]);
  const window = { loG: plausibility.coneLoG, hiG: plausibility.coneHiG };
  // Phase 9's median (`cone.median`, landed in this same wave), when the
  // service reports one; this report's own query over the same population
  // otherwise. Read loosely on purpose, so a weights.ts built before Phase 9
  // still gets a median here rather than a type error.
  const serviceMedian = (w.cone as { median?: number | null }).median;
  const medianG = serviceMedian != null ? serviceMedian : await medianConeWeight(pool, lineId, from, to, window);

  return {
    period: resolved,
    basis: w.basis,
    cones: prod.rows[0]?.cones ?? 0,
    weighed: w.cone.count,
    implausible: w.cone.implausible,
    meanG: w.cone.avg,
    medianG,
    medianSource: serviceMedian != null ? 'weights_service' : 'report_query',
    sdG: w.cone.stdev,
    minG: w.cone.min,
    maxG: w.cone.max,
    states: prod.states,
    bucketSizeG: w.cone.bucketSize,
    histogram: w.cone.histogram,
    target: { setpointG: w.cone.nominalSetpointG, source: w.cone.nominalSource, label: w.cone.nominalLabel },
    byStation: stations.stations.map((s) => ({
      station: s.station, n: s.n, meanG: s.meanG, vsLineG: s.vsLineG, vsTargetG: s.vsTargetG, flagged: s.flagged,
    })),
    lineMeanG: stations.lineMeanG,
    plausibility: window,
    note:
      (w.basis === 'net'
        ? `Net basis: cone tube weight subtracted from every reading, per the weight rule on file. `
        : w.basis === 'gross'
          ? `Gross basis: weights as the scale recorded them (identical to As-recorded until IFL confirms the basis, Q4/Q5). `
          : `Weights as the scale recorded them (the weight basis is not yet confirmed by IFL). `) +
      'Every statistic is over readings inside the plausibility window; the excluded count is stated. The target is the ' +
      'product selected for the line, applied line-wide.',
  };
}

export const CONE_WEIGHT_CSV_HEADERS = [
  'section', 'key', 'value', 'station', 'n', 'mean_g', 'vs_line_g', 'vs_target_g', 'flagged', 'bucket_g', 'count',
] as const;

export function coneWeightCsv(d: ConeWeightReportData): CsvTable {
  const kv = (key: string, value: CsvRow[number]): CsvRow => ['summary', key, value, null, null, null, null, null, null, null, null];
  const rows: CsvRow[] = [
    kv('cones', d.cones),
    kv('weighed_plausible', d.weighed),
    kv('implausible_excluded', d.implausible),
    kv('mean_g', d.meanG),
    kv('median_g', d.medianG),
    kv('sd_g', d.sdG),
    kv('min_g', d.minG),
    kv('max_g', d.maxG),
    kv('target_g', d.target.setpointG),
    kv('target_source', d.target.source),
    kv('plausible_lo_g', d.plausibility.loG),
    kv('plausible_hi_g', d.plausibility.hiG),
  ];
  if (d.states) for (const [state, n] of Object.entries(d.states)) rows.push(kv(`state_${state}`, n));
  for (const s of d.byStation) {
    rows.push(['station', null, null, s.station, s.n, s.meanG, s.vsLineG, s.vsTargetG, s.flagged, null, null]);
  }
  for (const b of d.histogram) rows.push(['histogram', null, null, null, null, null, null, null, null, b.bucket, b.count]);
  return { headers: CONE_WEIGHT_CSV_HEADERS, rows };
}
