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
export function downloadCsv(filename: string, headers: string[], rows: CsvRow[]): void {
  const csv = toCsv(headers, rows);
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

/** Filename stem carrying the view and the exact range, so files stay tellable apart. */
export function csvName(view: string, from?: string | null, to?: string | null): string {
  const span = from && to ? (from === to ? from : `${from}_to_${to}`) : new Date().toISOString().slice(0, 10);
  return `sms-${view}-${span}`;
}
