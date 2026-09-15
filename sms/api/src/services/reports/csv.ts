/**
 * CSV serialisation for the report exports — roadmap Phase 8 (15 Sep 2026).
 *
 * The escaping is the register export's (services/register.ts) verbatim: a
 * cell beginning with = + - @ or a leading tab/CR is executed as a formula by
 * Excel and Sheets when the file is opened, so it is prefixed with an
 * apostrophe. The web's client-side csv.ts applies the same guard; the three
 * must agree, or the safety of an export depends on which button produced it
 * (a test pins the escaping here against the register's rules).
 *
 * ATTRIBUTION goes in TRAILING ROWS after a blank line — resolved open
 * question 4 of the 3 Sep 2026 redesign: a `#` comment header shows in Excel
 * as a mangled first row, and a CSV that carries only figures is an
 * unattributed spreadsheet the moment it leaves the building. Most parsers
 * stop at the blank line; anyone who opens the file properly finds the line,
 * the period, who generated it and from which version.
 */
import type { ReportHeader } from './common.js';

export type CsvCell = string | number | boolean | null | undefined;
export type CsvRow = CsvCell[];

export function escapeCell(v: CsvCell | Date): string {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: readonly CsvRow[]): string {
  const lines = rows.map((r) => r.map(escapeCell).join(','));
  return headers.length > 0 ? [headers.map(escapeCell).join(','), ...lines].join('\n') : lines.join('\n');
}

/** The trailing attribution rows, in a fixed order a test can pin. */
export function attributionRows(h: ReportHeader): [string, string][] {
  const filters = Object.entries(h.filters)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return [
    ['report', h.title],
    ['line', h.lineName],
    ['period', `${h.period.from} to ${h.period.to}`],
    ['filters', filters || 'none'],
    ['generated_at_plant_time', h.generatedAtPlantUtc],
    ['generated_by', h.generatedBy],
    ['sms_version', h.smsVersion],
    ['definitions', h.definitions],
    ['ifl_approval', h.approval],
  ];
}

/**
 * A complete CSV document: the table, a blank line, then the attribution.
 * A BOM is NOT prepended here — the route sends `charset=utf-8` and the web
 * client's downloads add one for Excel on Windows; the server file is what a
 * script consumes and a script does not want a BOM.
 */
export function csvDocument(headers: readonly string[], rows: readonly CsvRow[], header: ReportHeader): string {
  return `${toCsv(headers, rows)}\n\n${toCsv([], attributionRows(header))}`;
}

/** `sms-report-<type>-<from>[_to_<to>].<ext>` — the filename does the everyday attribution work. */
export function reportFilename(h: ReportHeader, ext: 'csv' | 'xlsx'): string {
  const span = h.period.from === h.period.to ? h.period.from : `${h.period.from}_to_${h.period.to}`;
  return `sms-report-${h.reportType}-${span}.${ext}`;
}

export function csvFilename(h: ReportHeader): string {
  return reportFilename(h, 'csv');
}

/**
 * ONE table per file, always. A report is several tables (totals, by shift,
 * by day…), and the obvious layout — several header rows separated by blank
 * lines — is exactly what the attribution convention above relies on parsers
 * NOT reading past. So every report CSV has a `section` first column and the
 * union of its tables' columns; a row fills the columns its section has and
 * leaves the rest empty. Ugly in a text editor, faithful in a spreadsheet.
 */
export interface CsvTable {
  headers: readonly string[];
  rows: readonly CsvRow[];
}
