/**
 * Reject report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * The Rejects screen's three answers composed into one page: the Pareto of
 * reasons (rejects.ts getRejectPareto), the per-day-per-code table
 * (getRejectsByDayCode, Phase 5) and the daily trend with its control band
 * (rejectSpc.ts). Every filter the screen accepts — shift, station, product
 * — is bound through the SAME RejectFilters the screen uses, so the report
 * for "the night shift at station 7" is the screen's own figures.
 *
 * Code MEANINGS are still IFL's to supply (Q12 / Q24); an unnamed code is
 * printed as its raw pair, never as a guess.
 */
import type { ConnectionPool } from 'mssql';
import { getRejectPareto, getRejectsByDayCode, type RejectDayCodeRow, type RejectFilters, type RejectReason } from '../rejects.js';
import { getRejectSpc, type RejectBucket } from '../rejectSpc.js';
import type { ResolvedPeriod } from '../report.js';
import { noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import { round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import type { ShiftRange } from '../../shiftRange.js';

export interface RejectTrendPoint {
  day: string;
  produced: number;
  inspected: number;
  rejects: number;
  ratePct: number | null;
  uclPct: number | null;
  lclPct: number | null;
  /** Above the upper limit (rejectSpc's own one-sided flag). */
  outOfControl: boolean;
  /** Below the lower limit — an unusually GOOD day; printed, never an alarm. */
  belowLower: boolean;
}

export interface RejectReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  total: number;
  /** Pareto of reasons, biggest first. */
  reasons: RejectReason[];
  /** Only on a product-filtered call. */
  unattributed: { rows: number; of: number } | null;
  dayBasis: 'production_day';
  denominator: 'cones_plus_rejects';
  byDayCode: RejectDayCodeRow[];
  trend: RejectTrendPoint[];
  /** p̄ over the period (or the newest generation's when the period spans a rebuild), as a percentage. */
  pBarPct: number | null;
  spansGenerations: boolean;
  /** Verification 25 Sep 2026 (R5-R7): the ONE generation all three sections were read from, and what was excluded. */
  generationNote: GenerationNote;
  note: string;
}

function toFilters(resolved: ResolvedPeriod, f: ReportFilters, shiftRange?: ShiftRange): RejectFilters {
  return { from: resolved.from, to: resolved.to, shift: f.shift, station: f.station, product: f.product, shiftRange };
}

const toPct = (v: number | null): number | null => (v == null ? null : round(v * 100, 2));

export function trendPoint(b: RejectBucket): RejectTrendPoint {
  return {
    day: b.bucketTs.slice(0, 10),
    produced: b.produced,
    inspected: b.inspected,
    rejects: b.rejects,
    // From the counts, not from the 5-dp-rounded `b.rate` (verification
    // 25 Sep 2026, R9: 321/2832 = 11.3347% printed as 11.34% through double
    // rounding 0.11335 → 11.34).
    ratePct: b.rate == null ? null : b.inspected > 0 ? round((b.rejects / b.inspected) * 100, 2) : toPct(b.rate),
    uclPct: toPct(b.ucl),
    lclPct: toPct(b.lcl),
    outOfControl: b.outOfControl,
    belowLower: b.rate != null && b.lcl != null && b.lcl > 0 && b.rate < b.lcl,
  };
}

export async function getRejectReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  /** Chart overhaul wave 2 (Task TB2, 28 Sep 2026); not yet threaded into `getRejectSpc` (rejectSpc.ts, TB1-owned). */
  shiftRange?: ShiftRange,
): Promise<RejectReportData> {
  // One scope for all three sections — the same resolution every other
  // report uses — so the trend cannot carry days (e.g. the plant
  // simulator's) that the Pareto and the per-day table exclude.
  const scope = await resolveGenerationScope(pool, lineId, { from: resolved.from, to: resolved.to });
  const f = { ...toFilters(resolved, filters, shiftRange), scope };
  const [pareto, byDayCode, spc] = await Promise.all([
    getRejectPareto(pool, lineId, f),
    getRejectsByDayCode(pool, lineId, f),
    getRejectSpc(pool, lineId, resolved.from, resolved.to, 'day', 'all', {
      shift: filters.shift,
      station: filters.station,
      product: filters.product,
      scope,
    }),
  ]);
  return {
    period: resolved,
    filters,
    total: pareto.total,
    reasons: pareto.reasons,
    unattributed: pareto.unattributed,
    dayBasis: byDayCode.dayBasis,
    denominator: byDayCode.denominator,
    byDayCode: byDayCode.rows,
    trend: spc.buckets.map(trendPoint),
    pBarPct: toPct(spc.pBar),
    spansGenerations: spc.spansGenerations,
    generationNote: noteOf(scope),
    // Corrected 23 Sep 2026 (reject-denominator brief): "before they were
    // weighed as cones" and "divides by cones plus rejects" both asserted the
    // premise rejectSpc.ts's own header shows is false for 98%+ of rejects —
    // the reject_event row and a cone_event row are usually the same
    // physical cone, weighed then separately rejected. `denominator` above
    // (`cones_plus_rejects`) is byDayCode's own label, not this trend's; the
    // trend divides by cones plus ONLY the rejects with no matching
    // cone_event row, per getRejectSpc.
    note:
      'Rejects are cones the inspection stations rejected. The trend’s rate divides by cones plus only the rejects that were ' +
      'never logged as a weighed cone; most rejects were. Days are production days (06:00 to 06:00 under the line’s shift ' +
      'rule); IFL has not confirmed production day versus calendar date for reject reporting. Code names not yet supplied by ' +
      'IFL are printed as their raw pair.',
  };
}

export const REJECT_CSV_HEADERS = [
  'section', 'day', 'reject_type', 'tube_code', 'material_code', 'label', 'count', 'pct', 'cumulative_pct',
  'cones', 'inspected', 'rate_pct', 'ucl_pct', 'lcl_pct', 'out_of_control',
] as const;

export function rejectCsv(d: RejectReportData): CsvTable {
  const rows: CsvRow[] = [
    ...d.reasons.map((r): CsvRow => [
      'reason', null, r.rejectType, r.tubeCode, r.materialCode, r.displayLabel, r.count, r.pct, r.cumulativePct,
      null, null, null, null, null, null,
    ]),
    ...d.byDayCode.map((r): CsvRow => [
      'day_code', r.day, r.rejectType, r.tubeCode, r.materialCode, r.displayLabel, r.count, null, null,
      r.cones, r.inspected, r.ratePct, null, null, null,
    ]),
    ...d.trend.map((t): CsvRow => [
      'trend', t.day, null, null, null, null, t.rejects, null, null,
      t.produced, t.inspected, t.ratePct, t.uclPct, t.lclPct, t.outOfControl,
    ]),
  ];
  return { headers: REJECT_CSV_HEADERS, rows };
}
