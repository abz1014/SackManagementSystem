/**
 * Client-side CSV export for the analytics views.
 *
 * Deliberately client-side, unlike the register's export. The register can hold
 * 142k rows so it streams from the server under a row cap; an analytics view has
 * already fetched its entire series to draw the chart, so serialising what is
 * on screen needs no new endpoint, no new SQL, and adds no query load. It also
 * guarantees the file matches the chart exactly — the same numbers, the same
 * filters, the same moment — rather than re-querying and possibly disagreeing.
 */

/**
 * A cell beginning with = + - @ or a leading tab/CR is executed as a formula by
 * Excel and Sheets when the file is opened. Mirrors the guard already applied in
 * the server-side register export (api/src/services/register.ts) — the two must
 * agree, or the safety of an export depends on which button produced it.
 */
function escapeCell(v: unknown): string {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvRow = (string | number | boolean | null | undefined)[];

export function toCsv(headers: string[], rows: CsvRow[]): string {
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
}

/**
 * Trigger a download. A BOM is prepended because Excel on Windows otherwise
 * reads UTF-8 as the local codepage and mangles the units and symbols these
 * exports carry (±, σ, µ, °) — the plant runs Windows, so this is the common case.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: CsvRow[],
  /**
   * Attribution, appended after a BLANK LINE rather than as a comment header.
   *
   * A CSV of a signed report carries the figures and nothing else, so the
   * moment it leaves the building it is an unattributed spreadsheet — which is
   * the problem the verdict mark exists to solve. Trailing rows survive Excel
   * and most parsers stop at the blank line; a `#`-prefixed header would show
   * in Excel as a mangled first row, which is worse than no attribution.
   */
  meta?: [string, string][],
): void {
  const body = toCsv(headers, rows);
  const csv = meta && meta.length ? `${body}\n\n${toCsv([], meta.map(([k, v]) => [k, v]))}` : body;
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke on the next tick: revoking synchronously can cancel the download in
  // some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Filename stem carrying the view, the exact range and who exported it.
 *
 * The filename is the first thing anyone sees and costs nothing to read, so it
 * does the everyday attribution work; the trailing rows are there for whoever
 * opens the file properly. Filenames get renamed, which is why it is not the
 * only place the attribution lives.
 */
export function csvName(view: string, from?: string | null, to?: string | null, by?: string | null): string {
  const span = from && to ? (from === to ? from : `${from}_to_${to}`) : new Date().toISOString().slice(0, 10);
  const who = by ? `-${by.toLowerCase().replace(/[^a-z0-9]+/g, '')}` : '';
  return `sms-${view}-${span}${who}`;
}
