/**
 * Management summary — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * The KPI set of KPI-DEFINITIONS.md, each figure beside the same figure for
 * the PRIOR PERIOD OF EQUAL LENGTH and the change between them; and the
 * verdict mark's three totals (cones, sacks, kilograms), which is the figure
 * that gets signed for. Nothing here is computed twice: both periods go
 * through the same services the other reports use (report.ts, weights.ts,
 * weightStations.ts, the register), so a KPI on this page equals the figure
 * on the page it came from.
 *
 * THE KPI SET IS THE DEVELOPER'S PROPOSAL, awaiting IFL (Q12 / Q33–37): the
 * roadmap's Phase 8 acceptance is that IFL approves the definitions, and no
 * approval has been given. Every row carries `approval: 'awaiting'`, on the
 * page, in the CSV and in the definitions sheet, until it has.
 *
 * WHAT A DELTA MEANS AND DOES NOT. "Up 4 %" is the change in the figure,
 * not a judgement of it: a rise in cones weighed is good, a rise in the
 * reject rate is not, and a rise in "days with data" may only mean the
 * source was down last month. `betterWhen` states which direction is the
 * good one, or 'neither' when the number is a fact with no good direction
 * (a mean weight, a count of days). A period with no readings gives a null
 * prior and a null delta — never "down 100 %".
 */
import type { ConnectionPool } from 'mssql';
import { getReport, type ReportData, type ResolvedPeriod } from '../report.js';
import { listEvents } from '../register.js';
import { getWeights } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { delta, pct, priorPeriod, round, type DayRange, type Delta, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

export type KpiUnit = 'cones' | 'sacks' | 'kg' | 'g' | '%' | 'days' | 'stations' | 'seconds' | 'stops' | 'readings';
export type BetterWhen = 'higher' | 'lower' | 'neither';

export interface KpiDefinition {
  key: string;
  label: string;
  unit: KpiUnit;
  betterWhen: BetterWhen;
  /** One sentence; the SQL-level formula is in KPI-DEFINITIONS.md under the same key. */
  definition: string;
}

/** The order the summary prints them in. Keys match KPI-DEFINITIONS.md. */
export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  { key: 'cones_weighed', label: 'Cones weighed', unit: 'cones', betterWhen: 'higher', definition: 'Cone readings in the period.' },
  { key: 'cones_in_range_pct', label: 'Cones in range', unit: '%', betterWhen: 'higher', definition: 'Share of cone readings the scale marked in range.' },
  { key: 'cones_rejected_by_scale', label: 'Rejected by the scale', unit: 'cones', betterWhen: 'lower', definition: 'Cone readings the scale marked out of range.' },
  { key: 'rejects_at_inspection', label: 'Rejected at inspection', unit: 'cones', betterWhen: 'lower', definition: 'Cones the inspection stations rejected before they were weighed as cones.' },
  { key: 'inspection_reject_rate_pct', label: 'Inspection reject rate', unit: '%', betterWhen: 'lower', definition: 'Inspection rejects over cones plus inspection rejects.' },
  { key: 'cones_within_limits_pct', label: 'Within product limits', unit: '%', betterWhen: 'higher', definition: 'Cones classified within the limits in force at their own time, over cones that could be judged.' },
  { key: 'mean_cone_weight_g', label: 'Mean cone weight', unit: 'g', betterWhen: 'neither', definition: 'Average recorded cone weight over the plausible population.' },
  { key: 'cone_weight_sd_g', label: 'Cone weight spread', unit: 'g', betterWhen: 'lower', definition: 'Standard deviation of recorded cone weight over the plausible population.' },
  { key: 'implausible_readings', label: 'Implausible readings excluded', unit: 'readings', betterWhen: 'lower', definition: 'Cone readings outside the plausibility window, excluded from every weight figure.' },
  { key: 'sacks_weighed', label: 'Sacks weighed', unit: 'sacks', betterWhen: 'higher', definition: 'Sack readings in the period.' },
  { key: 'sack_weight_kg', label: 'Sack weight', unit: 'kg', betterWhen: 'higher', definition: 'Sum of recorded sack weight, under the weight rule’s basis.' },
  { key: 'avg_sack_kg', label: 'Average sack', unit: 'kg', betterWhen: 'neither', definition: 'Sack weight divided by sacks weighed.' },
  { key: 'cones_per_sack', label: 'Cones per sack (approx.)', unit: 'cones', betterWhen: 'neither', definition: 'Cones weighed divided by sacks weighed — an approximation, no cone is keyed to its sack.' },
  { key: 'time_lost_seconds', label: 'Time lost', unit: 'seconds', betterWhen: 'lower', definition: 'Sum of gaps between consecutive cones longer than the stop threshold.' },
  { key: 'stoppages', label: 'Stoppages', unit: 'stops', betterWhen: 'lower', definition: 'Count of gaps between consecutive cones longer than the stop threshold.' },
  { key: 'stations_flagged', label: 'Stations flagged for drift', unit: 'stations', betterWhen: 'lower', definition: 'Stations whose daily means failed a pattern test inside a qualifying run against the line.' },
  { key: 'days_with_data', label: 'Days with readings', unit: 'days', betterWhen: 'neither', definition: 'Production days in the period holding at least one cone reading.' },
];

export interface KpiRow extends KpiDefinition {
  current: number | null;
  prior: number | null;
  delta: Delta | null;
  approval: 'awaiting';
}

export interface ManagementSummaryData {
  period: ResolvedPeriod;
  prior: DayRange;
  coverage: { current: ReportData['coverage']; prior: ReportData['coverage'] };
  kpis: KpiRow[];
  /** The verdict mark's figures for the period: what is signed for. */
  verdict: { cones: number; sacks: number; sackWeightKg: number };
  approval: 'awaiting';
  note: string;
}

interface PeriodFigures {
  coverage: ReportData['coverage'];
  values: Record<string, number | null>;
  totals: ReportData['totals'];
}

async function figuresFor(pool: ConnectionPool, lineId: number, range: DayRange): Promise<PeriodFigures> {
  const resolved: ResolvedPeriod = { period: 'custom', from: range.from, to: range.to };
  const [report, weights, stations, scaleRejected] = await Promise.all([
    getReport(pool, lineId, resolved),
    getWeights(pool, lineId, 'as_recorded', range.from, range.to),
    getWeightStations(pool, lineId, range.from, range.to),
    listEvents(pool, lineId, 'cone', { from: range.from, to: range.to, inRange: false, page: 1, pageSize: 1, sort: 'time', dir: 'desc' }),
  ]);
  const t = report.totals;
  const empty = report.coverage.daysWithData === 0;
  const st = report.readings?.states ?? null;
  const judged = st ? st.within + st.low + st.high + st.rejected : 0;
  const values: Record<string, number | null> = {
    cones_weighed: t.cones,
    cones_in_range_pct: t.conesInRangePct,
    cones_rejected_by_scale: empty ? null : scaleRejected.total,
    rejects_at_inspection: t.rejectedCones,
    inspection_reject_rate_pct: t.rejectRatePct,
    cones_within_limits_pct: st ? pct(st.within, judged) : null,
    mean_cone_weight_g: weights.cone.avg,
    cone_weight_sd_g: weights.cone.stdev,
    implausible_readings: empty ? null : weights.cone.implausible,
    sacks_weighed: t.sacks,
    sack_weight_kg: t.sackWeightKg,
    avg_sack_kg: t.avgSackKg,
    cones_per_sack: t.conesPerSack,
    time_lost_seconds: report.downtime?.stoppedSeconds ?? null,
    stoppages: report.downtime?.stoppageCount ?? null,
    stations_flagged: empty ? null : stations.stations.filter((s) => s.flagged).length,
    days_with_data: report.coverage.daysWithData,
  };
  // A period with no readings has no figures, only zeros the services print
  // for an empty range; those must not become a prior of 0 and a delta of
  // "up from 0". Null them all except the coverage count itself.
  if (empty) for (const k of Object.keys(values)) if (k !== 'days_with_data') values[k] = null;
  return { coverage: report.coverage, values, totals: t };
}

export async function getManagementSummary(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  _filters: ReportFilters,
): Promise<ManagementSummaryData> {
  const prior = priorPeriod(resolved.from, resolved.to);
  const [cur, prev] = await Promise.all([
    figuresFor(pool, lineId, { from: resolved.from, to: resolved.to }),
    figuresFor(pool, lineId, prior),
  ]);
  const kpis: KpiRow[] = KPI_DEFINITIONS.map((k) => {
    const current = round(cur.values[k.key] ?? null);
    const before = round(prev.values[k.key] ?? null);
    return { ...k, current, prior: before, delta: delta(current, before), approval: 'awaiting' };
  });
  return {
    period: resolved,
    prior,
    coverage: { current: cur.coverage, prior: prev.coverage },
    kpis,
    verdict: { cones: cur.totals.cones, sacks: cur.totals.sacks, sackWeightKg: cur.totals.sackWeightKg },
    approval: 'awaiting',
    note:
      'Each figure is shown beside the same figure for the period of equal length immediately before it. The KPI set and ' +
      'its definitions (KPI-DEFINITIONS.md) are the developer’s proposal and await IFL’s approval.',
  };
}

export const SUMMARY_CSV_HEADERS = [
  'kpi', 'label', 'unit', 'current', 'prior', 'delta', 'delta_pct', 'better_when', 'period', 'prior_period', 'ifl_approval',
] as const;

export function summaryCsv(d: ManagementSummaryData): CsvTable {
  const period = `${d.period.from} to ${d.period.to}`;
  const priorPeriodLabel = `${d.prior.from} to ${d.prior.to}`;
  const rows: CsvRow[] = d.kpis.map((k) => [
    k.key, k.label, k.unit, k.current, k.prior, k.delta?.abs ?? null, k.delta?.pct ?? null, k.betterWhen, period, priorPeriodLabel, k.approval,
  ]);
  return { headers: SUMMARY_CSV_HEADERS, rows };
}
