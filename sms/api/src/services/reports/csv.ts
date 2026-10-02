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
import { generationDisclosureLines, SHIFT_SOURCE_NOTE, type ReportHeader } from './common.js';
import { batchName } from '../batchName.js';
import { plantWallClock } from './plantTime.js';
import type { ShiftRange } from '../../shiftRange.js';

/**
 * The UTF-8 byte-order mark. Excel on Windows opens a BOM-less UTF-8 CSV as the system code page and mangles every
 * non-ASCII character (the middle dots, the dashes and the curly quotes of the notes below). The ROUTE's CSV response
 * prefixes this; `csvDocument` itself stays BOM-free, because a script reading the file does not want one (IFL reports D5).
 */
export const CSV_BOM = '\uFEFF';

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

/**
 * Coordinator follow-up (29 Sep 2026): the first pass of the simulator-only
 * disclosure fell back to `h.sourceGeneration` verbatim, which can be the
 * RAW vendor label (e.g. "pack1_TP1U2 gen 4") — it never says the data is
 * simulated. The row must always read in plain words, so this reads
 * `h.generationLine` (buildHeader/header.ts always composes it as
 * "Data batch: … (plant simulator, synthetic data)." for a simulator
 * source) when it already says so, and otherwise builds the same wording
 * from `batchName()` (services/batchName.ts, the one place a generation is
 * named in plain words — "Simulator data batch N", never the raw label)
 * plus the explicit "(plant simulator, synthetic data)" qualifier — so the
 * row can never surface a bare raw table/generation label.
 */
const SIMULATOR_PHRASE = /plant simulator/i;
const SYNTHETIC_PHRASE = /synthetic/i;

/** The trailing digits of a generation label/key, e.g. "pack1_TP1U2 gen 4" or "DATA_TP1U2_SIM#4" → 4; null when none. */
function parseOrdinal(label: string | null): number | null {
  const m = label?.match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : null;
}

function simulatorDisclosureText(h: Pick<ReportHeader, 'generationLine' | 'sourceGeneration'>): string {
  const line = h.generationLine?.trim();
  if (line && SIMULATOR_PHRASE.test(line) && SYNTHETIC_PHRASE.test(line)) {
    return line.replace(/\.\s*$/, '');
  }
  const name = batchName({ ordinal: parseOrdinal(h.sourceGeneration), simulator: true });
  return `Data batch: ${name} (plant simulator, synthetic data)`;
}

/**
 * The period as the attribution states it: the calendar days, and — when the
 * request was shift-bounded — the shifts in plain words after them
 * ("2026-09-02 to 2026-09-03 (2 Sep morning shift – 3 Sep night shift)").
 * `buildHeader` sets `periodLabel` to the plain `from to to` when there is no
 * shift range, so an ordinary report reads exactly as it always did. The CSV,
 * the workbook's header sheet and its banner are built from the shift-bounded
 * figures, and a label naming only whole days over them would misstate what
 * the file holds (IFL reports H-exports, 1 Oct 2026, D-49's sibling).
 */
export function periodText(h: Pick<ReportHeader, 'period' | 'periodLabel'>, fmt: (isoDay: string) => string = (d) => d): string {
  const plain = `${fmt(h.period.from)} to ${fmt(h.period.to)}`;
  const label = h.periodLabel?.trim();
  return label && label !== `${h.period.from} to ${h.period.to}` ? `${plain} (${label})` : plain;
}

/** The trailing attribution rows, in a fixed order a test can pin. */
export function attributionRows(h: ReportHeader): [string, string][] {
  const filters = Object.entries(h.filters)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  const rows: [string, string][] = [
    ['report', h.title],
    ['line', h.lineName],
    ['period', periodText(h)],
    ['filters', filters || 'none'],
    // D4: the plant's wall clock as "YYYY-MM-DD HH:mm:ss", no zone marker — the ISO form's trailing "Z" invited a conversion
    // that moves the time five hours away from what the plant's own clock said. An unparseable value is kept as it came.
    ['generated_at_plant_time', plantWallClock(h.generatedAtPlantUtc) || h.generatedAtPlantUtc],
    ['generated_by', h.generatedBy],
    ['sms_version', h.smsVersion],
    ['definitions', h.definitions],
    ['ifl_approval', h.approval],
    // F-07 (Task W2-C, 29 Sep 2026): always present, not conditional — the
    // shift-derivation caveat applies to every report, not just one that
    // spans a source-generation boundary. Reads the header's own
    // `shiftNote` when set (buildHeader always sets it); falls back to the
    // one constant directly for a hand-built header fixture that predates
    // this field, so the row is never silently missing.
    ['note', h.shiftNote ?? SHIFT_SOURCE_NOTE],
  ];
  // RT24-03 (24 Sep 2026): a report spanning IFL's 2026-08-05 rebuild used to
  // exclude the other generation's readings SILENTLY on every exported
  // surface — the JSON payload already said so (per report type's own
  // `generationNote`), but nobody who only ever opened the CSV/XLSX/PDF saw
  // it. Two more trailing rows, in the same after-the-blank-line block as
  // everything else here (never a comment header — CLAUDE.md's "Open
  // question 4"), added only when there is something to disclose.
  const disclosure = generationDisclosureLines(h);
  if (disclosure) {
    rows.push([disclosure[0], ''], [disclosure[1], '']);
  } else if (h.simulatorSource) {
    // Re-audit fix (Major, 29 Sep 2026): a period entirely covered by the
    // plant simulator excludes nothing, so `spansGenerations` stays false
    // and `generationDisclosureLines` returns null above — but the source
    // itself is still synthetic, and the row must say so in plain words
    // (never a raw vendor table/generation label) — see
    // `simulatorDisclosureText` above.
    rows.push([simulatorDisclosureText(h), '']);
  }
  // D6 (1 Oct 2026): the report's own notes — method, caveats, plausibility window and every "Assumed until IFL confirms"
  // line — one row each, last. The same list the printed page and the workbook's header sheet carry (`ReportHeader.reportNotes`,
  // composed once by notes.ts), so the three can never state different assumptions.
  for (const note of h.reportNotes ?? []) {
    if (typeof note === 'string' && note.trim() !== '') rows.push(['report_note', note]);
  }
  return rows;
}

/**
 * A complete CSV document: the table, a blank line, then the attribution.
 * A BOM is NOT prepended here — the web client's downloads add one for Excel
 * on Windows and the route's CSV response prefixes `CSV_BOM` (above); this
 * string is what a script consumes, and a script does not want a BOM.
 */
export function csvDocument(headers: readonly string[], rows: readonly CsvRow[], header: ReportHeader): string {
  return `${toCsv(headers, rows)}\n\n${toCsv([], attributionRows(header))}`;
}

/**
 * `sms-report-<type>-<from>[_to_<to>][-<shift>][-st<N>][-pr<N>][-partial-generation].<ext>` — the
 * filename does the everyday attribution work. RT24-03 (24 Sep 2026): the
 * `-partial-generation` marker is appended whenever `spansGenerations` is
 * true, so a file that left the building with readings excluded says so
 * before anyone opens it.
 *
 * IFL reports D6 (1 Oct 2026): the report's FILTERS and SHIFT RANGE are in
 * the name too. Two exports of the same report and days — the night shift and
 * the whole day, winder 7 and the whole line — used to land in a downloads
 * folder under one name and overwrite each other, or be told apart only by
 * opening them. `-night`, `-st7` (winder / station 7) and `-pr21` (product 21)
 * come right after the period, in that order. A shift-bounded period
 * (`shiftRange`, the route's decoded `fromShift`/`toShift`) writes its own
 * shifts into the period: `2026-09-02-morning_to_2026-09-03-night` for a range
 * across days and `2026-09-02-morning` for one shift, the same wording the
 * report's own period label uses ("2 Sep morning shift – 3 Sep night shift").
 * The range is a parameter, not a header field, because `ReportHeader` carries
 * only the plain-words label; every caller that has the request has the range.
 */
export function reportFilename(h: ReportHeader, ext: 'csv' | 'xlsx' | 'pdf', shiftRange?: ShiftRange | null): string {
  const span = shiftRange
    ? shiftRange.from === shiftRange.to && shiftRange.fromShift === shiftRange.toShift
      ? `${shiftRange.from}-${shiftRange.fromShift}`
      : `${shiftRange.from}-${shiftRange.fromShift}_to_${shiftRange.to}-${shiftRange.toShift}`
    : h.period.from === h.period.to
      ? h.period.from
      : `${h.period.from}_to_${h.period.to}`;
  const f = h.filters ?? {};
  // A filter value is a validated enum or integer upstream; the clean-up keeps a stray character out of a file name regardless.
  const part = (prefix: string, v: unknown): string => {
    const t = String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return v == null || t === '' ? '' : `-${prefix}${t}`;
  };
  const filters = part('', f.shift) + part('st', f.station) + part('pr', f.product);
  const marker = h.spansGenerations ? '-partial-generation' : '';
  return `sms-report-${h.reportType}-${span}${filters}${marker}.${ext}`;
}

export function csvFilename(h: ReportHeader, shiftRange?: ShiftRange | null): string {
  return reportFilename(h, 'csv', shiftRange);
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
