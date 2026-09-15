/**
 * A dependency-free .xlsx writer — roadmap Phase 8 extended on IFL's answer
 * of 15 Sep 2026 to Q33–37 ("Excel AND PDF, designed, with graphics").
 *
 * WHY NO LIBRARY. The plant PC is air-gapped and every dependency is a
 * decision (CLAUDE.md working rule 4); the wave's rule is "no new npm
 * dependency". An .xlsx file is a zip of a dozen small XML parts, and Node
 * ships the only hard part — deflate — in zlib. Everything else is here:
 * the zip container (local file headers, the central directory, the end
 * record — the format's own spec, APPNOTE.TXT), a CRC-32 (the table in
 * `crcTable`, polynomial 0xEDB88320), and the minimal OOXML parts Excel and
 * LibreOffice need:
 *
 *   [Content_Types].xml           what each part is
 *   _rels/.rels                   package → workbook
 *   xl/workbook.xml               the sheet list
 *   xl/_rels/workbook.xml.rels    workbook → sheets, styles
 *   xl/styles.xml                 one bold font (the header row) and the
 *                                 number formats 0 · 0.0 · 0.0% · yyyy-mm-dd hh:mm
 *   xl/worksheets/sheetN.xml      one per sheet: a frozen header row, column
 *                                 widths, inline strings (no sharedStrings
 *                                 part — inline strings are one part fewer
 *                                 and no bookkeeping)
 *
 * WHAT A CELL BECOMES. Text is an inline string, XML-escaped. A number is a
 * number with the integer or one-decimal style. A percent column holds the
 * FRACTION (12.3 % is stored as 0.123 with the 0.0% format), so the sheet
 * reads "12.3%" and a formula over it is right. A date column holds the
 * Excel serial (days since 1899-12-30) of the ISO instant's UTC fields —
 * production times are the plant's wall clock labelled UTC, so the sheet
 * shows the time the plant was keeping. A boolean is TRUE/FALSE (t="b").
 * Null is an empty cell, not the string "null".
 *
 * Sheet 1 is always the report header — line, period, filters, generated at
 * (plant time) and by, SMS version, the definitions sheet and the IFL
 * approval state — so the workbook is attributed the way the CSV's trailing
 * rows and the printed page are (reports/csv.ts explains why).
 */
import { deflateRawSync } from 'node:zlib';
import type { ReportHeader, ReportType } from './common.js';
import { attributionRows, type CsvCell, type CsvTable } from './csv.js';
import type { ReportDataByType } from './index.js';
import type { MachineProductReportData } from './machineProduct.js';

/* ------------------------------------------------------------------ types */

export type ColumnType = 'text' | 'number' | 'integer' | 'percent' | 'date' | 'boolean';

export interface SheetColumn {
  header: string;
  key: string;
  type: ColumnType;
  /** Character width; a sensible default per type when absent. */
  width?: number;
}

export interface Sheet {
  /** ≤ 31 characters, none of []:*?/\ — the writer sanitises. */
  name: string;
  columns: SheetColumn[];
  rows: Record<string, CsvCell | Date>[];
  /** Freeze the header row (default true). */
  freeze?: boolean;
}

export interface WorkbookMeta {
  /** Application name for docProps — informational only. */
  creator?: string;
}

/* ---------------------------------------------------------------- CRC-32 */

const crcTable: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard CRC-32 (IEEE 802.3), as the zip format requires. crc32("123456789") = 0xCBF43926. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------- zip */

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** MS-DOS time and date fields for the zip headers, from a UTC instant. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/**
 * The zip container, written by hand: for each entry a local file header
 * followed by the deflated bytes; then the central directory, one record per
 * entry pointing back at its local header; then the end-of-central-directory
 * record. Method 8 (deflate) throughout — `deflateRawSync` gives the raw
 * stream without the zlib wrapper, which is what zip stores. No data
 * descriptors, no zip64: a report workbook is kilobytes.
 */
export function buildZip(entries: readonly ZipEntry[], stamp = new Date()): Buffer {
  const { time, date } = dosDateTime(stamp);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const packed = deflateRawSync(e.data, { level: 6 });
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6); // flags: bit 11, UTF-8 names
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    name.copy(local, 30);
    locals.push(local, packed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + packed.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries total
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...locals, ...centrals, end]);
}

/* ------------------------------------------------------------------ OOXML */

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Control characters other than tab/LF/CR are not representable in XML 1.0; drop them. */
function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return xmlEscape(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));
}

/** "A", "Z", "AA", … for a zero-based column index. */
export function columnLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Excel's serial date: days since 1899-12-30 on the 1900 system, from the
 * instant's UTC fields (the plant's wall clock for a production time).
 */
export function excelSerial(d: Date): number {
  return d.getTime() / 86_400_000 + 25_569;
}

/** Cell style indexes into styles.xml's cellXfs, in the order written there. */
const STYLE = { plain: 0, bold: 1, integer: 2, number: 3, percent: 4, date: 5 } as const;

const DEFAULT_WIDTH: Record<ColumnType, number> = { text: 18, number: 12, integer: 10, percent: 10, date: 18, boolean: 10 };

/** Excel refuses a sheet name over 31 characters or containing []:*?/\ — and no two may match. */
export function sheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

function cellXml(ref: string, v: CsvCell | Date, type: ColumnType, bold = false): string {
  if (v == null || v === '') return '';
  if (v instanceof Date || type === 'date') {
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(String(v))}</t></is></c>`;
    return `<c r="${ref}" s="${STYLE.date}"><v>${excelSerial(d)}</v></c>`;
  }
  if (typeof v === 'boolean' || type === 'boolean') {
    const b = typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
    return `<c r="${ref}" t="b"><v>${b ? 1 : 0}</v></c>`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (type === 'percent') return `<c r="${ref}" s="${STYLE.percent}"><v>${v / 100}</v></c>`;
    const s = type === 'integer' || Number.isInteger(v) ? STYLE.integer : STYLE.number;
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  const t = `<is><t xml:space="preserve">${xmlText(String(v))}</t></is>`;
  return `<c r="${ref}" t="inlineStr"${bold ? ` s="${STYLE.bold}"` : ''}>${t}</c>`;
}

function worksheetXml(sheet: Sheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? DEFAULT_WIDTH[c.type]}" customWidth="1"/>`)
    .join('');
  const head = sheet.columns.map((c, i) => cellXml(`${columnLetter(i)}1`, c.header, 'text', true)).join('');
  const body = sheet.rows
    .map((row, r) => {
      const cells = sheet.columns.map((c, i) => cellXml(`${columnLetter(i)}${r + 2}`, row[c.key], c.type)).join('');
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join('');
  const freeze = sheet.freeze === false ? '' : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData><row r="1">${head}</row>${body}</sheetData>` +
    `</worksheet>`
  );
}

function stylesXml(): string {
  return (
    `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="4">` +
    `<numFmt numFmtId="164" formatCode="0"/>` +
    `<numFmt numFmtId="165" formatCode="0.0"/>` +
    `<numFmt numFmtId="166" formatCode="0.0%"/>` +
    `<numFmt numFmtId="167" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>` +
    `</numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    // Two fills, the second gray125: Excel treats the first two as reserved and refuses a file without them.
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="6">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function workbookXml(names: string[]): string {
  const sheets = names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(n: number): string {
  const rels = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels}` +
    `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}

function rootRelsXml(): string {
  return `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function contentTypesXml(n: number): string {
  const sheets = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets +
    `</Types>`
  );
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The workbook, as the bytes of an .xlsx file. */
export function buildXlsx(sheets: readonly Sheet[], _meta: WorkbookMeta = {}, stamp = new Date()): Buffer {
  if (sheets.length === 0) throw new Error('a workbook needs at least one sheet');
  const taken = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, taken));
  const parts: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(sheets.length), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml(), 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(names), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml(sheets.length), 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(worksheetXml(s), 'utf8') })),
  ];
  return buildZip(parts, stamp);
}

/* ------------------------------------------------- report → sheets */

/** Sheet 1: the attribution, as key/value rows — the same rows the CSV trails with. */
export function headerSheet(h: ReportHeader): Sheet {
  const rows: Record<string, CsvCell>[] = [];
  for (const [item, value] of attributionRows(h)) {
    rows.push({ item, value });
    // The plant and the unit sit under the line, where a reader looks for them.
    if (item === 'line') {
      if (h.plantName) rows.push({ item: 'plant', value: h.plantName });
      if (h.unitName) rows.push({ item: 'unit', value: h.unitName });
    }
  }
  return {
    name: 'Report',
    columns: [
      { header: 'Item', key: 'item', type: 'text', width: 24 },
      { header: 'Value', key: 'value', type: 'text', width: 60 },
    ],
    rows,
    freeze: false,
  };
}

/**
 * A column's type from its CSV header name, for the generic path: `*_utc`
 * is an instant, `*_pct` a percentage, everything else decided per cell
 * (numbers as numbers, booleans as booleans, the rest as text).
 */
export function columnTypeFor(key: string): ColumnType {
  if (/_utc$/.test(key)) return 'date';
  if (/_pct$/.test(key)) return 'percent';
  return 'number';
}

function titleCase(key: string): string {
  return key.replace(/_/g, ' ').replace(/\butc\b/g, '(plant time)').replace(/\bpct\b/g, '%').replace(/^./, (c) => c.toUpperCase());
}

/**
 * The generic path: one CSV table becomes one sheet per `section` value
 * (the union-of-columns layout csv.ts explains), or a single sheet when the
 * table has no section column. Columns that are empty across the section's
 * rows are dropped, so a section sheet carries only its own columns.
 */
export function sheetsFromCsv(table: CsvTable, singleName: string): Sheet[] {
  const headers = [...table.headers];
  const sectionAt = headers.indexOf('section');
  const groups = new Map<string, CsvRow[]>();
  for (const r of table.rows) {
    const key = sectionAt >= 0 ? String(r[sectionAt] ?? '') : singleName;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  if (groups.size === 0) groups.set(singleName, []);
  const sheets: Sheet[] = [];
  for (const [section, rows] of groups) {
    const keep = headers
      .map((h, i) => i)
      .filter((i) => i !== sectionAt && (rows.length === 0 || rows.some((r) => r[i] != null && r[i] !== '')));
    const columns: SheetColumn[] = keep.map((i) => ({ header: titleCase(headers[i]!), key: headers[i]!, type: columnTypeFor(headers[i]!) }));
    sheets.push({
      name: sectionAt >= 0 ? titleCase(section) : singleName,
      columns,
      rows: rows.map((r) => Object.fromEntries(keep.map((i) => [headers[i]!, r[i] ?? null]))),
    });
  }
  return sheets;
}
type CsvRow = CsvTable['rows'][number];

/**
 * The matrix of the product-by-machine report as a sheet of its own: one
 * row per machine, one column per day × shift, the cell "Product · n cones"
 * (both products when the shift changed over). The generic section sheets
 * (Cell · Change · Product) follow it, so the workbook has the page AND
 * the rows behind it.
 */
export function machineProductSheets(d: MachineProductReportData): Sheet[] {
  const label = (id: number | null) => d.labels[String(id ?? 'none')] ?? (id == null ? 'No product' : `Product ${id}`);
  const columns: SheetColumn[] = [
    { header: 'Machine', key: 'machine', type: 'text', width: 16 },
    ...d.columns.map((c, i) => ({ header: `${c.day} ${c.shift}`, key: `c${i}`, type: 'text' as const, width: 22 })),
    { header: 'Cones', key: 'cones', type: 'integer' },
    { header: 'Products', key: 'products', type: 'integer' },
  ];
  const rows = d.rows.map((r) => {
    const row: Record<string, CsvCell> = { machine: r.machineName ?? r.stationName ?? `Station ${r.station}`, cones: r.cones, products: r.materials };
    r.cells.forEach((cell, i) => {
      row[`c${i}`] = cell ? cell.materials.map((m) => `${label(m.materialId)} · ${m.cones}`).join(' → ') : null;
    });
    return row;
  });
  return [{ name: 'Matrix', columns, rows }];
}

/** Every sheet of a report: the header, any type-specific sheet, then the CSV's sections. */
export function reportSheets<T extends ReportType>(type: T, data: ReportDataByType[T], header: ReportHeader, table: CsvTable): Sheet[] {
  const own = type === 'machine-product' ? machineProductSheets(data as MachineProductReportData) : [];
  return [headerSheet(header), ...own, ...sheetsFromCsv(table, header.title.slice(0, 31))];
}
