/**
 * IFL reports, task H-exports (1 Oct 2026): export hardening D2-D6 and the PDF
 * shift range, proven across the modules that carry them rather than one at a
 * time — the real CSV serialisers of IFL's reports, the real attribution rows,
 * the real workbook writer and the real `buildHeader`.
 *
 *  D2  a percent column holds percent POINTS and keeps its second decimal:
 *      99.96 is stored 0.9996 under 0.00%, never shown as "100.0%".
 *  D3  a data bar is only ever drawn over a quantity: never over an identifier
 *      or a text column, even when the report's registry names that column.
 *  D4  a plant-clock time is written "YYYY-MM-DD HH:mm:ss" — no "T", no "Z" —
 *      in a column named `*_plant_time`, and the workbook reads it as a date.
 *  D5  the UTF-8 BOM is the ROUTE's: `csvDocument` stays BOM-free (the route
 *      test pins the bytes of the real response).
 *  D6  the report's own notes — its method note, its caveats and every
 *      "Assumed until IFL confirms" line — are composed once (`buildHeader`)
 *      and the CSV's trailing rows and the workbook's header sheet carry the
 *      same list; the file name carries the filters and the shift range.
 *  D-49 the PDF render URL carries the shift range (also pdf.test.ts).
 *
 * Fixtures are the smallest data each serialiser reads; they are hand-built so
 * this file does not depend on any report's queries.
 */
import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import type { ConnectionPool } from 'mssql';
import { REPORT_TYPES, type ReportHeader, type ReportType } from './common.js';
import { attributionRows, csvDocument, csvFilename, CSV_BOM, periodText, reportFilename, type CsvTable } from './csv.js';
import { buildXlsx, dataBarTarget, excelSerial, headerSheet, sheetsFromCsv, titleRowsFor, type Sheet } from './xlsx.js';
import { buildHeader } from './header.js';
import { reportNotesOf, IFL_NOTE_TYPES, PENDING_IFL_HEADING } from './notes.js';
import { buildRenderUrl } from './pdf.js';
import { rejectedConesCsv } from './rejectedCones.js';
import { rejectedSacksCsv } from './rejectedSacks.js';
import { rejectedHangersCsv } from './rejectedHangers.js';
import { rejectedUnknownLifterCsv } from './rejectedUnknownLifter.js';
import type { ShiftRange } from '../../shiftRange.js';

/* ----------------------------------------------------------------- helpers */

/** A minimal zip reader for the shape buildZip writes (see xlsx.test.ts). */
function readZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const start = offset + 30 + nameLen + extraLen;
    out.set(name, inflateRawSync(buf.subarray(start, start + compSize)).toString('utf8'));
    offset = start + compSize;
  }
  return out;
}

const workbook = (sheets: Sheet[]): Map<string, string> => readZip(buildXlsx(sheets, { logo: null }));

function header(over: Partial<ReportHeader> = {}): ReportHeader {
  return {
    reportType: 'rejected-cones',
    title: 'List of Rejected Cones Against Weight',
    lineName: 'TP1 Line 3',
    plantName: 'TP1',
    unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-07-03', to: '2026-07-03', days: 1 },
    filters: {},
    generatedAtPlantUtc: '2026-10-01T14:05:09.000Z',
    generatedBy: 'tester',
    smsVersion: 'test-build',
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
    spansGenerations: false,
    sourceGeneration: null,
    otherGenerationExcluded: null,
    ...over,
  };
}

const PERIOD = { period: 'custom', from: '2026-07-03', to: '2026-07-03' } as const;
const NO_GENERATION = { generation: null, spansGenerations: false, otherGenerationExcluded: 0 };

/* The smallest data each of the four time-bearing CSV serialisers reads. */
const T = '2026-07-03T21:32:41.000Z';
const conesData = {
  period: PERIOD, filters: {}, total: 1,
  list: [{
    date: '2026-07-03', shift: 'evening', producedAtUtc: T, winder: 13, hanger: 240, weightG: 2032, productId: 7, productLabel: 'Product A',
    limits: { label: 'Product A', targetG: 1950, loG: 1900, hiG: 2000, lowerBound: false }, noLimitsReason: null, outsideByG: 32,
  }],
  weightRange: {
    line: { n: 5, minG: 1900, maxG: 2032, avgG: 1960 }, byWinder: [{ winder: 13, n: 5, minG: 1900, maxG: 2032, avgG: 1960 }],
    plausibility: { loG: 1500, hiG: 2100 }, excludedImplausible: 0,
  },
  excludedClockFault: 0, listTotal: 1, listCap: 5000,
  note: 'One row per cone rejected on weight.', pendingIfl: ['IFL has not said whether quality rejects belong here.'], generationNote: NO_GENERATION,
};
const sacksData = {
  period: PERIOD, filters: {}, weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 },
  byShift: [], byDay: [], total: { sacks: 10, rejected: 1, rejectedPct: 10, noFlag: 0 },
  rejectedSplit: { implausible: 0, plausible: 1 }, passedRange: { byProduct: [], all: { sacks: 9, minKg: 47, maxKg: 47.4 } },
  list: [{ date: '2026-07-03', shift: 'evening', producedAtUtc: T, sackNum: 5, productId: 7, productLabel: 'Product A', yarnCount: '36', weightKg: 46.2, implausible: false }],
  listTotal: 1, listCap: 5000, excludedClockFault: 0,
  note: 'A rejected sack is one the scale itself marked out of range.', pendingIfl: ['IFL has no sack tolerance on file.'], generationNote: NO_GENERATION,
};
const hangerTotal = { hanger: null, cones: 0, inspected: 0, qualityRejects: 0, weightRejects: 0, total: 0, ratePct: null, flag: null };
const hangersData = {
  period: PERIOD, filters: {}, hangers: [], total: hangerTotal,
  flagging: { canFlag: false, reason: 'too few cones per hanger in this period', lineRatePct: null, hangersJudged: 0, hangersSeen: 0, minInspected: 100, alpha: 0.05 },
  list: [{ hanger: 91, date: '2026-07-03', producedAtUtc: T, shift: 'evening', winder: 4, rejectType: 'quality', reason: 'Tube 3', weightG: null }],
  listTotal: 1, listCap: 5000, excludedClockFault: 0,
  note: 'Rejects per hanger.', pendingIfl: ['IFL has not said what counts as a hanger problem.'], generationNote: NO_GENERATION,
};
const lifterTotal = { lifter: null, cones: 0, inspected: 0, qualityRejects: 0, zeroCodeRejects: 0, weightRejects: 0, total: 0, ratePct: null };
const lifterReject = { lifter: null, date: '2026-07-03', shift: 'evening', producedAtUtc: T, hanger: 12, winder: null, rejectType: 'quality', tubeCode: 0, materialCode: 0, weightG: null, why: ['No lifter recorded'] };
const lifterData = {
  period: PERIOD, filters: {}, lifters: [], total: lifterTotal, unknownCount: 1, list: [lifterReject], zeroCodeList: [],
  zeroedClock: { generation: 'batch 1', rows: [{ ...lifterReject, date: '1969-12-31', producedAtUtc: '1970-01-01T00:00:00.000Z', why: ['Clock zeroed (1970)'] }] },
  listTotal: 1, listCap: 5000, excludedClockFault: 0,
  note: 'Rejects with no lifter number.', pendingIfl: ['IFL has not defined "unknown lifter".'], generationNote: NO_GENERATION,
};

const TIMED: { type: ReportType; table: CsvTable; data: Record<string, unknown> }[] = [
  { type: 'rejected-cones', table: rejectedConesCsv(conesData as never), data: conesData },
  { type: 'rejected-sacks', table: rejectedSacksCsv(sacksData as never), data: sacksData },
  { type: 'rejected-hangers', table: rejectedHangersCsv(hangersData as never), data: hangersData },
  { type: 'rejected-unknown-lifter', table: rejectedUnknownLifterCsv(lifterData as never), data: lifterData },
];

/* ------------------------------------------------------------------- D2 */

describe('D2: a percent column keeps its second decimal, end to end', () => {
  const build = (values: number[]) => {
    const table: CsvTable = { headers: ['section', 'efficiency_pct'], rows: values.map((v) => ['summary', v]) };
    const sheets = sheetsFromCsv(table, 'Summary', header());
    return { sheets, zip: workbook(sheets) };
  };

  it('99.96 is stored as 0.9996 under 0.00% - it can no longer read "100.0%"', () => {
    const { sheets, zip } = build([99.96, 100, 98.5]);
    expect(sheets[0]!.columns.find((c) => c.key === 'efficiency_pct')!.type).toBe('percent');
    expect(zip.get('xl/styles.xml')).toContain('formatCode="0.00%"');
    const xml = zip.get('xl/worksheets/sheet1.xml')!;
    expect(xml).toMatch(/<c r="A\d+" s="14"><v>0\.9996<\/v><\/c>/);
    // 100 and 98.5 sit in the same column and take the same two-decimal format: a column never mixes formats.
    expect(xml).toMatch(/<c r="A\d+" s="14"><v>1<\/v><\/c>/);
    expect(xml).toMatch(/<c r="A\d+" s="14"><v>0\.985<\/v><\/c>/);
    expect(xml).not.toMatch(/<c r="A\d+" s="4">/);
  });

  it('the stored fraction carries no binary noise (99.96 / 100 is 0.9995999999999999 in floating point)', () => {
    const xml = build([99.96]).zip.get('xl/worksheets/sheet1.xml')!;
    expect(xml).not.toContain('0.9995999');
  });

  it('a column whose values all fit one decimal keeps 0.0% and adds no two-decimal format', () => {
    const { zip } = build([99.9, 100, 12.3]);
    expect(zip.get('xl/styles.xml')).not.toContain('formatCode="0.00%"');
    expect(zip.get('xl/worksheets/sheet1.xml')).toMatch(/<c r="A\d+" s="4"><v>0\.999<\/v><\/c>/);
  });
});

/* ------------------------------------------------------------------- D3 */

describe('D3: a data bar is only ever drawn over a quantity', () => {
  const sheet = (name: string, key: string, type: Sheet['columns'][number]['type']): Sheet => ({
    name,
    columns: [{ header: 'Winder', key: 'winder', type: 'id' }, { header: 'Metric', key: 'metric', type: 'integer' }, { header: 'K', key: key, type }],
    rows: [{ winder: 7, metric: 3, [key]: type === 'text' ? 'many' : 5 }],
  });

  it('a registry key that names a TEXT column is not used: the first quantity wins', () => {
    expect(dataBarTarget('rejected-hangers', [sheet('Hanger', 'total_rejects', 'text')])).toEqual({ sheetName: 'Hanger', key: 'metric' });
  });

  it('a registry key that names an IDENTIFIER column is not used either', () => {
    expect(dataBarTarget('rejected-unknown-lifter', [sheet('Lifter', 'total_rejects', 'id')])).toEqual({ sheetName: 'Lifter', key: 'metric' });
  });

  it('an identifier-named column is refused even when its type is a number (a *_id or *_code key, a winder, a hanger)', () => {
    for (const key of ['material_id', 'tube_code', 'hanger', 'winder', 'sack_num']) {
      expect(dataBarTarget('rejected-hangers', [sheet('Hanger', key, 'integer')]), key).toEqual({ sheetName: 'Hanger', key: 'metric' });
    }
  });

  it('a quantity the registry names wins over the first quantity', () => {
    expect(dataBarTarget('rejected-hangers', [sheet('Hanger', 'total_rejects', 'integer')])).toEqual({ sheetName: 'Hanger', key: 'total_rejects' });
  });

  it('in the written workbook the bar sits over the quantity column and over no identifier', () => {
    const table: CsvTable = {
      headers: ['section', 'hanger', 'cones', 'total_rejects'],
      rows: [['hanger', 91, 471, 58], ['hanger', 12, 300, 6]],
    };
    const sheets = sheetsFromCsv(table, 'Hanger', header({ reportType: 'rejected-hangers' }));
    const target = dataBarTarget('rejected-hangers', sheets)!;
    expect(target).toEqual({ sheetName: 'Hanger', key: 'total_rejects' });
    sheets[0]!.dataBarKey = target.key;
    const xml = workbook(sheets).get('xl/worksheets/sheet1.xml')!;
    // columns: A hanger, B cones, C total_rejects — header row 4 (three banner rows), data rows 5-6.
    expect(xml).toMatch(/<conditionalFormatting sqref="C5:C6">/);
    expect(xml).not.toMatch(/<conditionalFormatting sqref="A5/);
  });
});

/* ------------------------------------------------------------------- D4 */

describe('D4: plant-clock times carry no zone marker and are real dates in the workbook', () => {
  it.each(TIMED)('$type: every *_plant_time value is "YYYY-MM-DD HH:mm:ss" - no T, no Z', ({ table }) => {
    const cols = table.headers.map((h, i) => ({ h, i })).filter(({ h }) => h.endsWith('_plant_time'));
    expect(cols.length).toBeGreaterThan(0);
    let seen = 0;
    for (const { i } of cols) {
      for (const row of table.rows) {
        const v = row[i];
        if (v == null || v === '') continue;
        seen++;
        expect(String(v)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it.each(TIMED)('$type: no ISO instant with a Z survives anywhere in the CSV document, trailing rows included', ({ type, table }) => {
    const doc = csvDocument(table.headers, table.rows, header({ reportType: type }));
    expect(doc).not.toMatch(/\d{2}:\d{2}:\d{2}(\.\d+)?Z/);
    expect(doc).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it('the same instant, written as 21:32:41, is the Excel serial of that wall clock - not shifted by the host zone', () => {
    const { table } = TIMED[0]!;
    const sheets = sheetsFromCsv(table, 'x', header());
    const rejected = sheets.find((s) => s.columns.some((c) => c.key === 'produced_at_plant_time'))!;
    expect(rejected.columns.find((c) => c.key === 'produced_at_plant_time')!.type).toBe('date');
    const serial = excelSerial(new Date(Date.UTC(2026, 6, 3, 21, 32, 41)));
    const i = sheets.indexOf(rejected);
    const xml = workbook(sheets).get(`xl/worksheets/sheet${i + 1}.xml`)!;
    expect(xml).toContain(`<v>${serial}</v>`);
  });

  it('the report\'s own "generated at" is the plant wall clock too, in the CSV rows and as a date cell on the header sheet', () => {
    const h = header();
    const row = attributionRows(h).find(([k]) => k === 'generated_at_plant_time')!;
    expect(row[1]).toBe('2026-10-01 14:05:09');
    const cell = headerSheet(h).rows.find((r) => r.item === 'generated_at_plant_time')!;
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).getTime()).toBe(Date.UTC(2026, 9, 1, 14, 5, 9));
  });
});

/* ------------------------------------------------------------------- D5 */

describe('D5: the document is BOM-free; the BOM is the response\'s', () => {
  it.each(TIMED)('$type: csvDocument starts with the first header, not U+FEFF', ({ type, table }) => {
    const doc = csvDocument(table.headers, table.rows, header({ reportType: type }));
    expect(doc.startsWith('section,')).toBe(true);
    expect([...Buffer.from(doc, 'utf8').subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it('CSV_BOM is the three UTF-8 bytes, and prefixing it leaves every non-ASCII character of the notes intact', () => {
    expect([...Buffer.from(CSV_BOM, 'utf8')]).toEqual([0xef, 0xbb, 0xbf]);
    const doc = csvDocument(['a'], [[1]], header({ reportNotes: ['A note with a middle dot ·, a dash — and a curly quote ’.'] }));
    const bytes = Buffer.from(CSV_BOM + doc, 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe(doc);
    expect(doc).toContain('·');
  });
});

/* ------------------------------------------------------------------- D6 */

describe('D6: the report\'s notes are composed once and every surface carries that list', () => {
  const LINE_ROW = {
    line_id: 1, line_code: 'L3', line_name: 'Line 3', display_name: 'TP1 · Line 3 · Unit 2', is_active: true,
    unit_id: 1, unit_code: 'U2', unit_name: 'Unit 2', plant_id: 1, plant_code: 'TP1', plant_name: 'TP1',
  };
  const pool = {
    request: () => ({ input() { return this; }, query: async () => ({ recordset: [LINE_ROW] }) }),
  } as unknown as ConnectionPool;
  const headerFor = (reportType: ReportType, reportData?: unknown) =>
    buildHeader(pool, 1, { reportType, period: PERIOD, filters: {}, user: { username: 'u', displayName: null }, lineNameFallback: 'L', reportData });

  it.each(TIMED)('$type: buildHeader puts reportNotesOf(type, data) on the header - note first, every assumption last', async ({ type, data }) => {
    const h = await headerFor(type, data);
    expect(h.reportNotes).toEqual(reportNotesOf(type, data));
    expect(h.reportNotes![0]).toBe(data.note);
    for (const line of data.pendingIfl as string[]) expect(h.reportNotes).toContain(`${PENDING_IFL_HEADING}: ${line}`);
  });

  it('a header built with no report data, or for one of the earlier ten types, carries no reportNotes key at all', async () => {
    expect('reportNotes' in (await headerFor('rejected-cones'))).toBe(false);
    expect('reportNotes' in (await headerFor('daily', { note: 'x', pendingIfl: ['y'] }))).toBe(false);
    for (const t of REPORT_TYPES.filter((x) => !IFL_NOTE_TYPES.includes(x))) {
      expect('reportNotes' in (await headerFor(t, { note: 'x', pendingIfl: ['y'] })), t).toBe(false);
    }
  });

  it.each(TIMED)('$type: the CSV trails exactly those notes, as report_note rows after the blank line', async ({ type, table, data }) => {
    const h = await headerFor(type, data);
    const doc = csvDocument(table.headers, table.rows, h);
    const tail = doc.slice(doc.indexOf('\n\n'));
    const rows = attributionRows(h).filter(([k]) => k === 'report_note').map(([, v]) => v);
    expect(rows).toEqual(h.reportNotes);
    expect(tail.split('\n').filter((l) => l.startsWith('report_note,')).length).toBe(rows.length);
    // A CSV cell doubles its quotes; the assumption text is otherwise verbatim.
    for (const line of data.pendingIfl as string[]) expect(tail).toContain(line.replace(/"/g, '""'));
    // The figures come first: no report_note row inside the table above the blank line.
    expect(doc.slice(0, doc.indexOf('\n\n'))).not.toContain('report_note,');
  });

  it.each(TIMED)('$type: the workbook\'s header sheet lists the same notes, in the same order, and the written XML contains them', async ({ type, data }) => {
    const h = await headerFor(type, data);
    const sheet = headerSheet(h);
    expect(sheet.rows.filter((r) => r.item === 'report_note').map((r) => r.value)).toEqual(h.reportNotes);
    const xml = workbook([sheet]).get('xl/worksheets/sheet1.xml')!;
    // xmlEscape turns the apostrophes of a note into entities; compare on the unescaped text of the assumption lines.
    const unescaped = xml.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    for (const line of data.pendingIfl as string[]) expect(unescaped).toContain(`${PENDING_IFL_HEADING}: ${line}`);
  });

  it('every pendingIfl line of every one of IFL\'s eight reaches the notes under the shared heading, once', () => {
    for (const type of IFL_NOTE_TYPES) {
      const notes = reportNotesOf(type, { note: 'Method.', pendingIfl: ['One.', 'Two.', 'One.'] });
      expect(notes.filter((n) => n === `${PENDING_IFL_HEADING}: One.`), type).toHaveLength(1);
      expect(notes, type).toContain(`${PENDING_IFL_HEADING}: Two.`);
    }
  });
});

describe('D6: file names carry the filters and the shift range', () => {
  const h = (filters: ReportHeader['filters'] = {}, over: Partial<ReportHeader> = {}) =>
    header({ reportType: 'rejected-hangers', period: { period: 'custom', from: '2026-09-01', to: '2026-09-07', days: 7 }, filters, ...over });
  const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

  it('no filter, no range: unchanged', () => {
    expect(reportFilename(h(), 'csv')).toBe('sms-report-rejected-hangers-2026-09-01_to_2026-09-07.csv');
    expect(reportFilename(h({}, { period: { period: 'pick', from: '2026-09-01', to: '2026-09-01', days: 1 } }), 'xlsx')).toBe('sms-report-rejected-hangers-2026-09-01.xlsx');
  });

  it('shift, station and product, in that order, whatever order the filters object was built in', () => {
    expect(reportFilename(h({ product: 21, station: 7, shift: 'night' }), 'csv')).toBe('sms-report-rejected-hangers-2026-09-01_to_2026-09-07-night-st7-pr21.csv');
    expect(reportFilename(h({ station: 7 }), 'pdf')).toBe('sms-report-rejected-hangers-2026-09-01_to_2026-09-07-st7.pdf');
  });

  it('a missing filter writes nothing, never "undefined" or "null"', () => {
    const name = reportFilename(h({ shift: undefined, station: undefined, product: undefined }), 'csv');
    expect(name).not.toMatch(/undefined|null|NaN/);
    expect(name).toBe('sms-report-rejected-hangers-2026-09-01_to_2026-09-07.csv');
  });

  it('a shift range writes its shifts into the period; one shift is written once', () => {
    expect(reportFilename(h(), 'csv', range)).toBe('sms-report-rejected-hangers-2026-09-02-morning_to_2026-09-03-night.csv');
    expect(reportFilename(h(), 'csv', { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' })).toBe('sms-report-rejected-hangers-2026-09-02-evening.csv');
  });

  it('range, filters and the partial-generation marker compose in a fixed order', () => {
    const partial = h({ shift: 'night', station: 7 }, { spansGenerations: true });
    expect(reportFilename(partial, 'xlsx', range)).toBe('sms-report-rejected-hangers-2026-09-02-morning_to_2026-09-03-night-night-st7-partial-generation.xlsx');
  });

  it('csvFilename takes the range too, and a file name never carries a character a file system rejects', () => {
    expect(csvFilename(h(), range)).toBe(reportFilename(h(), 'csv', range));
    const hostile = reportFilename(h({ shift: 'ni/ght"..' as never }), 'csv');
    expect(hostile).not.toMatch(/[/\\":*?<>|]/);
  });

  it('every report type produces a distinct name for a distinct filter set', () => {
    for (const type of REPORT_TYPES) {
      const names = [{}, { shift: 'morning' as const }, { shift: 'night' as const }, { station: 3 }, { product: 3 }].map((f) => reportFilename(h(f, { reportType: type }), 'csv'));
      expect(new Set(names).size, type).toBe(5);
    }
  });
});

describe('D-49 sibling: the attribution names the shifts when the request was shift-bounded', () => {
  const ranged = header({
    reportType: 'daily', period: { period: 'custom', from: '2026-09-02', to: '2026-09-03', days: 2 },
    periodLabel: '2 Sep morning shift – 3 Sep night shift',
  });
  const plain = header({ reportType: 'daily', period: { period: 'custom', from: '2026-09-02', to: '2026-09-03', days: 2 }, periodLabel: '2026-09-02 to 2026-09-03' });

  it('periodText: the calendar days, then the shifts in plain words; a plain period reads as it always did', () => {
    expect(periodText(ranged)).toBe('2026-09-02 to 2026-09-03 (2 Sep morning shift – 3 Sep night shift)');
    expect(periodText(plain)).toBe('2026-09-02 to 2026-09-03');
    expect(periodText({ period: plain.period })).toBe('2026-09-02 to 2026-09-03');
    expect(periodText({ ...plain, periodLabel: '  ' })).toBe('2026-09-02 to 2026-09-03');
  });

  it('the period row of the CSV and the workbook banner both say so; neither changes for a plain period', () => {
    expect(attributionRows(ranged).find(([k]) => k === 'period')![1]).toBe('2026-09-02 to 2026-09-03 (2 Sep morning shift – 3 Sep night shift)');
    expect(attributionRows(plain).find(([k]) => k === 'period')![1]).toBe('2026-09-02 to 2026-09-03');
    expect(titleRowsFor(ranged, null)[2]).toContain('Period: 02-09-2026 to 03-09-2026 (2 Sep morning shift – 3 Sep night shift)');
    expect(titleRowsFor(plain, null)[2]).toContain('Period: 02-09-2026 to 03-09-2026 · Shift:');
  });
});

/* ----------------------------------------------------------------- D-49 */

describe('D-49: the PDF render URL carries the shift range, and the file name and URL agree on the period', () => {
  const resolved = { period: 'custom', from: '2026-09-02', to: '2026-09-03' } as const;
  const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

  it('a range request is rendered from p=range with the encoded shift references; a plain request from p=pick', () => {
    const ranged = new URL(buildRenderUrl('http://127.0.0.1:4000', 'rejected-cones', resolved, {}, null, range));
    expect([ranged.searchParams.get('p'), ranged.searchParams.get('from'), ranged.searchParams.get('to')]).toEqual(['range', '2026-09-02.morning', '2026-09-03.night']);
    const plain = new URL(buildRenderUrl('http://127.0.0.1:4000', 'rejected-cones', resolved, {}, null));
    expect([plain.searchParams.get('p'), plain.searchParams.get('from'), plain.searchParams.get('to')]).toEqual(['pick', '2026-09-02', '2026-09-03']);
  });

  it('the dates in the URL are the dates in the file name', () => {
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'daily', resolved, {}, null, range));
    const name = reportFilename(header({ reportType: 'daily', period: { period: 'custom', from: '2026-09-02', to: '2026-09-03', days: 2 } }), 'pdf', range);
    expect(name).toContain(`${url.searchParams.get('from')!.replace('.', '-')}_to_${url.searchParams.get('to')!.replace('.', '-')}`);
  });
});
