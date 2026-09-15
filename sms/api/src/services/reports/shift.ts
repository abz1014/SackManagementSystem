/**
 * Shift report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * "This shift" on the old Report printed the whole production day, because
 * `/api/report` took no shift. Now it does (report.ts `getReport(…, shift)`),
 * and this report is that call once per shift: the chosen shift, or all
 * three when none is chosen, each with its totals and its figures on every
 * day of the period, so a manager can read the night shift across the month
 * without subtracting it from the day.
 *
 * The three calls are the SAME function the daily report uses, so a shift's
 * "cones" here is exactly the daily report's by-shift row for that shift.
 * Time lost is not split by shift (report.ts explains why) and the section
 * says so rather than printing a whole-day figure under a shift heading.
 */
import type { ConnectionPool } from 'mssql';
import { SHIFT_CODES, type ShiftCode } from '@sms/shared';
import { getReport, type ReportCoverage, type ReportData, type ReportLine, type ResolvedPeriod } from '../report.js';
import type { ReportFilters } from './common.js';
import { dailyLine, DAILY_CSV_HEADERS } from './daily.js';
import type { CsvRow, CsvTable } from './csv.js';

export interface ShiftSection {
  shift: ShiftCode;
  coverage: ReportCoverage;
  totals: ReportLine;
  byDay: ReportLine[];
  readings: ReportData['readings'];
}

export interface ShiftReportData {
  period: ResolvedPeriod;
  /** The shift asked for, or null when every shift is reported. */
  shift: ShiftCode | null;
  shifts: ShiftSection[];
  shiftCheck: ReportData['shiftCheck'];
  timeLostNote: string;
}

export async function getShiftReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
): Promise<ShiftReportData> {
  const wanted: ShiftCode[] = filters.shift ? [filters.shift] : [...SHIFT_CODES];
  const reports = await Promise.all(wanted.map((s) => getReport(pool, lineId, resolved, s)));
  return {
    period: resolved,
    shift: filters.shift ?? null,
    shifts: reports.map((r, i) => ({
      shift: wanted[i]!,
      coverage: r.coverage,
      totals: r.totals,
      byDay: r.byDay,
      readings: r.readings,
    })),
    // The same check for every shift (it is a line-wide, per-day comparison).
    shiftCheck: reports[0]?.shiftCheck ?? null,
    timeLostNote:
      'Time lost is not split by shift: a stoppage is a gap between consecutive cones over the whole day, ' +
      'and a gap across a shift boundary belongs to neither shift. The daily report carries the whole-day figure.',
  };
}

export function shiftCsv(d: ShiftReportData): CsvTable {
  const rows: CsvRow[] = [];
  for (const s of d.shifts) {
    rows.push(dailyLine(`${s.shift}:total`, s.totals));
    for (const day of s.byDay) rows.push(dailyLine(`${s.shift}:day`, day));
  }
  return { headers: DAILY_CSV_HEADERS, rows };
}
