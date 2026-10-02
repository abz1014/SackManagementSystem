/**
 * IFL reports, task W0 (1 Oct 2026): the CONTRACT of the six report types that
 * complete IFL's own list of eight — rejected-sacks, sps-packing,
 * sack-weight-range, sack-weight-summary, rejected-hangers,
 * rejected-unknown-lifter — and of the registry they join (18 types).
 *
 * Waves 1-2 replace each stub builder with real queries and add their own test
 * files; this file pins what must NOT move while they do: the registry order,
 * IFL's titles, ranks and filters, the frozen CSV headers, how each data field
 * lands in its column, and that over no data a builder returns an empty but fully valid report. A
 * wave that needs to change any of it changes the contract on purpose, here.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'TP1' }, unit: { name: 'Unit 2' } })) }));

import {
  REPORT_TYPES, REPORT_TITLES, REPORT_RANK, FILTERS_BY_TYPE, EXPORT_RANK, LIST_CAP, csvRowOf, isReportType, type ReportType,
} from './common.js';
import { buildReport, reportCsv, type AnyReportData } from './index.js';
import { buildHeader } from './header.js';
import { reportFilename } from './csv.js';
import type { CsvTable } from './csv.js';
import { buildXlsx, reportSheets } from './xlsx.js';
import { REJECTED_SACKS_CSV_HEADERS, type RejectedSacksReportData } from './rejectedSacks.js';
import { SPS_PACKING_CSV_HEADERS, type SpsPackingReportData } from './spsPacking.js';
import { SACK_WEIGHT_RANGE_CSV_HEADERS, type SackWeightRangeReportData } from './sackWeightRange.js';
import { SACK_WEIGHT_SUMMARY_CSV_HEADERS, type SackWeightSummaryReportData } from './sackWeightSummary.js';
import { REJECTED_HANGERS_CSV_HEADERS, type RejectedHangersReportData } from './rejectedHangers.js';
import { REJECTED_UNKNOWN_LIFTER_CSV_HEADERS, type RejectedUnknownLifterReportData } from './rejectedUnknownLifter.js';

/**
 * A pool over a database that holds NOTHING: every query answers an empty
 * recordset. Three of the six types (rejected-hangers, rejected-unknown-lifter,
 * sack-weight-summary) are real builders now and read SQL (a generation scope,
 * the product catalogue); the rest are still scaffolds that never touch the
 * pool, and become real builders in later waves. Either way the contract is the
 * same -- over no data a builder returns an empty but fully valid report -- so
 * one pool serves every type and this file does not need editing each time a
 * stub is replaced.
 */
const EMPTY_POOL = {
  request: () => {
    const req: { input: () => typeof req; query: () => Promise<{ recordset: never[] }> } = {
      input: () => req,
      query: async () => ({ recordset: [] }),
    };
    return req;
  },
} as unknown as ConnectionPool;

const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-02' };

const NEW_TYPES = [
  'rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary', 'rejected-hangers', 'rejected-unknown-lifter',
] as const satisfies readonly ReportType[];
const LIST_TYPES = ['rejected-sacks', 'rejected-hangers', 'rejected-unknown-lifter'] as const satisfies readonly ReportType[];

describe('the registry: 18 report types', () => {
  it('keeps the first twelve exactly where they were and appends the six after rejected-cones', () => {
    expect([...REPORT_TYPES]).toEqual([
      'daily', 'shift', 'product', 'station', 'reject', 'cone-weight', 'sack', 'calibration', 'management-summary', 'machine-product',
      'shift-production', 'rejected-cones',
      'rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary', 'rejected-hangers', 'rejected-unknown-lifter',
    ]);
    expect(REPORT_TYPES).toHaveLength(18);
    expect(new Set(REPORT_TYPES).size).toBe(18);
  });

  it('every type has a title, a rank and a filter list; no two titles are the same', () => {
    for (const t of REPORT_TYPES) {
      expect(REPORT_TITLES[t], t).toMatch(/\S/);
      expect(REPORT_RANK[t], t).toBeDefined();
      expect(FILTERS_BY_TYPE[t], t).toBeDefined();
    }
    expect(new Set(Object.values(REPORT_TITLES)).size).toBe(18);
  });

  it('the six titles are IFL\'s own words, and the earlier IFL pair is retitled to theirs', () => {
    expect(REPORT_TITLES).toMatchObject({
      'shift-production': 'Shift-wise CTS Loop Production Report',
      'rejected-cones': 'List of Rejected Cones Against Weight',
      'rejected-sacks': 'Rejected Sack Report - Daily',
      'sps-packing': 'SPS Production Report - Count-wise Packing at Each SPS',
      'sack-weight-range': 'SPS Sack Weight Range Report',
      'sack-weight-summary': 'Sack Packing Weight Summary',
      'rejected-hangers': 'Rejected Cone Hangers Report',
      'rejected-unknown-lifter': 'Rejected Unknown (Lifter) Report',
    });
  });

  it('every report is a rank-1 read except the management summary; every export is rank 3 (one audience)', () => {
    for (const t of NEW_TYPES) expect(REPORT_RANK[t], t).toBe(1);
    expect(REPORT_RANK['management-summary']).toBe(3);
    expect(EXPORT_RANK).toBe(3);
  });

  it('the six accept exactly the contract\'s filters, and none accepts a station filter except the hanger report', () => {
    expect(FILTERS_BY_TYPE['rejected-sacks']).toEqual(['shift', 'product']);
    expect(FILTERS_BY_TYPE['sps-packing']).toEqual(['shift']);
    expect(FILTERS_BY_TYPE['sack-weight-range']).toEqual(['shift', 'product']);
    expect(FILTERS_BY_TYPE['sack-weight-summary']).toEqual(['shift', 'product']);
    expect(FILTERS_BY_TYPE['rejected-hangers']).toEqual(['shift', 'station', 'product']);
    expect(FILTERS_BY_TYPE['rejected-unknown-lifter']).toEqual(['shift', 'product']);
    for (const t of NEW_TYPES.filter((x) => x !== 'rejected-hangers')) expect(FILTERS_BY_TYPE[t]).not.toContain('station');
  });

  it('isReportType accepts all eighteen and refuses an unknown one', () => {
    for (const t of REPORT_TYPES) expect(isReportType(t)).toBe(true);
    expect(isReportType('rejected-sack')).toBe(false);
  });

  it('the list cap is 5,000 rows', () => {
    expect(LIST_CAP).toBe(5000);
  });
});

describe('csvRowOf', () => {
  const H = ['section', 'a', 'b', 'c'] as const;
  it('returns the header\'s own order and width, every unnamed column an empty (null) cell', () => {
    expect(csvRowOf(H, { c: 3, section: 'x' })).toEqual(['x', null, null, 3]);
    expect(csvRowOf(H, {})).toEqual([null, null, null, null]);
  });
  it('keeps 0, false and the empty string as values; undefined and null become null', () => {
    expect(csvRowOf(H, { a: 0, b: false, c: '' })).toEqual([null, 0, false, '']);
    expect(csvRowOf(H, { a: undefined, b: null })).toEqual([null, null, null, null]);
  });
});

describe('every report type, built over a database holding no rows, is a valid report', () => {
  it.each(NEW_TYPES)('%s: an empty report with a note, assumed-until-IFL lines and a generation note', async (type) => {
    const data = (await buildReport(EMPTY_POOL, 1, type, PERIOD, {})) as AnyReportData & {
      note: string; pendingIfl: string[]; generationNote: { spansGenerations: boolean }; period: unknown; filters: unknown; lineId: number;
    };
    expect(data.note).toMatch(/\S/);
    expect(Array.isArray(data.pendingIfl)).toBe(true);
    expect(data.pendingIfl.length).toBeGreaterThan(0);
    for (const line of data.pendingIfl) expect(line).toMatch(/\S/);
    expect(data.generationNote.spansGenerations).toBe(false);
    expect(data.period).toEqual(PERIOD);
    expect(data.filters).toEqual({});
    expect(data.lineId).toBe(1);
  });

  it.each(LIST_TYPES)('%s: a list report states how many it holds, its cap and the clock-fault rows dropped', async (type) => {
    const data = (await buildReport(EMPTY_POOL, 1, type, PERIOD, {})) as unknown as { list: unknown[]; listTotal: number; listCap: number; excludedClockFault: number };
    expect(data.list).toEqual([]);
    expect(data.listTotal).toBe(0);
    expect(data.listCap).toBe(LIST_CAP);
    expect(data.excludedClockFault).toBe(0);
  });

  it.each(['sps-packing', 'sack-weight-range', 'sack-weight-summary'] as const)('%s: not a list report, so no list fields', async (type) => {
    const data = (await buildReport(EMPTY_POOL, 1, type, PERIOD, {})) as unknown as Record<string, unknown>;
    expect(data).not.toHaveProperty('listTotal');
    expect(data).not.toHaveProperty('listCap');
    expect(data).not.toHaveProperty('excludedClockFault');
  });

  it.each(NEW_TYPES)('%s: an empty report exports to a workbook (header sheet first, masthead from the header, no chart) without throwing', async (type) => {
    const data = await buildReport(EMPTY_POOL, 1, type, PERIOD, {});
    const header = await buildHeader(EMPTY_POOL, 1, {
      reportType: type, period: PERIOD, filters: {}, user: { username: 'u', displayName: 'U' }, lineNameFallback: 'Line 3', reportData: data,
    });
    const sheets = reportSheets(type, data, header, reportCsv(type, data as never));
    expect(sheets[0]!.name).toBe('Report');
    expect(sheets[0]!.titleRows![0]).toBe('Ibrahim Fibres Limited (TP1 · Unit 2)');
    expect(sheets.some((s) => s.chart)).toBe(false);
    const buf = buildXlsx(sheets, { logo: null });
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it.each(NEW_TYPES)('%s: the header title is the registry title, and the filename carries the type', async (type) => {
    const h = await buildHeader(EMPTY_POOL, 1, {
      reportType: type, period: PERIOD, filters: {}, user: { username: 'u', displayName: 'U' }, lineNameFallback: 'Line 3',
      reportData: await buildReport(EMPTY_POOL, 1, type, PERIOD, {}),
    });
    expect(h.title).toBe(REPORT_TITLES[type]);
    expect(h.plantName).toBe('TP1');
    expect(h.unitName).toBe('Unit 2');
    expect(reportFilename(h, 'csv')).toBe(`sms-report-${type}-2026-09-01_to_2026-09-02.csv`);
  });
});

/* ------------------------------------------------------- the CSV contract */

const col = (t: CsvTable, name: string): number => {
  const i = t.headers.indexOf(name);
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return i;
};
const sectionRows = (t: CsvTable, section: string) => t.rows.filter((r) => r[0] === section);
const cell = (t: CsvTable, row: readonly unknown[], name: string) => row[col(t, name)];
const widths = (t: CsvTable) => {
  for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
};

describe('the frozen CSV headers', () => {
  it('rejected-sacks', () => {
    expect([...REJECTED_SACKS_CSV_HEADERS]).toEqual([
      'section', 'date', 'shift', 'produced_at_plant_time', 'sack_num', 'product', 'material_id', 'yarn_count', 'weight_kg', 'implausible',
      'sacks', 'rejected', 'rejected_pct', 'no_flag', 'min_kg', 'max_kg',
    ]);
  });
  it('sps-packing', () => {
    expect([...SPS_PACKING_CSV_HEADERS]).toEqual(['section', 'date', 'shift', 'sps', 'yarn_count', 'material_ids', 'sacks', 'kg', 'avg_kg', 'share_pct']);
  });
  it('sack-weight-range', () => {
    expect([...SACK_WEIGHT_RANGE_CSV_HEADERS]).toEqual([
      'section', 'date', 'shift', 'band', 'from_kg', 'to_kg', 'passed', 'rejected', 'total', 'share_pct', 'n', 'min_kg', 'max_kg', 'range_kg', 'avg_kg', 'sd_kg',
    ]);
  });
  it('sack-weight-summary', () => {
    expect([...SACK_WEIGHT_SUMMARY_CSV_HEADERS]).toEqual([
      'section', 'date', 'shift', 'yarn_count', 'material_ids', 'sacks', 'kg', 'avg_kg', 'min_kg', 'max_kg', 'sd_kg', 'rejected_by_scale', 'implausible',
    ]);
  });
  it('rejected-hangers', () => {
    expect([...REJECTED_HANGERS_CSV_HEADERS]).toEqual([
      'section', 'hanger', 'cones', 'inspected', 'quality_rejects', 'weight_rejects', 'total_rejects', 'rate_pct', 'flag', 'date',
      'produced_at_plant_time', 'shift', 'winder', 'reject_type', 'reason', 'weight_g',
    ]);
  });
  it('rejected-unknown-lifter', () => {
    expect([...REJECTED_UNKNOWN_LIFTER_CSV_HEADERS]).toEqual([
      'section', 'lifter', 'cones', 'inspected', 'quality_rejects', 'zero_code_rejects', 'weight_rejects', 'total_rejects', 'rate_pct',
      'date', 'produced_at_plant_time', 'shift', 'hanger', 'winder', 'reject_type', 'tube_code', 'material_code', 'weight_g', 'why',
    ]);
  });

  it.each(NEW_TYPES)('%s: an empty report still serialises to its headers, every row at the header\'s width', async (type) => {
    const t = reportCsv(type, await buildReport(EMPTY_POOL, 1, type, PERIOD, {}) as never);
    expect(t.headers.length).toBeGreaterThan(0);
    widths(t);
  });
});

describe('how each field lands in its column', () => {
  it('rejected-sacks: A / B / C / D, with the sack time as the plant wall clock', () => {
    const data = {
      byShift: [{ date: '2026-09-01', shift: 'morning', sacks: 20, rejected: 2, rejectedPct: 10 }],
      byDay: [{ date: '2026-09-01', sacks: 38, rejected: 3, rejectedPct: 7.9 }],
      total: { sacks: 78, rejected: 4, rejectedPct: 5.1, noFlag: 2 },
      rejectedSplit: { implausible: 1, plausible: 3 },
      passedRange: {
        byProduct: [{ productId: 7, productLabel: 'Product A', yarnCount: '36', sacks: 70, minKg: 47, maxKg: 47.6 }],
        all: { sacks: 74, minKg: 47, maxKg: 47.6 },
      },
      list: [{ date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:10:05.000Z', sackNum: 12, productId: 7, productLabel: 'Product A', yarnCount: '36', weightKg: 0, implausible: true }],
    } as unknown as RejectedSacksReportData;
    const t = reportCsv('rejected-sacks', data);
    widths(t);
    const shift = sectionRows(t, 'shift_count')[0]!;
    expect(['date', 'shift', 'sacks', 'rejected', 'rejected_pct'].map((n) => cell(t, shift, n))).toEqual(['2026-09-01', 'morning', 20, 2, 10]);
    expect(sectionRows(t, 'day_total')).toHaveLength(1);
    const total = sectionRows(t, 'period_total')[0]!;
    expect(['sacks', 'rejected', 'rejected_pct', 'no_flag'].map((n) => cell(t, total, n))).toEqual([78, 4, 5.1, 2]);
    expect(sectionRows(t, 'rejected_split').map((r) => [cell(t, r, 'implausible'), cell(t, r, 'sacks')])).toEqual([[true, 1], [false, 3]]);
    const passed = sectionRows(t, 'passed_range');
    expect(passed).toHaveLength(2);
    expect(['product', 'material_id', 'yarn_count', 'sacks', 'min_kg', 'max_kg'].map((n) => cell(t, passed[0]!, n))).toEqual(['Product A', 7, '36', 70, 47, 47.6]);
    expect(cell(t, passed[1]!, 'product')).toBe('All products');
    const sack = sectionRows(t, 'rejected_sack')[0]!;
    expect(['produced_at_plant_time', 'sack_num', 'weight_kg', 'implausible'].map((n) => cell(t, sack, n))).toEqual(['2026-09-01 07:10:05', 12, 0, true]);
  });

  it('sps-packing: long-format cells, shift totals, per-count totals with share, and the grand total', () => {
    const data = {
      sps: { number: 1, label: 'SPS 1 - one sack scale', confirmed: false },
      columns: [{ key: '36', yarnCount: '36', label: '36', materialIds: [7, 9] }, { key: 'none', yarnCount: null, label: 'No product on the reading', materialIds: [] }],
      rows: [{ date: '2026-09-01', shift: 'morning', cells: { '36': { sacks: 20, kg: 940 }, none: { sacks: 1, kg: 47 } }, total: { sacks: 21, kg: 987 } }],
      totals: [
        { key: '36', yarnCount: '36', label: '36', materialIds: [7, 9], sacks: 20, kg: 940, avgKg: 47, sharePct: 95.2 },
        { key: 'none', yarnCount: null, label: 'No product on the reading', materialIds: [], sacks: 1, kg: 47, avgKg: 47, sharePct: 4.8 },
      ],
      grandTotal: { sacks: 21, kg: 987, avgKg: 47 },
    } as unknown as SpsPackingReportData;
    const t = reportCsv('sps-packing', data);
    widths(t);
    const cells = sectionRows(t, 'cell');
    expect(cells.map((r) => [cell(t, r, 'yarn_count'), cell(t, r, 'material_ids'), cell(t, r, 'sacks'), cell(t, r, 'kg'), cell(t, r, 'sps')])).toEqual([
      ['36', '7 9', 20, 940, 'SPS 1 - one sack scale'], ['No product on the reading', '', 1, 47, 'SPS 1 - one sack scale'],
    ]);
    expect(sectionRows(t, 'shift_total').map((r) => [cell(t, r, 'date'), cell(t, r, 'shift'), cell(t, r, 'sacks'), cell(t, r, 'kg')])).toEqual([['2026-09-01', 'morning', 21, 987]]);
    expect(sectionRows(t, 'count_total').map((r) => [cell(t, r, 'yarn_count'), cell(t, r, 'avg_kg'), cell(t, r, 'share_pct')])).toEqual([['36', 47, 95.2], ['No product on the reading', 47, 4.8]]);
    expect(sectionRows(t, 'grand_total').map((r) => [cell(t, r, 'sacks'), cell(t, r, 'kg'), cell(t, r, 'share_pct')])).toEqual([[21, 987, 100]]);
  });

  it('sack-weight-range: a whole-period row per band with its share, then one per shift that has sacks; the spread tables', () => {
    const c = (passed: number, rejected: number) => ({ passed, rejected, noFlag: 0, total: passed + rejected });
    const data = {
      bands: [{
        kind: 'band', label: '47.1 - 47.2 kg', fromKg: 47.1, toKg: 47.2,
        byShift: { morning: c(5, 1), evening: c(3, 0), night: c(0, 0) }, total: c(8, 1), sharePct: 36,
      }],
      spreadByDayShift: [{ date: '2026-09-01', shift: 'morning', n: 14, minKg: 47, maxKg: 47.2, rangeKg: 0.2, avgKg: 47.07, sdKg: 0.06 }],
      spreadByShift: [{ date: null, shift: 'evening', n: 9, minKg: 47, maxKg: 47.1, rangeKg: 0.1, avgKg: 47.04, sdKg: 0.05 }],
      spreadTotal: { date: null, shift: null, n: 23, minKg: 47, maxKg: 47.2, rangeKg: 0.2, avgKg: 47.06, sdKg: 0.06 },
    } as unknown as SackWeightRangeReportData;
    const t = reportCsv('sack-weight-range', data);
    widths(t);
    const bands = sectionRows(t, 'band');
    expect(bands.map((r) => [cell(t, r, 'shift'), cell(t, r, 'passed'), cell(t, r, 'rejected'), cell(t, r, 'total'), cell(t, r, 'share_pct')])).toEqual([
      [null, 8, 1, 9, 36], ['morning', 5, 1, 6, null], ['evening', 3, 0, 3, null],
    ]);
    expect(bands.every((r) => cell(t, r, 'band') === '47.1 - 47.2 kg' && cell(t, r, 'from_kg') === 47.1 && cell(t, r, 'to_kg') === 47.2)).toBe(true);
    const day = sectionRows(t, 'spread_day_shift')[0]!;
    expect(['date', 'shift', 'n', 'range_kg', 'sd_kg'].map((n) => cell(t, day, n))).toEqual(['2026-09-01', 'morning', 14, 0.2, 0.06]);
    expect(sectionRows(t, 'spread_shift')).toHaveLength(1);
    expect(['n', 'avg_kg'].map((n) => cell(t, sectionRows(t, 'spread_total')[0]!, n))).toEqual([23, 47.06]);
  });

  it('sack-weight-summary: date-and-shift rows, day totals, shift totals, yarn counts and the grand total', () => {
    const fig = (sacks: number, kg: number) => ({ sacks, kg, avgKg: 47, minKg: 46.9, maxKg: 47.3, sdKg: 0.12, rejectedByScale: 1, implausible: 0 });
    const data = {
      rows: [{ date: '2026-09-01', shift: 'morning', ...fig(20, 940) }],
      dayTotals: [{ date: '2026-09-01', ...fig(38, 1786) }],
      shiftTotals: [{ shift: 'morning', ...fig(20, 940) }],
      byYarnCount: [{ yarnCount: '36', label: '36', materialIds: [7, 9], ...fig(60, 2820) }],
      total: fig(78, 3666),
    } as unknown as SackWeightSummaryReportData;
    const t = reportCsv('sack-weight-summary', data);
    widths(t);
    expect(['date', 'shift', 'sacks', 'kg', 'sd_kg', 'rejected_by_scale'].map((n) => cell(t, sectionRows(t, 'day_shift')[0]!, n))).toEqual(['2026-09-01', 'morning', 20, 940, 0.12, 1]);
    expect(cell(t, sectionRows(t, 'day_total')[0]!, 'date')).toBe('2026-09-01');
    expect(cell(t, sectionRows(t, 'shift_total')[0]!, 'shift')).toBe('morning');
    expect(['yarn_count', 'material_ids'].map((n) => cell(t, sectionRows(t, 'yarn_count')[0]!, n))).toEqual(['36', '7 9']);
    expect(cell(t, sectionRows(t, 'grand_total')[0]!, 'sacks')).toBe(78);
  });

  it('rejected-hangers: per hanger (the no-hanger bucket empty), the total, and each reject with its time as the plant wall clock', () => {
    const h = (hanger: number | null, flag: string | null) => ({ hanger, cones: 471, inspected: 471, qualityRejects: 58, weightRejects: 0, total: 58, ratePct: 12.31, flag });
    const data = {
      hangers: [h(91, 'stands_out'), h(null, null)],
      total: h(null, null),
      list: [{ date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:00:09.000Z', hanger: 91, winder: 4, rejectType: 'quality', reason: 'Tube 3', weightG: null }],
    } as unknown as RejectedHangersReportData;
    const t = reportCsv('rejected-hangers', data);
    widths(t);
    const rows = sectionRows(t, 'hanger');
    expect(rows.map((r) => [cell(t, r, 'hanger'), cell(t, r, 'flag')])).toEqual([[91, 'stands_out'], [null, null]]);
    expect(['inspected', 'total_rejects', 'rate_pct'].map((n) => cell(t, rows[0]!, n))).toEqual([471, 58, 12.31]);
    expect(sectionRows(t, 'total')).toHaveLength(1);
    const reject = sectionRows(t, 'reject')[0]!;
    expect(['hanger', 'produced_at_plant_time', 'winder', 'reject_type', 'reason'].map((n) => cell(t, reject, n))).toEqual([91, '2026-09-01 07:00:09', 4, 'quality', 'Tube 3']);
  });

  it('rejected-unknown-lifter: lifters, the total, no-lifter rejects with why, the zero-code list and the zeroed-clock block', () => {
    const l = (lifter: number | null) => ({ lifter, cones: 400, inspected: 400, qualityRejects: 8, zeroCodeRejects: 1, weightRejects: 0, total: 8, ratePct: 2 });
    const rej = (why: string[], ts: string, date: string) => ({
      date, shift: 'evening', producedAtUtc: ts, hanger: 12, winder: 3, lifter: null, rejectType: 'quality', tubeCode: 0, materialCode: 0, weightG: null, why,
    });
    const data = {
      lifters: [l(1), l(null)],
      total: l(null),
      list: [rej(['No lifter recorded', 'No winder recorded'], '2026-09-01T07:00:00.000Z', '2026-09-01')],
      zeroCodeList: [rej(['Reason code is zero'], '2026-09-01T09:30:15.000Z', '2026-09-01')],
      zeroedClock: { generation: 'batch 1', rows: [rej(['Clock zeroed (1970)'], '1970-01-01T00:00:00.000Z', '1969-12-31')] },
    } as unknown as RejectedUnknownLifterReportData;
    const t = reportCsv('rejected-unknown-lifter', data);
    widths(t);
    const lifters = sectionRows(t, 'lifter');
    expect(lifters.map((r) => cell(t, r, 'lifter'))).toEqual([1, null]);
    expect(['zero_code_rejects', 'total_rejects', 'rate_pct'].map((n) => cell(t, lifters[0]!, n))).toEqual([1, 8, 2]);
    expect(sectionRows(t, 'total')).toHaveLength(1);
    const noLifter = sectionRows(t, 'no_lifter')[0]!;
    expect(['tube_code', 'material_code', 'why', 'produced_at_plant_time'].map((n) => cell(t, noLifter, n))).toEqual([0, 0, 'No lifter recorded; No winder recorded', '2026-09-01 07:00:00']);
    const zeroCode = sectionRows(t, 'zero_code')[0]!;
    expect(['why', 'produced_at_plant_time'].map((n) => cell(t, zeroCode, n))).toEqual(['Reason code is zero', '2026-09-01 09:30:15']);
    const zeroed = sectionRows(t, 'zeroed_clock')[0]!;
    expect(['date', 'why', 'produced_at_plant_time'].map((n) => cell(t, zeroed, n))).toEqual(['1969-12-31', 'Clock zeroed (1970)', '1970-01-01 00:00:00']);
  });
});
