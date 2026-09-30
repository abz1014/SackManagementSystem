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
 *   xl/workbook.xml               the sheet list + print-area/print-titles
 *                                 defined names
 *   xl/_rels/workbook.xml.rels    workbook → sheets, styles
 *   xl/styles.xml                 one bold font, a monochrome header fill and
 *                                 bottom border, and the number formats
 *                                 #,##0 · #,##0.0 · 0.0% · yyyy-mm-dd hh:mm
 *   xl/worksheets/sheetN.xml      one per sheet: an optional merged title
 *                                 band, a filled/bordered header row, frozen
 *                                 beneath it, column widths sized to content,
 *                                 inline strings (no sharedStrings part), and
 *                                 (on at most one sheet) a data-bar
 *                                 conditional-formatting rule and/or the
 *                                 workbook's one chart
 *   xl/worksheets/_rels/sheetN.xml.rels, xl/drawings/drawing1.xml,
 *   xl/drawings/_rels/drawing1.xml.rels, xl/charts/chart1.xml
 *                                 present only when a sheet carries `.chart`
 *                                 — U4b below
 *
 * WHAT A CELL BECOMES. Text is an inline string, XML-escaped. A number is a
 * number with the integer or one-decimal style (thousands-separated: a
 * weight reads "1,960", not "1960"). A percent column holds the FRACTION
 * (12.3 % is stored as 0.123 with the 0.0% format), so the sheet reads
 * "12.3%" and a formula over it is right. A date column holds the Excel
 * serial (days since 1899-12-30) of the ISO instant's UTC fields —
 * production times are the plant's wall clock labelled UTC, app-written
 * instants are genuine UTC, and this file converts neither: it renders
 * exactly the UTC calendar fields it is given, so whichever clock a caller
 * fed in is the clock the sheet shows (report.ts / plantClock.ts decide
 * which is right for a given column; this file must not guess). A boolean
 * is TRUE/FALSE (t="b"). Null is an empty cell, not the string "null".
 *
 * Sheet 1 is always the report header — line, period, filters, generated at
 * (plant time) and by, SMS version, the definitions sheet and the IFL
 * approval state — so the workbook is attributed the way the CSV's trailing
 * rows and the printed page are (reports/csv.ts explains why). Every OTHER
 * sheet additionally carries its own two-line title band (U4c): the report
 * name and that sheet's own role, then line · period · generated-at · SMS
 * version — the same facts, restated on the page a reader is actually
 * looking at, in case it is printed or forwarded on its own.
 *
 * ---------------------------------------------------------------- U4a/U4b
 * IFL's own words (15 Sep 2026, relayed in CLAUDE.md): reports "beautiful,
 * Excel AND PDF, with graphics". `dataBarTarget` below names, per report
 * type, the one existing sheet and column that gets an in-cell data bar
 * (`<conditionalFormatting><cfRule type="dataBar">` — no new zip parts, so a
 * malformed rule here is ignored by Excel rather than triggering a repair
 * prompt). `chartSpecFor` extracts that report's own already-printed
 * headline series — never a new figure — into a small dedicated "Chart"
 * sheet, which is the one sheet in the whole workbook allowed a real
 * `<c:barChart>`. Both are monochrome: one grey fill, one grey series colour
 * — the app has exactly one ink fill in the whole product and this file does
 * not introduce a second one.
 */
import { deflateRawSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportHeader, ReportType } from './common.js';
import { attributionRows, type CsvCell, type CsvTable } from './csv.js';
import type { AnyReportData, ReportDataByType } from './index.js';
import type { MachineProductReportData } from './machineProduct.js';

/* ------------------------------------------------------------------ types */

export type ColumnType = 'text' | 'number' | 'integer' | 'percent' | 'date' | 'boolean';

export interface SheetColumn {
  header: string;
  key: string;
  type: ColumnType;
  /** Character width; auto-sized from content when absent (U4c). */
  width?: number;
}

export interface Sheet {
  /** ≤ 31 characters, none of []:*?/\ — the writer sanitises. */
  name: string;
  columns: SheetColumn[];
  rows: Record<string, CsvCell | Date>[];
  /** Freeze the header row (default true). */
  freeze?: boolean;
  /** U4a: column key to draw an in-cell data bar over, across this sheet's own data rows. */
  dataBarKey?: string;
  /**
   * U4b: this sheet IS the one chart's data range — a clustered bar chart
   * drawn from its own `categoryKey`/`valueKey` columns. At most one sheet
   * per workbook may carry this (the writer draws only `chart1.xml`).
   */
  chart?: { title: string; categoryKey: string; valueKey: string; valueLabel: string };
  /**
   * U4c: a merged banner above the header row — report name + this sheet's
   * role, then line/period/generated-at/version. Absent on the attribution
   * sheet itself (`headerSheet`), which already IS that banner.
   */
  titleRows?: string[];
  /** W4: print orientation for this sheet (default landscape). */
  orientation?: 'portrait' | 'landscape';
  /** W4: print footer text, left and centre (the right is always "Page &P of &N"). */
  footerLeft?: string;
  footerCenter?: string;
}

export interface WorkbookMeta {
  /** Application name for docProps — informational only. */
  creator?: string;
  /** W4: logo JPEG bytes for the first sheet; `null` = none, absent = load from the web app's public folder. */
  logo?: Buffer | null;
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
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The one grey this file draws with — no colour palette anywhere in a workbook. */
const MONO_GREY = '808080';
const MONO_HEADER_FILL = 'E8E8E8';

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Control characters other than tab/LF/CR are not representable in XML 1.0; drop them. */
function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return xmlEscape(s.replace(/[ --]/g, ''));
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

/**
 * Cell style indexes into styles.xml's cellXfs, in the order written there.
 * `headerFill` (U4c) is the filled, bordered, bold style for column-header
 * and title-band cells — the monochrome "proper structure" IFL asked for.
 */
const STYLE = {
  plain: 0, bold: 1, integer: 2, number: 3, percent: 4, date: 5, headerFill: 6, text: 7,
  totalText: 8, totalInteger: 9, totalNumber: 10, totalPercent: 11, company: 12, title: 13,
} as const;

/** W4: IFL's own report style (owner-approved 30 Sep 2026). */
const IFL_HEADER_FILL = 'ADD8E6';
const IFL_BORDER = 'D3D3D3';
export const COMPANY_LINE = 'Ibrahim Fibres Limited (Textile Plant 4)';
const LOGO_PX = 80;
const TITLE_ROW_PT = 22;
const EMU_PX = 9525;
const EMU_PT = 12700;

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

function cellXml(ref: string, v: CsvCell | Date, type: ColumnType, styleIndex?: number): string {
  if (v == null || v === '') return styleIndex != null && styleIndex !== STYLE.plain ? `<c r="${ref}" s="${styleIndex}"/>` : '';
  if (v instanceof Date || type === 'date') {
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(String(v))}</t></is></c>`;
    return `<c r="${ref}" s="${styleIndex ?? STYLE.date}"><v>${excelSerial(d)}</v></c>`;
  }
  if (typeof v === 'boolean' || type === 'boolean') {
    const b = typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
    return `<c r="${ref}" t="b" s="${styleIndex ?? STYLE.text}"><v>${b ? 1 : 0}</v></c>`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (type === 'percent') return `<c r="${ref}" s="${styleIndex ?? STYLE.percent}"><v>${v / 100}</v></c>`;
    const s = styleIndex ?? (type === 'integer' || Number.isInteger(v) ? STYLE.integer : STYLE.number);
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  const t = `<is><t xml:space="preserve">${xmlText(String(v))}</t></is>`;
  return `<c r="${ref}" t="inlineStr" s="${styleIndex ?? STYLE.text}">${t}</c>`;
}

/** U4c: the widest header or cell in a column, floor-clamped to the type default, capped so one long value cannot blow out a sheet. */
function autoWidth(col: SheetColumn, rows: Sheet['rows']): number {
  let max = col.header.length;
  for (const row of rows) {
    const v = row[col.key];
    if (v == null || v === '') continue;
    const len = v instanceof Date ? 16 : String(v).length;
    if (len > max) max = len;
  }
  return Math.min(Math.max(max + 2, DEFAULT_WIDTH[col.type]), 60);
}

/** Where a sheet's header row, and its last used row/column, land — shared by the worksheet body and the workbook's print-area/print-titles defined names. */
function sheetExtent(sheet: Sheet): { headerRowNum: number; lastRow: number; lastCol: string } {
  const headerRowNum = (sheet.titleRows?.length ?? 0) + 1;
  return { headerRowNum, lastRow: headerRowNum + sheet.rows.length, lastCol: columnLetter(Math.max(sheet.columns.length - 1, 0)) };
}

function isTotalRow(sheet: Sheet, row: Sheet['rows'][number]): boolean {
  for (const c of sheet.columns) {
    const v = row[c.key];
    if (typeof v === 'string' && v !== '') return /^\s*(grand\s+)?totals?\b/i.test(v);
  }
  return false;
}

/** Where the title text starts: column B when a logo occupies A1:A3, else A. */
function titleStartCol(sheet: Sheet, hasLogo: boolean): string {
  return hasLogo && sheet.columns.length > 1 ? 'B' : 'A';
}

function worksheetXml(sheet: Sheet, hasDrawing: boolean, hasLogo: boolean): string {
  const titleRows = sheet.titleRows ?? [];
  const { headerRowNum, lastCol } = sheetExtent(sheet);
  const startCol = titleStartCol(sheet, hasLogo);

  const cols = sheet.columns
    .map((c, i) => {
      // The logo sits in column A: keep it wide enough to hold it.
      const w = c.width ?? autoWidth(c, sheet.rows);
      return `<col min="${i + 1}" max="${i + 1}" width="${hasLogo && i === 0 ? Math.max(w, 15) : w}" customWidth="1"/>`;
    })
    .join('');

  const titleStyle = (i: number) => (i === 0 ? STYLE.company : i === 1 ? STYLE.title : STYLE.plain);
  const rowAttrs = (i: number) => (hasLogo && i < 3 ? ` ht="${TITLE_ROW_PT}" customHeight="1"` : '');
  const titleXml = titleRows
    .map((text, i) => `<row r="${i + 1}"${rowAttrs(i)}>${cellXml(`${startCol}${i + 1}`, text, 'text', titleStyle(i))}</row>`)
    .join('');
  const mergeCells = titleRows.length
    ? `<mergeCells count="${titleRows.length}">${titleRows.map((_, i) => `<mergeCell ref="${startCol}${i + 1}:${lastCol}${i + 1}"/>`).join('')}</mergeCells>`
    : '';

  const head = sheet.columns.map((c, i) => cellXml(`${columnLetter(i)}${headerRowNum}`, c.header, 'text', STYLE.headerFill)).join('');
  const body = sheet.rows
    .map((row, r) => {
      const rowNum = headerRowNum + 1 + r;
      const total = isTotalRow(sheet, row);
      const cells = sheet.columns
        .map((c, i) => {
          const v = row[c.key];
          const empty = v == null || v === '';
          let style: number | undefined;
          if (total) {
            style =
              c.type === 'percent' ? STYLE.totalPercent
              : c.type === 'date' || v instanceof Date ? undefined
              : typeof v === 'number' ? (c.type === 'integer' || Number.isInteger(v) ? STYLE.totalInteger : STYLE.totalNumber)
              : STYLE.totalText;
          }
          if (empty) style = total ? STYLE.totalText : STYLE.text;
          return cellXml(`${columnLetter(i)}${rowNum}`, v, c.type, style);
        })
        .join('');
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join('');

  // U4c: freeze everything through the header row (title band included), not just row 1.
  const freeze =
    sheet.freeze === false ? '' : `<pane ySplit="${headerRowNum}" topLeftCell="A${headerRowNum + 1}" activePane="bottomLeft" state="frozen"/>`;

  // U4a: one data bar, over exactly the data rows of one named column.
  let conditionalFormatting = '';
  if (sheet.dataBarKey && sheet.rows.length > 0) {
    const colIdx = sheet.columns.findIndex((c) => c.key === sheet.dataBarKey);
    if (colIdx >= 0) {
      const letter = columnLetter(colIdx);
      const from = headerRowNum + 1;
      const to = headerRowNum + sheet.rows.length;
      conditionalFormatting =
        `<conditionalFormatting sqref="${letter}${from}:${letter}${to}">` +
        `<cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${MONO_GREY}"/></dataBar></cfRule>` +
        `</conditionalFormatting>`;
    }
  }

  // W4: margins, per-type orientation fitted to one page wide, and the running footer.
  const pageMargins = `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`;
  const pageSetup = `<pageSetup paperSize="9" orientation="${sheet.orientation ?? 'landscape'}" fitToWidth="1" fitToHeight="0"/>`;
  const amp = (t: string) => t.replace(/&/g, '&&');
  const footer =
    `<headerFooter><oddFooter>${xmlEscape(`&L${amp(sheet.footerLeft ?? 'IFL internal')}&C${amp(sheet.footerCenter ?? '')}&RPage &P of &N`)}</oddFooter></headerFooter>`;
  const drawing = hasDrawing ? '<drawing r:id="rId1"/>' : '';

  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${titleXml}<row r="${headerRowNum}">${head}</row>${body}</sheetData>` +
    mergeCells +
    conditionalFormatting +
    pageMargins +
    pageSetup +
    footer +
    drawing +
    `</worksheet>`
  );
}

function stylesXml(): string {
  const right = `<alignment horizontal="right"/>`;
  const xf = (numFmt: number, font: number, inner = '') =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="0" borderId="1" xfId="0" applyBorder="1"${numFmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${inner ? ' applyAlignment="1">' + inner + '</xf>' : '/>'}`;
  return (
    `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="4">` +
    `<numFmt numFmtId="164" formatCode="#,##0"/>` +
    `<numFmt numFmtId="165" formatCode="#,##0.00"/>` +
    `<numFmt numFmtId="166" formatCode="0.0%"/>` +
    `<numFmt numFmtId="167" formatCode="dd\-mm\-yyyy\ hh:mm"/>` +
    `</numFmts>` +
    `<fonts count="5">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><i/><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="14"/><name val="Calibri"/></font>` +
    `<font><b/><u/><sz val="12"/><name val="Calibri"/></font>` +
    `</fonts>` +
    // Excel treats the first two fills (none, gray125) as reserved; the third is IFL's header blue.
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${IFL_HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    // Border 1: thin light-grey box on all four sides.
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border>` +
    ['left', 'right', 'top', 'bottom'].map((e) => `<${e} style="thin"><color rgb="FF${IFL_BORDER}"/></${e}>`).join('') +
    `<diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="14">` +
    /* 0 plain   */ `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    /* 1 bold    */ `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    /* 2 integer */ xf(164, 0, right) +
    /* 3 number  */ xf(165, 0, right) +
    /* 4 percent */ xf(166, 0, right) +
    /* 5 date    */ xf(167, 0) +
    /* 6 header  */ `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
    /* 7 text    */ xf(0, 0) +
    /* 8 tot txt */ xf(0, 2) +
    /* 9 tot int */ xf(164, 2, right) +
    /* 10 tot num*/ xf(165, 2, right) +
    /* 11 tot pct*/ xf(166, 2, right) +
    /* 12 company*/ `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    /* 13 title  */ `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

/** U4c: `_xlnm.Print_Area` / `_xlnm.Print_Titles`, one pair per sheet, so a print from Excel repeats the header row and does not spill past the used range. */
function definedNamesXml(names: string[], sheets: readonly Sheet[]): string {
  const defs = sheets
    .map((s, i) => {
      const { headerRowNum, lastRow, lastCol } = sheetExtent(s);
      const q = names[i]!.replace(/'/g, "''");
      const area = `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${q}'!$A$1:$${lastCol}$${Math.max(lastRow, headerRowNum)}</definedName>`;
      const titles = `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${q}'!$1:$${headerRowNum}</definedName>`;
      return area + titles;
    })
    .join('');
  return `<definedNames>${defs}</definedNames>`;
}

function workbookXml(names: string[], sheets: readonly Sheet[]): string {
  const sheetEls = names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheetEls}</sheets>${definedNamesXml(names, sheets)}</workbook>`;
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

function contentTypesXml(n: number, hasChart: boolean, hasLogo = false, logoOwnDrawing = false): string {
  const sheets = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  const drawingType = 'application/vnd.openxmlformats-officedocument.drawing+xml';
  const chartParts = hasChart
    ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="${drawingType}"/>` +
      `<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
    : '';
  const logoDrawing = hasLogo && logoOwnDrawing ? `<Override PartName="/xl/drawings/drawing2.xml" ContentType="${drawingType}"/>` : '';
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (hasLogo ? `<Default Extension="jpeg" ContentType="image/jpeg"/>` : '') +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets +
    chartParts +
    logoDrawing +
    `</Types>`
  );
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* --------------------------------------------------------- U4b: the chart */

/** A sheet's worksheet -> drawing relationship. */
function sheetDrawingRelsXml(drawingFile = 'drawing1.xml'): string {
  return `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/${drawingFile}"/></Relationships>`;
}

/** The drawing -> chart (rId1) and -> logo image (rId2 when shared with the chart, else rId1) relationships. */
function drawingRelsXml(chart: boolean, logoRid: string | null): string {
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    (chart ? `<Relationship Id="rId1" Type="${NS_REL}/chart" Target="../charts/chart1.xml"/>` : '') +
    (logoRid ? `<Relationship Id="${logoRid}" Type="${NS_REL}/image" Target="../media/image1.jpeg"/>` : '') +
    `</Relationships>`
  );
}

function chartAnchorXml(): string {
  return (
    `<xdr:twoCellAnchor>` +
    `<xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>22</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro="">` +
    `<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="${NS_CHART}">` +
    `<c:chart xmlns:c="${NS_CHART}" xmlns:r="${NS_REL}" r:id="rId1"/>` +
    `</a:graphicData></a:graphic>` +
    `</xdr:graphicFrame>` +
    `<xdr:clientData/>` +
    `</xdr:twoCellAnchor>`
  );
}

/** The IFL logo, an 80 px square at A1 spanning the three title rows. */
function logoAnchorXml(rid: string): string {
  const size = LOGO_PX * EMU_PX;
  const rowEmu = TITLE_ROW_PT * EMU_PT;
  return (
    `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>0</xdr:col><xdr:colOff>${size}</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>${size - 2 * rowEmu}</xdr:rowOff></xdr:to>` +
    `<xdr:pic>` +
    `<xdr:nvPicPr><xdr:cNvPr id="3" name="IFL logo" descr="Ibrahim Fibres Limited logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip xmlns:r="${NS_REL}" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic>` +
    `<xdr:clientData/>` +
    `</xdr:twoCellAnchor>`
  );
}

/** One drawing part: the chart anchor and/or the logo anchor. */
function drawingXml(chart: boolean, logoRid: string | null): string {
  return (
    `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">` +
    (chart ? chartAnchorXml() : '') +
    (logoRid ? logoAnchorXml(logoRid) : '') +
    `</xdr:wsDr>`
  );
}

/**
 * A single clustered bar chart, monochrome, reading its category/value
 * ranges from the sheet it lives on (`sheetXmlName` is the FINAL, sanitised
 * sheet name — the one `buildXlsx` already assigned — never `sheet.name`
 * itself, which may collide or contain characters Excel refuses in a
 * formula reference). Cached points (`c:strCache`/`c:numCache`) are the same
 * values the live ranges point at, so the chart also renders correctly in a
 * viewer that does not recalculate references.
 */
function chartXml(sheetXmlName: string, sheet: Sheet): string {
  const chart = sheet.chart!;
  const { headerRowNum } = sheetExtent(sheet);
  const n = sheet.rows.length;
  const catCol = columnLetter(Math.max(sheet.columns.findIndex((c) => c.key === chart.categoryKey), 0));
  const valCol = columnLetter(Math.max(sheet.columns.findIndex((c) => c.key === chart.valueKey), 0));
  const from = headerRowNum + 1;
  const to = headerRowNum + n;
  const q = sheetXmlName.replace(/'/g, "''");
  const ref = (col: string) => `'${q}'!$${col}$${from}:$${col}$${to}`;
  const catPts = sheet.rows.map((r, i) => `<c:pt idx="${i}"><c:v>${xmlText(String(r[chart.categoryKey] ?? ''))}</c:v></c:pt>`).join('');
  const valPts = sheet.rows
    .map((r, i) => `<c:pt idx="${i}"><c:v>${typeof r[chart.valueKey] === 'number' ? r[chart.valueKey] : 0}</c:v></c:pt>`)
    .join('');
  return (
    `${XML_HEAD}<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}">` +
    `<c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xmlText(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>` +
    `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
    `<c:ser><c:idx val="0"/><c:order val="0"/>` +
    `<c:tx><c:v>${xmlText(chart.valueLabel)}</c:v></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${MONO_GREY}"/></a:solidFill></c:spPr>` +
    `<c:cat><c:strRef><c:f>${ref(catCol)}</c:f><c:strCache><c:ptCount val="${n}"/>${catPts}</c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${ref(valCol)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${valPts}</c:numCache></c:numRef></c:val>` +
    `</c:ser>` +
    `<c:axId val="111111111"/><c:axId val="222222222"/>` +
    `</c:barChart>` +
    `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>` +
    `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>` +
    `</c:plotArea>` +
    `<c:plotVisOnly val="1"/>` +
    `</c:chart>` +
    `</c:chartSpace>`
  );
}

/**
 * W4: the IFL logo, read at runtime from the web app (WEB_DIST, then the
 * public folder, then paths relative to this module and the working
 * directory). Missing is not fatal: the workbook is built without a logo and
 * one warning is logged.
 */
let logoWarned = false;
export function loadLogo(): Buffer | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.WEB_DIST ? join(resolve(process.env.WEB_DIST), 'ifl-logo.jpg') : null,
    join(process.cwd(), 'web', 'dist', 'ifl-logo.jpg'),
    join(process.cwd(), 'web', 'public', 'ifl-logo.jpg'),
    join(process.cwd(), '..', 'web', 'public', 'ifl-logo.jpg'),
    join(here, '..', '..', '..', '..', 'web', 'dist', 'ifl-logo.jpg'),
    join(here, '..', '..', '..', '..', 'web', 'public', 'ifl-logo.jpg'),
  ].filter((c): c is string => c != null);
  for (const c of candidates) {
    try {
      if (existsSync(c)) return readFileSync(c);
    } catch {
      // unreadable: try the next
    }
  }
  if (!logoWarned) {
    logoWarned = true;
    console.warn('[xlsx] ifl-logo.jpg not found (WEB_DIST, web/dist, web/public); exporting workbooks without the logo');
  }
  return null;
}

/** The workbook, as the bytes of an .xlsx file. */
export function buildXlsx(sheets: readonly Sheet[], meta: WorkbookMeta = {}, stamp = new Date()): Buffer {
  if (sheets.length === 0) throw new Error('a workbook needs at least one sheet');
  const taken = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, taken));
  // At most one sheet carries `.chart`; buildXlsx only ever draws chart1.xml once, at the FIRST sheet that has one.
  const chartIdx = sheets.findIndex((s) => s.chart);
  const hasChart = chartIdx >= 0;
  const logo = meta.logo === undefined ? loadLogo() : meta.logo;
  const hasLogo = logo != null && logo.length > 0;
  // The logo lives on sheet 1. When that sheet also has the chart they share drawing1.xml.
  const logoShared = hasLogo && chartIdx === 0;
  const parts: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(sheets.length, hasChart, hasLogo, hasLogo && !logoShared), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml(), 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(names, sheets), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml(sheets.length), 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(worksheetXml(s, i === chartIdx || (i === 0 && hasLogo), i === 0 && hasLogo), 'utf8'),
    })),
  ];
  if (hasChart) {
    const s = sheets[chartIdx]!;
    const name = names[chartIdx]!;
    parts.push(
      { name: `xl/worksheets/_rels/sheet${chartIdx + 1}.xml.rels`, data: Buffer.from(sheetDrawingRelsXml('drawing1.xml'), 'utf8') },
      { name: 'xl/drawings/drawing1.xml', data: Buffer.from(drawingXml(true, logoShared ? 'rId2' : null), 'utf8') },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: Buffer.from(drawingRelsXml(true, logoShared ? 'rId2' : null), 'utf8') },
      { name: 'xl/charts/chart1.xml', data: Buffer.from(chartXml(name, s), 'utf8') },
    );
  }
  if (hasLogo) {
    if (!logoShared) {
      parts.push(
        { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: Buffer.from(sheetDrawingRelsXml('drawing2.xml'), 'utf8') },
        { name: 'xl/drawings/drawing2.xml', data: Buffer.from(drawingXml(false, 'rId1'), 'utf8') },
        { name: 'xl/drawings/_rels/drawing2.xml.rels', data: Buffer.from(drawingRelsXml(false, 'rId1'), 'utf8') },
      );
    }
    parts.push({ name: 'xl/media/image1.jpeg', data: logo! });
  }
  return buildZip(parts, stamp);
}

/* ------------------------------------------------- report → sheets */

/** Sheet 1: the attribution, as key/value rows — the same rows the CSV trails with. No title band of its own: this sheet already IS one. */
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
    titleRows: titleRowsFor(h, null),
  };
}

/** 'YYYY-MM-DD' (or an ISO instant) as DD-MM-YYYY, unparseable input unchanged. */
export function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/** An ISO instant on the plant clock as "DD-MM-YYYY HH:mm". */
export function ddmmyyyyHm(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : ddmmyyyy(iso);
}

/** W4: the three-row IFL banner: company, report title (with this sheet's role), then the metadata line. */
export function titleRowsFor(header: ReportHeader, sheetTitle: string | null): string[] {
  const shift = header.filters.shift ?? 'All shifts';
  return [
    COMPANY_LINE,
    sheetTitle ? `${header.title} - ${sheetTitle}` : header.title,
    `Line: ${header.lineName} \u00b7 Period: ${ddmmyyyy(header.period.from)} to ${ddmmyyyy(header.period.to)} \u00b7 Shift: ${shift} \u00b7 Generated: ${ddmmyyyyHm(header.generatedAtPlantUtc)} (plant time) \u00b7 SMS v${header.smsVersion.replace(/^v/i, '')}`,
  ];
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

/** `mean_g` → "Mean (g)", `sack_weight_kg` → "Sack weight (kg)" — the unit parenthesised rather than buried as a trailing word. */
function titleCase(key: string): string {
  const base = key.replace(/_/g, ' ').replace(/\butc\b/g, '(plant time)').replace(/\bpct\b/g, '%');
  const withUnit = base.replace(/ kg$/, ' (kg)').replace(/ g$/, ' (g)');
  return withUnit.replace(/^./, (c) => c.toUpperCase());
}

/**
 * The generic path: one CSV table becomes one sheet per `section` value
 * (the union-of-columns layout csv.ts explains), or a single sheet when the
 * table has no section column. Columns that are empty across the section's
 * rows are dropped, so a section sheet carries only its own columns.
 */
export function sheetsFromCsv(table: CsvTable, singleName: string, header: ReportHeader): Sheet[] {
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
    const name = sectionAt >= 0 ? titleCase(section) : singleName;
    sheets.push({
      name,
      columns,
      rows: rows.map((r) => Object.fromEntries(keep.map((i) => [headers[i]!, r[i] ?? null]))),
      titleRows: titleRowsFor(header, name),
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
export function machineProductSheets(d: MachineProductReportData, header: ReportHeader): Sheet[] {
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
  return [{ name: 'Matrix', columns, rows, titleRows: titleRowsFor(header, 'Matrix') }];
}

/* -------------------------------------------------------- U4a: data bars */

/** Column keys that are identifiers, not metrics — never the target of a data bar even when numeric. */
const ID_LIKE_COLUMNS = new Set(['station']);

function firstNumericColumn(sheet: Sheet): string | null {
  const col = sheet.columns.find(
    (c) => (c.type === 'integer' || c.type === 'number') && !ID_LIKE_COLUMNS.has(c.key) && !c.key.endsWith('_id') && !c.key.endsWith('_code'),
  );
  return col ? col.key : null;
}

function byName(sheets: readonly Sheet[], n: string): Sheet | undefined {
  return sheets.find((s) => s.name === n);
}

/**
 * U4a: which existing sheet and column gets the in-cell data bar, per
 * report type — mechanical, matched by sheet name or a distinguishing
 * column, never by report-specific row parsing. `management-summary` is the
 * one exception: its only CSV-derived sheet is the KPI table, every row of
 * which carries `approval: 'awaiting'` (summary.ts), so it is deliberately
 * excluded and the bar lands on the synthetic "Chart" sheet instead (added
 * by `reportSheets` below) — a bar over an unapproved KPI would read as a
 * published metric exactly as a chart of it would.
 */
export function dataBarTarget(type: ReportType, sheets: readonly Sheet[]): { sheetName: string; key: string } | null {
  let sheet: Sheet | undefined;
  switch (type) {
    case 'daily':
      sheet = byName(sheets, 'Day');
      break;
    case 'shift': {
      const days = sheets.filter((s) => s.name.includes(':day'));
      sheet = days.length ? days.reduce((a, b) => (b.rows.length > a.rows.length ? b : a)) : sheets.find((s) => s.name.includes(':total'));
      break;
    }
    case 'product':
      sheet = sheets.find((s) => s.columns.some((c) => c.key === 'product_id'));
      break;
    case 'station':
      // station.ts's CSV carries no `section` column, so its rows land in one singleName sheet;
      // find it by its distinctive columns rather than by name.
      sheet = sheets.find((s) => s.columns.some((c) => c.key === 'vs_target_g') && s.columns.some((c) => c.key === 'station'));
      break;
    case 'cone-weight':
    case 'calibration':
      sheet = byName(sheets, 'Station');
      break;
    case 'reject':
      sheet = byName(sheets, 'Trend') ?? byName(sheets, 'Reason');
      break;
    case 'sack':
      sheet = byName(sheets, 'Day');
      break;
    case 'machine-product':
      sheet = byName(sheets, 'Cell');
      break;
    case 'management-summary':
      sheet = byName(sheets, 'Chart');
      break;
    case 'shift-production':
      sheet = byName(sheets, 'Summary');
      break;
    case 'rejected-cones':
      sheet = byName(sheets, 'Weight range winder');
      break;
    default:
      sheet = undefined;
  }
  if (!sheet || sheet.rows.length === 0) return null;
  const key = firstNumericColumn(sheet);
  return key ? { sheetName: sheet.name, key } : null;
}

/* ------------------------------------------------------------ U4b: chart */

interface ChartPoint {
  category: string;
  value: number;
}
interface ChartSpecResult {
  title: string;
  categoryLabel: string;
  valueLabel: string;
  points: ChartPoint[];
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * U4b: each report type's own already-printed headline series, straight
 * from the report's OWN computed data (never re-derived, never a new
 * figure) — daily/shift: cones per day (or per shift, when several shifts
 * are in the period); product/station/calibration/cone-weight: the
 * mean-weight deviation against target (falling back to against the line,
 * then to plain cone counts, whichever the data actually has); reject: the
 * Pareto's own reason counts; sack: sacks by product; machine-product and
 * management-summary: cones by product (the summary's `productMix`, never
 * its KPI table — see `dataBarTarget`'s note on the same rule).
 */
export function chartSpecFor(type: ReportType, data: unknown): ChartSpecResult | null {
  switch (type) {
    case 'daily': {
      const d = data as ReportDataByType['daily'];
      const points = d.byDay.filter((r) => isNum(r.cones)).map((r) => ({ category: r.group, value: r.cones }));
      return points.length ? { title: 'Cones per day', categoryLabel: 'Day', valueLabel: 'Cones', points } : null;
    }
    case 'shift': {
      const d = data as ReportDataByType['shift'];
      if (d.shifts.length === 1) {
        const s = d.shifts[0]!;
        const points = s.byDay.filter((r) => isNum(r.cones)).map((r) => ({ category: r.group, value: r.cones }));
        return points.length ? { title: `Cones per day — shift ${s.shift}`, categoryLabel: 'Day', valueLabel: 'Cones', points } : null;
      }
      const points = d.shifts.filter((s) => isNum(s.totals.cones)).map((s) => ({ category: `Shift ${s.shift}`, value: s.totals.cones }));
      return points.length ? { title: 'Cones by shift', categoryLabel: 'Shift', valueLabel: 'Cones', points } : null;
    }
    case 'product': {
      const d = data as ReportDataByType['product'];
      const dev = d.rows.filter((r) => isNum(r.vsTargetG));
      if (dev.length) {
        return {
          title: 'Mean weight vs target, by product',
          categoryLabel: 'Product',
          valueLabel: 'vs target (g)',
          points: dev.map((r) => ({ category: r.productLabel, value: r.vsTargetG as number })),
        };
      }
      const points = d.rows.filter((r) => isNum(r.cones)).map((r) => ({ category: r.productLabel, value: r.cones }));
      return points.length ? { title: 'Cones by product', categoryLabel: 'Product', valueLabel: 'Cones', points } : null;
    }
    case 'station': {
      const d = data as ReportDataByType['station'];
      const dev = d.rows.filter((r) => isNum(r.vsTargetG));
      if (dev.length) {
        return {
          title: 'Mean weight vs target, by station',
          categoryLabel: 'Station',
          valueLabel: 'vs target (g)',
          points: dev.map((r) => ({ category: `Station ${r.station}`, value: r.vsTargetG as number })),
        };
      }
      const line = d.rows.filter((r) => isNum(r.vsLineG));
      if (line.length) {
        return {
          title: 'Mean weight vs line, by station',
          categoryLabel: 'Station',
          valueLabel: 'vs line (g)',
          points: line.map((r) => ({ category: `Station ${r.station}`, value: r.vsLineG as number })),
        };
      }
      const points = d.rows.filter((r) => isNum(r.cones)).map((r) => ({ category: `Station ${r.station}`, value: r.cones }));
      return points.length ? { title: 'Cones by station', categoryLabel: 'Station', valueLabel: 'Cones', points } : null;
    }
    case 'reject': {
      const d = data as ReportDataByType['reject'];
      const points = d.reasons.filter((r) => isNum(r.count)).map((r) => ({ category: r.displayLabel, value: r.count }));
      return points.length ? { title: 'Reject reasons (Pareto)', categoryLabel: 'Reason', valueLabel: 'Count', points } : null;
    }
    case 'cone-weight': {
      const d = data as ReportDataByType['cone-weight'];
      const dev = d.byStation.filter((r) => isNum(r.vsTargetG));
      const src = dev.length ? dev : d.byStation.filter((r) => isNum(r.vsLineG));
      if (!src.length) return null;
      return {
        title: dev.length ? 'Mean weight vs target, by station' : 'Mean weight vs line, by station',
        categoryLabel: 'Station',
        valueLabel: dev.length ? 'vs target (g)' : 'vs line (g)',
        points: src.map((r) => ({ category: `Station ${r.station}`, value: (dev.length ? r.vsTargetG : r.vsLineG) as number })),
      };
    }
    case 'sack': {
      const d = data as ReportDataByType['sack'];
      const points = d.byProduct.filter((p) => isNum(p.sacks)).map((p) => ({ category: p.productLabel, value: p.sacks }));
      return points.length ? { title: 'Sacks by product', categoryLabel: 'Product', valueLabel: 'Sacks', points } : null;
    }
    case 'calibration': {
      const d = data as ReportDataByType['calibration'];
      const dev = d.stations.filter((s) => isNum(s.vsTargetG));
      const src = dev.length ? dev : d.stations.filter((s) => isNum(s.vsLineG));
      if (!src.length) return null;
      return {
        title: dev.length ? 'Drift vs target, by station' : 'Drift vs line, by station',
        categoryLabel: 'Station',
        valueLabel: dev.length ? 'vs target (g)' : 'vs line (g)',
        points: src.map((s) => ({ category: `Station ${s.station}`, value: (dev.length ? s.vsTargetG : s.vsLineG) as number })),
      };
    }
    case 'management-summary': {
      const d = data as ReportDataByType['management-summary'];
      const points = d.productMix.current.filter((m) => isNum(m.cones)).map((m) => ({ category: m.label, value: m.cones }));
      return points.length ? { title: 'Cone production by product (current period)', categoryLabel: 'Product', valueLabel: 'Cones', points } : null;
    }
    case 'machine-product': {
      const d = data as ReportDataByType['machine-product'];
      const points = d.products.filter((p) => isNum(p.cones)).map((p) => ({ category: p.label, value: p.cones }));
      return points.length ? { title: 'Cones by product', categoryLabel: 'Product', valueLabel: 'Cones', points } : null;
    }
    case 'shift-production': {
      const d = data as ReportDataByType['shift-production'];
      const points = d.summary.filter((r) => isNum(r.efficiencyPct)).map((r) => ({ category: r.shift, value: r.efficiencyPct as number }));
      return points.length ? { title: 'Efficiency by shift', categoryLabel: 'Shift', valueLabel: 'Efficiency (%)', points } : null;
    }
    case 'rejected-cones': {
      const d = data as ReportDataByType['rejected-cones'];
      const points = d.weightRange.byWinder.filter((r) => isNum(r.avgG)).map((r) => ({ category: `Winder ${r.winder}`, value: r.avgG as number }));
      return points.length ? { title: 'Average cone weight by winder', categoryLabel: 'Winder', valueLabel: 'Average (g)', points } : null;
    }
    default:
      return null;
  }
}

/** The two IFL SSRS-style report types print portrait; the rest landscape. */
const PORTRAIT_TYPES: ReadonlySet<ReportType> = new Set<ReportType>(['shift-production', 'rejected-cones']);

/** Every sheet of a report: the header, any type-specific sheet, the CSV's sections, then — when the data has one — the one chart sheet. The data bar lands last, on whichever of those sheets `dataBarTarget` names. */
export function reportSheets<T extends ReportType>(type: T, data: ReportDataByType[T], header: ReportHeader, table: CsvTable): Sheet[] {
  const own = type === 'machine-product' ? machineProductSheets(data as MachineProductReportData, header) : [];
  const sheets = [headerSheet(header), ...own, ...sheetsFromCsv(table, header.title.slice(0, 31), header)];

  const spec = chartSpecFor(type, data as AnyReportData);
  if (spec) {
    sheets.push({
      name: 'Chart',
      columns: [
        { header: spec.categoryLabel, key: 'category', type: 'text', width: 28 },
        { header: spec.valueLabel, key: 'value', type: 'number' },
      ],
      rows: spec.points.map((p) => ({ category: p.category, value: p.value })),
      titleRows: titleRowsFor(header, 'Chart'),
      chart: { title: spec.title, categoryKey: 'category', valueKey: 'value', valueLabel: spec.valueLabel },
    });
  }

  const target = dataBarTarget(type, sheets);
  if (target) {
    const s = sheets.find((s) => s.name === target.sheetName);
    if (s) s.dataBarKey = target.key;
  }
  // W4: print set-up shared by every sheet of the workbook.
  const orientation = PORTRAIT_TYPES.has(type) ? 'portrait' : 'landscape';
  for (const s of sheets) {
    s.orientation = orientation;
    s.footerLeft = `IFL internal \u00b7 SMS v${header.smsVersion.replace(/^v/i, '')}`;
    s.footerCenter = `Generated ${ddmmyyyyHm(header.generatedAtPlantUtc)} (plant time)`;
  }
  return sheets;
}
