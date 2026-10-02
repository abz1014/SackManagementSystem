/**
 * IFL reports, export formats D2-D4 (1 Oct 2026): what a CSV and a workbook
 * say about a PERCENTAGE, an IDENTIFIER and a TIMESTAMP.
 *
 *  D2  a percent column holds percent points and shows its second decimal:
 *      99.96 must never read "100.0%".
 *  D3  winder, hanger, lifter, sack number, material id and reason code are
 *      identifiers: no thousands separator, never the target of a data bar;
 *      the generic path infers a column's type from its values.
 *  D4  a plant-clock string "YYYY-MM-DD HH:mm:ss" is a real date cell read
 *      with Date.UTC (never the host's zone), seconds included; the report's
 *      own "generated at" is that string, with no "T" and no "Z".
 *  D5  the BOM constant exists and `csvDocument` itself stays BOM-free.
 *  D6  the report's own notes trail the CSV as `report_note` rows and sit on
 *      the workbook's header sheet.
 */
import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import type { ReportHeader, ReportType } from './common.js';
import { attributionRows, csvDocument, CSV_BOM, type CsvTable } from './csv.js';
import {
  buildXlsx, columnTypeFor, dataBarTarget, excelSerial, headerSheet, inferColumnType, isIdLike, percentDecimals, reportSheets, sheetsFromCsv, type Sheet,
} from './xlsx.js';
import { shiftProductionCsv } from './shiftProduction.js';
import { rejectedConesCsv } from './rejectedCones.js';

/* A minimal zip reader for the shape buildZip writes (see xlsx.test.ts). */
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

function header(over: Partial<ReportHeader> = {}): ReportHeader {
  return {
    reportType: 'shift-production',
    title: 'Shift-wise CTS Loop Production Report',
    lineName: 'TP1 Line 3',
    plantName: 'TP1',
    unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-07-03', to: '2026-07-03', days: 1 },
    filters: {},
    generatedAtPlantUtc: '2026-09-03T10:00:00.000Z',
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

const sheetXml = (zip: Map<string, string>, n: number): string => zip.get(`xl/worksheets/sheet${n}.xml`)!;

/* ------------------------------------------------------------------- D2 */

describe('D2: a percent column keeps its second decimal', () => {
  const col = { header: 'Efficiency', key: 'efficiency_pct', type: 'percent' as const };

  it('percentDecimals: 2 when any value has a second decimal place, else 1', () => {
    expect(percentDecimals(col, [{ efficiency_pct: 99.96 }, { efficiency_pct: 100 }])).toBe(2);
    expect(percentDecimals(col, [{ efficiency_pct: 0.04 }])).toBe(2);
    expect(percentDecimals(col, [{ efficiency_pct: 98.7 }, { efficiency_pct: 100 }, { efficiency_pct: null }])).toBe(1);
    expect(percentDecimals(col, [])).toBe(1);
    // a float that is one decimal place in disguise is not a second place
    expect(percentDecimals(col, [{ efficiency_pct: 0.1 + 0.2 }, { efficiency_pct: 46.9 }])).toBe(1);
  });

  const build = (values: (number | null)[]): Map<string, string> =>
    readZip(buildXlsx([{ name: 'S', columns: [{ header: 'N', key: 'n', type: 'integer' }, col], rows: values.map((v, i) => ({ n: i + 1, efficiency_pct: v })) }], { logo: null }));

  it('99.96 is stored as the fraction 0.9996 under the 0.00% format, not 0.0%', () => {
    const zip = build([99.96, 100]);
    const styles = zip.get('xl/styles.xml')!;
    expect(styles).toContain('formatCode="0.00%"');
    expect(styles).toContain('<cellXfs count="16">');
    expect(styles).toContain('<numFmts count="5">');
    const xml = sheetXml(zip, 1);
    expect(xml).toContain('<v>0.9996</v>');
    // style 14 is the two-decimal percent; the one-decimal percent (4) is not used on this column
    expect(xml).toMatch(/<c r="B2" s="14"><v>0\.9996<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B3" s="14"><v>1<\/v><\/c>/);
    expect(xml).not.toMatch(/<c r="B2" s="4"/);
  });

  it('a workbook whose percentages all fit one decimal is unchanged: no extra format, no extra styles', () => {
    const zip = build([98.7, 100]);
    const styles = zip.get('xl/styles.xml')!;
    expect(styles).not.toContain('0.00%');
    expect(styles).toContain('<cellXfs count="14">');
    expect(styles).toContain('<numFmts count="4">');
    expect(sheetXml(zip, 1)).toMatch(/<c r="B2" s="4"><v>0\.987<\/v><\/c>/);
  });

  it('a total row of a two-decimal column uses the bold two-decimal percent', () => {
    const sheet: Sheet = {
      name: 'S', columns: [{ header: 'Name', key: 'name', type: 'text' }, col],
      rows: [{ name: 'A', efficiency_pct: 99.96 }, { name: 'Total', efficiency_pct: 99.98 }], titleRows: ['x', 'y', 'z'],
    };
    const xml = sheetXml(readZip(buildXlsx([sheet], { logo: null })), 1);
    expect(xml).toMatch(/<c r="B5" s="14"><v>0\.9996<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B6" s="15"><v>0\.9998<\/v><\/c>/);
  });

  it('through the real shift-production CSV: efficiency_pct is a percent column and 99.99 keeps its decimals', () => {
    const f = (pass: number, rej: number) => ({ weighed: pass, pass, weightRejects: rej, total: pass + rej, efficiencyPct: Math.round((10000 * pass) / (pass + rej)) / 100, weighedKg: 15000 });
    const data: any = {
      summary: [{ shift: 'morning', ...f(7922, 1) }], grandTotal: f(7922, 1), rows: [], shiftTotals: [], dayTotals: [], winderTotals: [],
    };
    const sheets = reportSheets('shift-production', data, header(), shiftProductionCsv(data));
    const summary = sheets.find((s) => s.name === 'Summary')!;
    expect(summary.columns.find((c) => c.key === 'efficiency_pct')!.type).toBe('percent');
    expect(summary.rows[0]!.efficiency_pct).toBe(99.99);
    const zip = readZip(buildXlsx(sheets, { logo: null }));
    expect(zip.get('xl/styles.xml')).toContain('formatCode="0.00%"');
  });
});

/* ------------------------------------------------------------------- D3 */

describe('D3: identifiers are not quantities', () => {
  it('isIdLike: the named identifiers and any *_id / *_code', () => {
    for (const k of ['station', 'winder', 'hanger', 'lifter', 'shift', 'date', 'day', 'sack_num', 'yarn_count', 'material_ids', 'scope', 'material_id', 'product_id', 'tube_code', 'material_code']) {
      expect(isIdLike(k), k).toBe(true);
    }
    for (const k of ['weighed', 'weight_g', 'total', 'sacks', 'kg', 'rate_pct', 'n', 'avg_kg']) expect(isIdLike(k), k).toBe(false);
  });

  it('columnTypeFor: ids, percentages and both kinds of instant by name', () => {
    expect(columnTypeFor('winder')).toBe('id');
    expect(columnTypeFor('hanger')).toBe('id');
    expect(columnTypeFor('efficiency_pct')).toBe('percent');
    expect(columnTypeFor('produced_at_plant_time')).toBe('date');
    expect(columnTypeFor('last_adjusted_utc')).toBe('date');
    expect(columnTypeFor('weighed')).toBe('number');
  });

  it('inferColumnType: ids stay ids for numbers and become text for words; other columns follow their values', () => {
    expect(inferColumnType('winder', [1, 13, null])).toBe('id');
    expect(inferColumnType('shift', ['morning', 'night'])).toBe('text');
    expect(inferColumnType('date', ['2026-07-03'])).toBe('text');
    expect(inferColumnType('limits_lower_bound', [true, false, null])).toBe('boolean');
    expect(inferColumnType('weighed', [1, 2, 3])).toBe('integer');
    expect(inferColumnType('weight_g', [2032, 2035.5])).toBe('number');
    expect(inferColumnType('product', ['1,960 +/- 40 g', null])).toBe('text');
    expect(inferColumnType('limits', [])).toBe('number');
    expect(inferColumnType('rate_pct', ['x'])).toBe('percent');
  });

  const table: CsvTable = {
    headers: ['section', 'date', 'shift', 'produced_at_plant_time', 'winder', 'hanger', 'sack_num', 'weight_g', 'limits_lower_bound', 'efficiency_pct', 'sd_kg', 'material_ids'],
    rows: [
      ['rejected_cone', '2026-07-03', 'evening', '2026-07-03 21:32:41', 13, 240, 12345, 2032.5, true, 99.96, 0.06, '1021 1022'],
      ['rejected_cone', '2026-07-04', 'night', '2026-07-04 00:00:05', 6, 1178, 12346, 2035, false, 99.9, 0.05, '1021'],
    ],
  };

  it('the generic path types every column of a table by name and value', () => {
    const [sheet] = sheetsFromCsv(table, 'T', header());
    const type = (k: string) => sheet!.columns.find((c) => c.key === k)!.type;
    expect(type('date')).toBe('text');
    expect(type('shift')).toBe('text');
    expect(type('produced_at_plant_time')).toBe('date');
    expect(type('winder')).toBe('id');
    expect(type('hanger')).toBe('id');
    expect(type('sack_num')).toBe('id');
    expect(type('weight_g')).toBe('number');
    expect(type('limits_lower_bound')).toBe('boolean');
    expect(type('efficiency_pct')).toBe('percent');
    expect(type('material_ids')).toBe('text');
  });

  it('an identifier is a plain number: hanger 1178 and sack 12345 carry no thousands separator, a quantity still does', () => {
    const sheets = sheetsFromCsv(table, 'T', header());
    const zip = readZip(buildXlsx(sheets, { logo: null }));
    const xml = sheetXml(zip, 1);
    const col = (k: string): string => {
      const i = sheets[0]!.columns.findIndex((c) => c.key === k);
      return String.fromCharCode(65 + i);
    };
    // data rows start at row 5 (three title rows + header)
    expect(xml).toMatch(new RegExp(`<c r="${col('hanger')}6" s="7"><v>1178</v></c>`)); // General, bordered: "1178"
    expect(xml).toMatch(new RegExp(`<c r="${col('sack_num')}5" s="7"><v>12345</v></c>`));
    expect(xml).toMatch(new RegExp(`<c r="${col('winder')}5" s="7"><v>13</v></c>`));
    expect(xml).toMatch(new RegExp(`<c r="${col('weight_g')}5" s="3"><v>2032.5</v></c>`)); // #,##0.00
    expect(xml).not.toMatch(new RegExp(`<c r="${col('hanger')}6" s="2"`)); // #,##0 would print "1,178"
  });

  it('the headers read as words: SD (kg), Material IDs, Produced at (plant time)', () => {
    const [sheet] = sheetsFromCsv(table, 'T', header());
    const head = (k: string) => sheet!.columns.find((c) => c.key === k)!.header;
    expect(head('sd_kg')).toBe('SD (kg)');
    expect(head('material_ids')).toBe('Material IDs');
    expect(head('produced_at_plant_time')).toBe('Produced at (plant time)');
    expect(head('weight_g')).toBe('Weight (g)');
  });

  it('a data bar never lands on an identifier, even when it is the first numeric column', () => {
    const t: CsvTable = {
      headers: ['section', 'winder', 'weighed', 'weight_rejects'],
      rows: [['summary', 1, 100, 1], ['summary', 2, 200, 2]],
    };
    const sheets = sheetsFromCsv(t, 'T', header());
    sheets[0]!.name = 'Hanger';
    // 'rejected-hangers' prefers total_rejects, which this table lacks, so the first numeric non-identifier column is used.
    expect(dataBarTarget('rejected-hangers', sheets)).toEqual({ sheetName: 'Hanger', key: 'weighed' });
  });

  it('shift-production names its data-bar column outright: total, on the Summary sheet', () => {
    const f = (pass: number, rej: number) => ({ weighed: pass, pass, weightRejects: rej, total: pass + rej, efficiencyPct: 99, weighedKg: null });
    const data: any = { summary: [{ shift: 'morning', ...f(90, 10) }], grandTotal: f(90, 10), rows: [], shiftTotals: [], dayTotals: [], winderTotals: [] };
    const sheets = reportSheets('shift-production', data, header(), shiftProductionCsv(data));
    expect(dataBarTarget('shift-production', sheets)).toEqual({ sheetName: 'Summary', key: 'total' });
  });
});

describe('D3: the eight IFL reports name their data-bar column outright', () => {
  // sheet name -> key, as the CSV sections of each report produce them (a section `day_total` is the sheet "Day total").
  const EXPECTED: [ReportType, string, string][] = [
    ['shift-production', 'Summary', 'total'],
    ['rejected-cones', 'Weight range', 'n'],
    ['rejected-sacks', 'Day total', 'rejected'],
    ['sps-packing', 'Count total', 'sacks'],
    ['sack-weight-range', 'Spread shift', 'n'],
    ['sack-weight-summary', 'Day total', 'sacks'],
    ['rejected-hangers', 'Hanger', 'total_rejects'],
    ['rejected-unknown-lifter', 'Lifter', 'total_rejects'],
  ];
  // The sheet carries an identifier FIRST and a different metric before the named one: only the explicit key can win.
  const sheetFor = (name: string, key: string): Sheet => ({
    name,
    columns: [
      { header: 'W', key: 'winder', type: 'id' }, { header: 'Other', key: 'zzz_other', type: 'integer' }, { header: 'K', key: key, type: 'integer' },
    ],
    rows: [{ winder: 1, zzz_other: 9, [key]: 5 }],
  });
  it.each(EXPECTED)('%s: the bar is on %s / %s, not on the first numeric column', (type, sheetName, key) => {
    expect(dataBarTarget(type, [sheetFor(sheetName, key)])).toEqual({ sheetName, key });
  });
  it('and falls back to the first numeric non-identifier column when the named key is not on the sheet', () => {
    expect(dataBarTarget('shift-production', [sheetFor('Summary', 'weighed')])).toEqual({ sheetName: 'Summary', key: 'zzz_other' });
  });
});

/* ------------------------------------------------------------------- D4 */

describe('D4: plant-clock timestamps', () => {
  const plantTable: CsvTable = {
    headers: ['section', 'produced_at_plant_time', 'weight_g'],
    rows: [['rejected_cone', '2026-07-03 21:32:41', 2032]],
  };

  it('a produced_at_plant_time cell is the Excel serial of those exact wall-clock fields, whatever zone the host is in', () => {
    const zip = readZip(buildXlsx(sheetsFromCsv(plantTable, 'T', header()), { logo: null }));
    const xml = sheetXml(zip, 1);
    const want = excelSerial(new Date(Date.UTC(2026, 6, 3, 21, 32, 41)));
    const m = /<c r="A5" s="5"><v>([^<]+)<\/v><\/c>/.exec(xml);
    expect(m, xml).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(want, 9);
  });

  it('the date format shows seconds, so two cones weighed in one minute stay distinguishable', () => {
    const styles = readZip(buildXlsx(sheetsFromCsv(plantTable, 'T', header()), { logo: null })).get('xl/styles.xml')!;
    expect(styles).toContain('hh:mm:ss');
  });

  it('generated_at_plant_time is the plant wall clock: no T, no Z, seconds kept', () => {
    const row = attributionRows(header()).find(([k]) => k === 'generated_at_plant_time')!;
    expect(row[1]).toBe('2026-09-03 10:00:00');
    expect(row[1]).not.toMatch(/[TZ]/);
  });

  it('an unparseable generated-at is kept as it came rather than blanked', () => {
    const row = attributionRows(header({ generatedAtPlantUtc: 'not a date' })).find(([k]) => k === 'generated_at_plant_time')!;
    expect(row[1]).toBe('not a date');
  });

  it('the workbook header sheet carries it as a real date cell, the same instant', () => {
    const sheet = headerSheet(header());
    const row = sheet.rows.find((r) => r.item === 'generated_at_plant_time')!;
    expect(row.value).toBeInstanceOf(Date);
    expect((row.value as Date).getTime()).toBe(Date.UTC(2026, 8, 3, 10, 0, 0));
    const xml = sheetXml(readZip(buildXlsx([sheet], { logo: null })), 1);
    expect(xml).toMatch(/<c r="B\d+" s="5"><v>46268\.41666/);
  });

  it('the real R6 CSV (rejected cones) writes its time column as a plant-clock string the workbook reads as a date', () => {
    const data: any = {
      period: { from: '2026-07-03', to: '2026-07-03' }, filters: {}, total: 1, listTotal: 1, listCap: 5000, excludedClockFault: 0,
      list: [{
        date: '2026-07-03', shift: 'evening', winder: 13, hanger: 240, weightG: 2032, producedAtUtc: '2026-07-03T21:32:41.000Z',
        productId: 1021, productLabel: '205-IL0-SD', productSource: 'row',
        limits: { label: '1,960 +/- 40 g', targetG: 1960, loG: 1920, hiG: 2000, lowerBound: false }, outsideByG: 32, noLimitsReason: null,
      }],
      weightRange: { line: { n: 5, minG: 1900, maxG: 2100, avgG: 2000 }, byWinder: [{ winder: 13, n: 5, minG: 1900, maxG: 2100, avgG: 2000 }], plausibility: { loG: 1500, hiG: 2100 }, excludedImplausible: 0 },
    };
    const table = rejectedConesCsv(data);
    const at = table.headers.indexOf('produced_at_plant_time');
    expect(table.rows[0]![at]).toBe('2026-07-03 21:32:41');
    const sheets = reportSheets('rejected-cones', data, header({ reportType: 'rejected-cones' }), table);
    const cone = sheets.find((s) => s.name === 'Rejected cone')!;
    const type = (k: string) => cone.columns.find((c) => c.key === k)!.type;
    expect(type('produced_at_plant_time')).toBe('date');
    expect(type('winder')).toBe('id');
    expect(type('hanger')).toBe('id');
    expect(type('material_id')).toBe('id');
    expect(type('weight_g')).toBe('integer');
    expect(type('limits_lower_bound')).toBe('boolean');
    expect(type('outside_by_g')).toBe('integer');
    expect(type('product')).toBe('text');
  });
});

/* --------------------------------------------------------------- D5 / D6 */

describe('D5: the BOM is the route\'s, not the document\'s', () => {
  it('CSV_BOM is U+FEFF and csvDocument does not start with it', () => {
    expect(CSV_BOM).toBe('﻿');
    expect(csvDocument(['a'], [[1]], header()).charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('D6: the report notes trail the CSV and sit on the workbook header sheet', () => {
  const notes = ['A note about the method.', 'Assumed until IFL confirms: a default.'];

  it('attributionRows appends one report_note row per note, last, and none when there are none', () => {
    const base = attributionRows(header());
    expect(base.some(([k]) => k === 'report_note')).toBe(false);
    const rows = attributionRows(header({ reportNotes: notes }));
    expect(rows.slice(0, base.length)).toEqual(base);
    expect(rows.slice(base.length)).toEqual([['report_note', notes[0]], ['report_note', notes[1]]]);
  });

  it('blank and non-string notes are skipped', () => {
    const rows = attributionRows(header({ reportNotes: ['', '   ', 'kept', 7 as unknown as string] }));
    expect(rows.filter(([k]) => k === 'report_note')).toEqual([['report_note', 'kept']]);
  });

  it('the CSV text carries them after the blank line, quoted when they hold a comma', () => {
    const doc = csvDocument(['a'], [[1]], header({ reportNotes: ['Plain note.', 'Note, with a comma.'] }));
    const trailing = doc.split('\n\n')[1]!;
    expect(trailing).toContain('report_note,Plain note.');
    expect(trailing).toContain('report_note,"Note, with a comma."');
  });

  it('the workbook header sheet lists the same notes', () => {
    const sheet = headerSheet(header({ reportNotes: notes }));
    expect(sheet.rows.filter((r) => r.item === 'report_note').map((r) => r.value)).toEqual(notes);
  });
});
