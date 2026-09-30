/**
 * The Report screen's pure logic — roadmap Phase 8 (15 Sep 2026). Kept
 * apart from the components so it can be tested without a DOM: which
 * filters each report type takes, the query a period and a filter set
 * become, and the words a delta is printed with.
 *
 * The filter table mirrors api/src/services/reports/common.ts
 * FILTERS_BY_TYPE: a control the server would refuse (400) is not offered,
 * the same rule App.tsx applies to the register's Export button.
 */
import { periodQuery, type Period } from '../../lib/period';
import type { ReportFilters, ReportQuery, ReportType } from '../../api';

export type FilterName = 'shift' | 'product' | 'station';

export const FILTERS_BY_TYPE: Record<ReportType, readonly FilterName[]> = {
  daily: ['shift'],
  shift: ['shift'],
  product: ['shift', 'station'],
  station: [],
  reject: ['shift', 'station', 'product'],
  'cone-weight': [],
  sack: ['shift'],
  calibration: ['station'],
  'management-summary': [],
  // Shift narrows the columns to one shift per day, station the rows to one
  // machine. No product filter: a cell that hid the other product a machine
  // ran in the same shift would misreport the shift (common.ts:114).
  'machine-product': ['shift', 'station'],
  'shift-production': ['shift'],
  'rejected-cones': ['shift', 'station'],
};

/** The management summary is rank 3 on the server; every other report rank 1. */
export const REPORT_MIN_RANK: Record<ReportType, number> = {
  daily: 1, shift: 1, product: 1, station: 1, reject: 1, 'cone-weight': 1, sack: 1, calibration: 1, 'management-summary': 3,
  'machine-product': 1, 'shift-production': 1, 'rejected-cones': 1,
};
export const EXPORT_MIN_RANK = 3;

export function acceptsFilter(type: ReportType, f: FilterName): boolean {
  return FILTERS_BY_TYPE[type].includes(f);
}

/**
 * The query for a report: the global period's dates, plus only the filters
 * the type accepts. The period's own shift ("This shift") is sent as the
 * shift filter when the type takes one and none was chosen explicitly, so
 * the daily report of "this shift" is that shift — the defect the gap
 * analysis recorded against the old Report ("This shift" printed the whole
 * day). The replay instant goes with every query so the header is stamped
 * with it.
 */
export function queryFor(type: ReportType, period: Period, filters: ReportFilters, at: string | null): ReportQuery {
  const pq = periodQuery(period);
  // T8b (29 Sep 2026): a zoomed shift range (period.key === 'range') must
  // narrow the report the same way it narrows every other screen — from/to
  // alone are production-day bounds and lose the shift-level precision a
  // chart drag selected. fromShift/toShift ride along harmlessly for every
  // other period key, exactly as periodQuery's own doc comment describes.
  const q: ReportQuery = { period: 'custom', from: period.from, to: period.to, at, fromShift: pq.fromShift, toShift: pq.toShift };
  if (acceptsFilter(type, 'shift')) q.shift = filters.shift ?? period.shift ?? null;
  if (acceptsFilter(type, 'station') && filters.station != null) q.station = filters.station;
  if (acceptsFilter(type, 'product') && filters.product != null) q.product = filters.product;
  return q;
}

/** Drop any chosen filter the new type does not take, keep the rest. */
export function filtersFor(type: ReportType, filters: ReportFilters): ReportFilters {
  const out: ReportFilters = {};
  if (acceptsFilter(type, 'shift') && filters.shift) out.shift = filters.shift;
  if (acceptsFilter(type, 'station') && filters.station != null) out.station = filters.station;
  if (acceptsFilter(type, 'product') && filters.product != null) out.product = filters.product;
  return out;
}

/** A stable key for polling: the type, the query, nothing else. */
export function pollKey(type: ReportType, q: ReportQuery): string {
  return `report:${type}:${q.from}:${q.to}:${q.fromShift ?? ''}:${q.toShift ?? ''}:${q.shift ?? ''}:${q.station ?? ''}:${q.product ?? ''}:${q.at ?? ''}`;
}

/**
 * "+120 (+4.2 %)" / "−3 (−1.0 %)" / "0" / "—". The sign is printed so a
 * column of changes reads without a legend; the percentage is omitted when
 * the prior was zero (no ratio) and the whole thing when either side is
 * unknown.
 */
export function fmtDelta(d: { abs: number; pct: number | null } | null, digits = 0): string {
  if (d == null) return '—';
  const sign = d.abs > 0 ? '+' : d.abs < 0 ? '−' : '';
  const abs = Math.abs(d.abs).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (d.abs === 0) return '0';
  if (d.pct == null) return `${sign}${abs}`;
  const pct = Math.abs(d.pct).toFixed(1);
  return `${sign}${abs} (${sign}${pct} %)`;
}

/** Decimal places a KPI's unit is printed with. */
export function digitsFor(unit: string): number {
  switch (unit) {
    case '%': return 1;
    case 'g': return 1;
    case 'kg': return 1;
    default: return 0;
  }
}
