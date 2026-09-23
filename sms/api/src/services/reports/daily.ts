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
 * The scale-rejected count USED to come from the REGISTER (listEvents with
 * `inRange: false`, total only) so it was by construction the number the
 * Readings screen's "Rejected cones" listing shows. RT-002/RT-029 (23 Sep
 * 2026 red-team audit) found that count inflated ~29x (411 pooled vs 14
 * real) on a window that overlaps the local dev simulator's generation,
 * because `register.ts`'s `listEvents` carries no epoch predicate at all —
 * a file this pass does not own (`register.ts` is not one of the three
 * files this remediation wave assigned to a parallel worker either; it is a
 * genuine gap, reported, not silently absorbed). Rather than print a pooled
 * count beside `report.totals`, which IS already generation-scoped
 * (`report.ts`'s `getReport`, a held file this pass reads but does not
 * edit), this report now runs its OWN scoped count directly against
 * `sms.cone_event`, mirroring `listEvents`' own `in_range = 0` /
 * `shift_code` predicate shape closely enough to still be "the same number
 * Readings would show for a single-generation window" — the drift risk this
 * file's old comment warned against is accepted here as the lesser fault
 * until `register.ts` itself is scoped.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import { getReport, type ReportData, type ReportLine, type ResolvedPeriod } from '../report.js';
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
  /** RT-002/RT-029: the scope `byScale`'s own query below was resolved and bound to. */
  generationNote: GenerationNote;
}

export async function getDailyReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
): Promise<DailyReportData> {
  const shift = filters.shift ?? null;
  const { from, to } = resolved;
  const [report, scope] = await Promise.all([
    getReport(pool, lineId, resolved, shift),
    // RT-002/RT-029: resolved over the same (lineId, from, to) key
    // `report.ts`'s own getReport uses internally, so `byScale` below and
    // `report.totals.cones` agree on which generation they describe.
    resolveGenerationScope(pool, lineId, { from, to }, ['cone_event']),
  ]);
  const scaleReq = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const scaleWhere0 = ['line_id = @line', 'shift_date BETWEEN @from AND @to', 'in_range = 0'];
  if (shift) { scaleWhere0.push('shift_code = @shift'); scaleReq.input('shift', mssql.VarChar(10), shift); }
  const scaleWhere = andEpoch(scaleWhere0.join(' AND '), scaleReq, scope, 'cone_event');
  const scaleRejectedRes = await scaleReq.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sms.cone_event WHERE ${scaleWhere}`,
  );
  const byScale = Number(scaleRejectedRes.recordset[0]?.n ?? 0);
  const cones = report.totals.cones;
  const atInspection = report.totals.rejectedCones;
  return {
    ...report,
    generationNote: noteOf(scope),
    rejectPopulations: {
      byScale,
      byScalePct: pct(byScale, cones),
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
