/**
 * Daily production report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * The one report the application already produced (services/report.ts),
 * with the one thing the gap analysis found wrong with it fixed: its
 * "Rejected" figure counted INSPECTION rejects (`reject_event`, cones the
 * inspection stations rejected — corrected 23 Sep 2026: NOT "before they were
 * weighed as cones", see KPI-DEFINITIONS.md row 4) while the
 * Readings screen's "Rejected cones" counted SCALE rejects (`cone_event` with
 * `in_range = 0`) — two populations under one word, unlabelled, and a manager
 * comparing the two screens had no way to see that they were not the same
 * thing. Both are printed here, each named as what it is.
 *
 * The scale-rejected count comes from the REGISTER (listEvents with
 * `inRange: false`, total only), so it is by construction the number the
 * Readings screen's "Rejected cones" listing shows — not a third query that
 * could drift from it.
 */
import type { ConnectionPool } from 'mssql';
import { getReport, type ReportData, type ReportLine, type ResolvedPeriod } from '../report.js';
import { listEvents } from '../register.js';
import { pct, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

export interface RejectPopulations {
  /** cone_event rows the scale's own bit marked out of range — what Readings lists as "Rejected cones". */
  byScale: number;
  byScalePct: number | null;
  /** reject_event rows — cones the inspection stations threw out; never weighed as a cone. */
  atInspection: number;
  /** atInspection / (cones + atInspection): the one reject-rate rule the application uses. */
  atInspectionPct: number | null;
  note: string;
}

export interface DailyReportData extends ReportData {
  rejectPopulations: RejectPopulations;
}

export async function getDailyReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
): Promise<DailyReportData> {
  const shift = filters.shift ?? null;
  const [report, scaleRejected] = await Promise.all([
    getReport(pool, lineId, resolved, shift),
    listEvents(pool, lineId, 'cone', {
      from: resolved.from,
      to: resolved.to,
      shift: shift ?? undefined,
      inRange: false,
      page: 1,
      pageSize: 1,
      sort: 'time',
      dir: 'desc',
    }),
  ]);
  const cones = report.totals.cones;
  const atInspection = report.totals.rejectedCones;
  return {
    ...report,
    rejectPopulations: {
      byScale: scaleRejected.total,
      byScalePct: pct(scaleRejected.total, cones),
      atInspection,
      atInspectionPct: report.totals.rejectRatePct,
      // "before they were weighed as cones" corrected 23 Sep 2026 — see
      // KPI-DEFINITIONS.md row 4. `atInspectionPct` (report.totals.
      // rejectRatePct, services/report.ts toReportLine) still divides by
      // cones plus EVERY inspection reject, not just the unmatched ones
      // rejectSpc.ts now uses — flagged, not fixed, in KPI-DEFINITIONS.md's
      // note on row 5; this daily report was out of this pass's scope.
      note:
        'Two populations, counted separately: cones the scale itself marked out of range (still weighed, listed on Readings as ' +
        '"Rejected cones"), and cones the inspection stations rejected (the Rejects screen). ' +
        'The scale share is over cones weighed; the inspection rate is over cones plus inspection rejects.',
    },
  };
}

/* ------------------------------------------------------------------ CSV */

export const DAILY_CSV_HEADERS = [
  'section', 'group', 'cones', 'cones_in_range_pct', 'sacks', 'sack_weight_kg', 'avg_sack_kg',
  'cones_per_sack', 'rejected_at_inspection', 'inspection_reject_rate_pct', 'rejected_by_scale',
] as const;

/** One report line as a CSV row; the scale-rejected figure exists only for the total. */
export function dailyLine(section: string, r: ReportLine, byScale: number | null = null): CsvRow {
  return [
    section, r.group, r.cones, r.conesInRangePct, r.sacks, r.sackWeightKg, r.avgSackKg,
    r.conesPerSack, r.rejectedCones, r.rejectRatePct, byScale,
  ];
}

export function dailyCsv(d: DailyReportData): CsvTable {
  const rows: CsvRow[] = [
    dailyLine('total', d.totals, d.rejectPopulations.byScale),
    ...d.byShift.map((r) => dailyLine('shift', r)),
    ...d.byDay.map((r) => dailyLine('day', r)),
  ];
  if (d.downtime) {
    rows.push(['downtime', 'stoppages', d.downtime.stoppageCount, null, null, null, null, null, null, null, null]);
    rows.push(['downtime', 'stopped_seconds', d.downtime.stoppedSeconds, null, null, null, null, null, null, null, null]);
  }
  if (d.readings) {
    rows.push(['readings', 'implausible_excluded', d.readings.implausible, null, null, null, null, null, null, null, null]);
    for (const [state, n] of Object.entries(d.readings.states)) {
      rows.push(['state', state, n, null, null, null, null, null, null, null, null]);
    }
  }
  return { headers: DAILY_CSV_HEADERS, rows };
}
