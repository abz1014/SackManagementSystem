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
 * a file this pass did not own then (`register.ts` was not one of the three
 * files that remediation wave assigned to a parallel worker either; it was a
 * genuine gap, reported, not silently absorbed). Rather than print a pooled
 * count beside `report.totals`, which IS already generation-scoped
 * (`report.ts`'s `getReport`, a held file this pass reads but does not
 * edit), this report ran its OWN scoped count directly against
 * `sms.cone_event` in the meantime.
 *
 * WS-CN (23 Sep 2026) SWITCHES THIS TO `register.ts`'s `countEvents`, now
 * that `register.ts` is owned again and has its own scoped, tested count
 * function (410c179) — the fix this file's own comment above said it should
 * eventually call. `countEvents` resolves `resolveGenerationScope` on the
 * exact same `(lineId, from, to)` key this file used to resolve for
 * `generationNote` below, over the same `['cone_event']` table set, so the
 * separate `resolveGenerationScope` call this file made is now redundant —
 * `countEvents`'s own returned `note` IS `generationNote` (proved equal in
 * `reports.test.ts`'s daily-report describe block, not assumed). No second
 * implementation of one count is kept beside the shared one: see
 * `countEvents`'s own doc for why splitting it out of `listEvents` in the
 * first place was so a caller after a bare figure would have exactly one
 * correct path, rather than a pooled one and a private one drifting apart
 * the way `listEvents`/this file's old query already had.
 */
import type { ConnectionPool } from 'mssql';
import { countEvents } from '../register.js';
import { getReport, type ReportData, type ReportLine, type ResolvedPeriod } from '../report.js';
import { pct, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import type { GenerationNote } from '../generation.js';
import type { ShiftRange } from '../../shiftRange.js';

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
  /** RT-002/RT-029: the scope `byScale` (via `countEvents`) was resolved and bound to. */
  generationNote: GenerationNote;
}

export async function getDailyReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  /** Chart overhaul wave 2 (Task TB2, 28 Sep 2026). */
  shiftRange?: ShiftRange,
): Promise<DailyReportData> {
  const shift = filters.shift ?? null;
  const { from, to } = resolved;
  // `countEvents` resolves its OWN `resolveGenerationScope` over exactly
  // this `(lineId, from, to)` key, on `['cone_event']` — the same call this
  // file used to make separately for `generationNote`. Its returned `note`
  // IS that same value (register.ts's `countEvents` returns `noteOf(scope)`
  // from the identical scope resolution), so the extra call is gone rather
  // than duplicated. WS-CN: `scaleCount.dataIssues` is NOT consumed here —
  // `countEvents` already guards the NaN-on-absent-column defect (readNum)
  // so `byScale` never silently becomes a fabricated 0 from a malformed row,
  // but surfacing "this count could not be confirmed" on the daily REPORT's
  // own printed figure/CSV is a UI decision for whoever owns this report's
  // rendering, out of this pass's two-file (Sacks.tsx, daily.ts) scope —
  // flagged, not fixed, the way this file already flags other known gaps.
  const [report, scaleCount] = await Promise.all([
    getReport(pool, lineId, resolved, shift, shiftRange),
    countEvents(pool, lineId, 'cone', { from, to, shift: shift ?? undefined, inRange: false, shiftRange }),
  ]);
  const byScale = scaleCount.count;
  const cones = report.totals.cones;
  const atInspection = report.totals.rejectedCones;
  return {
    ...report,
    generationNote: scaleCount.note,
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
