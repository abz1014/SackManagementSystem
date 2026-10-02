/**
 * Task W1 (30 Sep 2026): the IFL-SSRS-styled 'rejected-cones' report; split
 * out of iflStyledReports.test.ts on 1 Oct 2026 (task W0) so each IFL report
 * has a test file of its own that exactly one worker edits. The pool is a
 * recording fake that answers by table; a fake cannot execute a WHERE, so
 * filters are proven by the SQL text and the parameters bound on it, and
 * arithmetic/ordering by the rows it returns.
 *
 * W0 additions: the title in IFL's own words, the frozen contract fields and
 * the final CSV headers (two sections only, plant-clock timestamps).
 *
 * W1-R6 (1 Oct 2026): hanger, the product and the limits IN FORCE AT EACH
 * REJECT'S OWN INSTANT (two limit versions give two different answers), the
 * lower-bound qualifier, a July row with no MaterialId resolved by the
 * line-wide timeline, the zeroed-clock sentinel left out and counted, the
 * list cap, `weight_g IS NOT NULL` dropped, one generation scope, and a
 * station-filtered range that is never labelled "line".
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'IFL' }, unit: { name: 'Unit 2' } })) }));

import {
  getRejectedConesReport, rejectedConesCsv, REJECTED_CONES_CSV_HEADERS, NO_PRODUCT_AT_TIME, NO_LIMITS_FOR_PRODUCT, REJECTED_CONES_NOTE,
  type RejectedConesReportData, type RejectedConeRow,
} from './rejectedCones.js';
import { REPORT_TYPES, REPORT_TITLES, REPORT_RANK, FILTERS_BY_TYPE, LIST_CAP } from './common.js';
import { buildReport, reportCsv } from './index.js';
import { buildHeader } from './header.js';
import { attributionRows, csvDocument } from './csv.js';
import type { ShiftRange } from '../../shiftRange.js';
import { getShiftProductionReport } from './shiftProduction.js';

interface Call { sql: string; params: Map<string, unknown> }
type Rows = Record<string, unknown>[];

interface FakeData {
  list?: Rows;
  /** The COUNT(*) row: { n, fault }. Defaults to the list's own length, no faults. */
  count?: Record<string, unknown>;
  ranges?: Rows;
  timeline?: Rows;
  products?: Rows;
  versions?: Rows;
  /** sms.source_epoch rows and the per-table epoch counts, to make the generation resolver choose one. */
  epochs?: Rows;
  present?: Rows;
}

function fakePool(data: FakeData = {}): { pool: ConnectionPool; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (sql: string): Rows => {
    if (sql.includes('FROM sms.plausibility_rule')) return [];
    if (sql.includes('FROM sms.product_timeline')) return data.timeline ?? [];
    if (sql.includes('FROM sms.product_limit_version')) return data.versions ?? [];
    if (sql.includes('FROM sms.product p')) return data.products ?? [];
    if (sql.includes('FROM sms.reject_event') && sql.includes('COUNT(*) AS n')) return [data.count ?? { n: (data.list ?? LIST).length, fault: 0 }];
    if (sql.includes('FROM sms.reject_event')) return data.list ?? LIST;
    if (sql.includes('FROM sms.cone_event')) return data.ranges ?? RANGES;
    return [];
  };
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (n: string, _t: unknown, v: unknown) => { params.set(n, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('GROUP BY source_epoch')) return { recordset: data.present ?? [], rowsAffected: [0] };
          if (sql.includes('FROM sms.source_epoch')) return { recordset: data.epochs ?? [], rowsAffected: [0] };
          calls.push({ sql, params });
          return { recordset: answer(sql), rowsAffected: [0] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-02' };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const LIST: Rows = [
  { d: d('2026-09-01'), sc: 'morning', st: 3, hg: 41, w: 1100.5, ts: new Date('2026-09-01T07:00:00Z'), mid: null },
  { d: d('2026-09-01'), sc: 'evening', st: 1, hg: 7, w: 2300, ts: new Date('2026-09-01T15:30:00Z'), mid: null },
  { d: d('2026-09-02'), sc: 'night', st: null, hg: null, w: 900, ts: new Date('2026-09-02T02:00:00Z'), mid: null },
];
const RANGES: Rows = [
  { st: 1, n: 10, sm: 19500, mn: 1900, mx: 2000, bad: 1 },
  { st: 2, n: 30, sm: 58500, mn: 1920, mx: 1980, bad: 2 },
  { st: null, n: 0, sm: null, mn: null, mx: null, bad: 0 },
];

describe('rejected-cones: report', () => {
  it('lists weight rejects in the order the query returns them, with a total', async () => {
    const { pool, calls } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.total).toBe(3);
    expect(r.list.map((x) => [x.date, x.shift, x.winder, x.hanger, x.weightG])).toEqual([
      ['2026-09-01', 'morning', 3, 41, 1100.5], ['2026-09-01', 'evening', 1, 7, 2300], ['2026-09-02', 'night', null, null, 900],
    ]);
    const q = calls.find((c) => c.sql.includes('FROM sms.reject_event') && !c.sql.includes('COUNT(*)'))!;
    expect(q.sql).toContain("reject_type = 'weight'");
    expect(q.sql).toMatch(/ORDER BY production_ts_utc_ms/);
  });

  it('every weight-reject RECORD is a row: the weight_g IS NOT NULL condition is gone, and a null weight stays a row', async () => {
    const list: Rows = [{ d: d('2026-09-01'), sc: 'morning', st: 3, hg: 41, w: null, ts: new Date('2026-09-01T07:00:00Z'), mid: null }];
    const { pool, calls } = fakePool({ list });
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    for (const c of calls.filter((x) => x.sql.includes('FROM sms.reject_event'))) expect(c.sql).not.toContain('weight_g IS NOT NULL');
    expect(r.list).toHaveLength(1);
    expect(r.list[0]!.weightG).toBeNull();
    const t = rejectedConesCsv(r);
    expect(t.rows.find((x) => x[0] === 'rejected_cone')![t.headers.indexOf('weight_g')]).toBeNull();
  });

  it('weightRange: per winder and line, over plausible cones only; implausible are counted', async () => {
    const { pool, calls } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const q = calls.find((c) => c.sql.includes('FROM sms.cone_event'))!;
    // the plausibility window is bound and gates every aggregate
    expect(q.params.get('plausLo')).toBe(1500);
    expect(q.params.get('plausHi')).toBe(2100);
    expect(q.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(r.weightRange.plausibility).toEqual({ loG: 1500, hiG: 2100 });
    expect(r.weightRange.excludedImplausible).toBe(3);
    expect(r.weightRange.byWinder).toEqual([
      { winder: 1, n: 10, minG: 1900, maxG: 2000, avgG: 1950 },
      { winder: 2, n: 30, minG: 1920, maxG: 1980, avgG: 1950 },
    ]);
    // line: n = 40, min of mins, max of maxes, weighted average
    expect(r.weightRange.line).toEqual({ n: 40, minG: 1900, maxG: 2000, avgG: 1950 });
  });

  it('a hanger of 0 means the plant recorded no hanger: the row carries none, never hanger 0 (R7 reads it the same way)', async () => {
    const list: Rows = [
      { d: d('2026-09-01'), sc: 'morning', st: 3, hg: 0, w: 2100, ts: new Date('2026-09-01T07:00:00Z'), mid: null },
      { d: d('2026-09-01'), sc: 'morning', st: 3, hg: 240, w: 2100, ts: new Date('2026-09-01T07:01:00Z'), mid: null },
    ];
    const { pool } = fakePool({ list });
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.list.map((x) => x.hanger)).toEqual([null, 240]);
  });

  it('no plausible cones: null range, not zeros', async () => {
    const { pool } = fakePool({ list: [], ranges: [{ st: 4, n: 0, sm: null, mn: null, mx: null, bad: 2 }] });
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.weightRange.line).toEqual({ n: 0, minG: null, maxG: null, avgG: null });
    expect(r.weightRange.byWinder[0]).toEqual({ winder: 4, n: 0, minG: null, maxG: null, avgG: null });
    expect(r.weightRange.excludedImplausible).toBe(2);
    expect(r.total).toBe(0);
  });

  it('with nothing to list, the product timeline and catalogue are never read', async () => {
    const { pool, calls } = fakePool({ list: [] });
    await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(calls.some((c) => c.sql.includes('FROM sms.product_timeline') || c.sql.includes('FROM sms.product_limit_version'))).toBe(false);
  });

  it('shift and station filters and shiftRange are bound on all three queries', async () => {
    const range: ShiftRange = { from: '2026-09-01', fromShift: 'morning', to: '2026-09-01', toShift: 'evening' };
    const { pool, calls } = fakePool();
    await getRejectedConesReport(pool, 1, PERIOD, { shift: 'morning', station: 7 }, range);
    const filtered = calls.filter((c) => c.sql.includes('FROM sms.reject_event') || c.sql.includes('FROM sms.cone_event'));
    expect(filtered).toHaveLength(3);
    for (const c of filtered) {
      expect(c.params.get('shift')).toBe('morning');
      expect(c.params.get('station')).toBe(7);
      expect(c.sql).toContain('source_station = @station');
      expect(c.params.get('srFromOrd')).toBe(1);
      expect(c.params.get('srToOrd')).toBe(2);
    }
  });

  it('CSV: list rows and ranges, in two sections only, every row the header\'s width', async () => {
    const { pool } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const t = rejectedConesCsv(r);
    expect(t.headers).toEqual(REJECTED_CONES_CSV_HEADERS);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
    expect([...new Set(t.rows.map((x) => x[0]))]).toEqual(['rejected_cone', 'weight_range']);
    const col = (name: string) => t.headers.indexOf(name);
    const sections = t.rows.map((x) => x[0]);
    expect(sections.filter((s) => s === 'rejected_cone')).toHaveLength(3);
    const ranges = t.rows.filter((x) => x[0] === 'weight_range');
    expect(ranges.map((x) => x[col('scope')])).toEqual(['line', 'winder', 'winder']);
    expect(ranges[0]![col('n')]).toBe(40);
    expect(ranges.slice(1).map((x) => x[col('winder')])).toEqual([1, 2]);
    expect(reportCsv('rejected-cones', r)).toEqual(t);
  });
});

/* ------------------------------------- W1-R6: the limits in force at each reject */

const PRODUCTS: Rows = [
  { product_id: 1021, description: '205-IL0-SD', lot_code: null, active_flag: 1, color: 'Orange', blend: null, count_text: '30', tube_type: null },
  { product_id: 17, description: 'STR-RED', lot_code: null, active_flag: 1, color: null, blend: null, count_text: null, tube_type: null },
  { product_id: 1022, description: '205-IL0-SD', lot_code: null, active_flag: 1, color: 'Blue', blend: null, count_text: '36', tube_type: null },
];
const VERSIONS: Rows = [
  // 1021: 1960 +/- 50 from 11 Aug, retuned to 1960 +/- 30 from 3 Sep 2026.
  { product_id: 1021, setpoint_g: 1960, offset_minus_g: 50, offset_plus_g: 50, effective_from: new Date('2026-08-11T10:33:57Z'), effective_is_lower_bound: 0, source: 'pdas_created' },
  { product_id: 1021, setpoint_g: 1960, offset_minus_g: 30, offset_plus_g: 30, effective_from: new Date('2026-09-03T06:50:58Z'), effective_is_lower_bound: 0, source: 'sms_write' },
  { product_id: 17, setpoint_g: 1960, offset_minus_g: 50, offset_plus_g: 50, effective_from: new Date('2026-06-18T11:13:18Z'), effective_is_lower_bound: 0, source: 'pdas_created' },
  // 1022 has a setpoint and no offsets: a target and no tolerance.
  { product_id: 1022, setpoint_g: 1960, offset_minus_g: null, offset_plus_g: null, effective_from: new Date('2026-08-18T05:24:59Z'), effective_is_lower_bound: 0, source: 'pdas_created' },
];
const TIMELINE: Rows = [
  { product_id: 17, effective_from: new Date('2026-07-23T08:58:06Z'), setpoint_weight_g: 1960, weight_offset_minus_g: 50, weight_offset_plus_g: 50, description: 'STR-RED', lot_code: null },
];
const rejectAt = (day: string, time: string, w: number | null, mid: number | null, extra: Rows[number] = {}): Rows[number] => ({
  d: d(day), sc: 'morning', st: 6, hg: 178, w, ts: new Date(`${day}T${time}Z`), mid, ...extra,
});

describe('rejected-cones: the product and limits in force at each reject\'s own instant (W1-R6)', () => {
  async function build(list: Rows, extra: FakeData = {}) {
    const { pool, calls } = fakePool({ list, products: PRODUCTS, versions: VERSIONS, timeline: TIMELINE, ...extra });
    const r = await getRejectedConesReport(pool, 1, { period: 'custom', from: '2026-07-01', to: '2026-09-30' }, {});
    return { r, calls };
  }

  it('two limit versions give two different answers: a reject before the retune and one after', async () => {
    const { r } = await build([
      rejectAt('2026-08-20', '10:02:27', 2035, 1021), // before 3 Sep: 1960 +/- 50 => 1910..2010
      rejectAt('2026-09-10', '10:02:27', 2035, 1021), // after: 1960 +/- 30 => 1930..1990
    ]);
    const [before, after] = r.list as [RejectedConeRow, RejectedConeRow];
    expect(before.limits).toEqual({ label: '1,960 ± 50 g', targetG: 1960, loG: 1910, hiG: 2010, lowerBound: false });
    expect(before.outsideByG).toBe(25);
    expect(after.limits).toEqual({ label: '1,960 ± 30 g', targetG: 1960, loG: 1930, hiG: 1990, lowerBound: false });
    expect(after.outsideByG).toBe(45);
    for (const x of [before, after]) {
      expect(x.productId).toBe(1021);
      expect(x.productSource).toBe('row');
      expect(x.noLimitsReason).toBeNull();
    }
  });

  it('outsideByG is signed: minus below the lower limit, plus above the upper, 0 inside (the scale still rejected it)', async () => {
    const { r } = await build([
      rejectAt('2026-08-20', '10:00:00', 1747, 1021),
      rejectAt('2026-08-20', '11:00:00', 2035, 1021),
      rejectAt('2026-08-20', '12:00:00', 1950, 1021),
    ]);
    expect(r.list.map((x) => x.outsideByG)).toEqual([-163, 25, 0]);
  });

  it('the product label is the catalogue\'s distinct one (six materials share a description), never the bare description', async () => {
    const { r } = await build([rejectAt('2026-08-20', '10:00:00', 2035, 1021), rejectAt('2026-08-20', '11:00:00', 2035, 1022)]);
    const labels = r.list.map((x) => x.productLabel);
    expect(labels[0]).not.toBe(labels[1]);
    for (const l of labels) expect(l).toMatch(/205-IL0-SD/);
  });

  it('a July reject with no MaterialId is attributed by the line-wide timeline in force at its time', async () => {
    const { r } = await build([rejectAt('2026-07-25', '09:00:00', 2032, null, { st: 13, hg: 240 })]);
    const x = r.list[0]!;
    expect(x.productSource).toBe('timeline');
    expect(x.productId).toBe(17);
    expect(x.productLabel).toBe('STR-RED');
    expect(x.limits).toEqual({ label: '1,960 ± 50 g', targetG: 1960, loG: 1910, hiG: 2010, lowerBound: false });
    expect(x.outsideByG).toBe(22);
  });

  it('a reject before any product was recorded says so in words and computes nothing', async () => {
    const { r } = await build([rejectAt('2026-07-03', '21:32:41', 2032, null, { st: 13, hg: 240 })]);
    const x = r.list[0]!;
    expect(x).toMatchObject({ productId: null, productLabel: null, productSource: null, limits: null, outsideByG: null, noLimitsReason: NO_PRODUCT_AT_TIME });
    const t = rejectedConesCsv(r);
    const row = t.rows.find((y) => y[0] === 'rejected_cone')!;
    expect(row[t.headers.indexOf('product')]).toBe(NO_PRODUCT_AT_TIME);
    expect(row[t.headers.indexOf('target_g')]).toBeNull();
    expect(row[t.headers.indexOf('outside_by_g')]).toBeNull();
    expect(row[t.headers.indexOf('limits_lower_bound')]).toBeNull();
  });

  it('a reject older than the oldest known limits version states them as a lower bound ("no later than")', async () => {
    const { r } = await build([rejectAt('2026-08-05', '10:00:00', 2035, 1021)]); // 1021's oldest version starts 11 Aug
    const x = r.list[0]!;
    expect(x.limits).toMatchObject({ label: '1,960 ± 50 g', lowerBound: true });
    expect(x.outsideByG).toBe(25);
    const t = rejectedConesCsv(r);
    expect(t.rows.find((y) => y[0] === 'rejected_cone')![t.headers.indexOf('limits_lower_bound')]).toBe(true);
  });

  it('a product with a target and no tolerance has no limits: the row names the product and says why', async () => {
    const { r } = await build([rejectAt('2026-08-20', '10:00:00', 2035, 1022)]);
    const x = r.list[0]!;
    expect(x.productId).toBe(1022);
    expect(x.limits).toBeNull();
    expect(x.outsideByG).toBeNull();
    expect(x.noLimitsReason).toBe(NO_LIMITS_FOR_PRODUCT);
  });

  it('a null weight keeps its limits and judges nothing', async () => {
    const { r } = await build([rejectAt('2026-08-20', '10:00:00', null, 1021)]);
    const x = r.list[0]!;
    expect(x.weightG).toBeNull();
    expect(x.limits).not.toBeNull();
    expect(x.outsideByG).toBeNull();
  });

  it('the verdict is judged by the scale having rejected the cone: the report states the scale\'s bit and the product limit as two facts', async () => {
    // inside the product's limits yet in the reject table: outsideByG is 0, never invented.
    const { r } = await build([rejectAt('2026-08-20', '10:00:00', 1960, 1021)]);
    expect(r.list[0]!.outsideByG).toBe(0);
    expect(REJECTED_CONES_NOTE).toMatch(/inside the product's limits/);
  });
});

/* ----------------------------------- W1-R6: zeroed clocks, the cap, the generation */

describe('rejected-cones: the zeroed-clock sentinel, the list cap and one generation (W1-R6)', () => {
  it('the zeroed-clock records (1970) are left out of the list in SQL and counted, never silently dropped', async () => {
    const { pool, calls } = fakePool({ count: { n: 4, fault: 1 } });
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const list = calls.find((c) => c.sql.includes('FROM sms.reject_event') && !c.sql.includes('COUNT(*)'))!;
    expect(list.sql).toContain('production_ts_utc_ms > 0');
    const count = calls.find((c) => c.sql.includes('COUNT(*) AS n'))!;
    expect(count.sql).toContain('production_ts_utc_ms <= 0');
    expect(r.excludedClockFault).toBe(1);
    expect(r.listTotal).toBe(3); // 4 weight records in range, 1 of them a zeroed clock
    expect(r.total).toBe(3);
    expect(r.list).toHaveLength(3);
  });

  it('the list is cut at the cap in SQL, listTotal is the real count, and the report says it was cut', async () => {
    const many: Rows = Array.from({ length: LIST_CAP }, (_, i) =>
      rejectAt('2026-09-01', '07:00:00', 2035, null, { ts: new Date(Date.UTC(2026, 8, 1, 7, 0, 0) + i * 1000) }),
    );
    const { pool, calls } = fakePool({ list: many, count: { n: 7000, fault: 0 } });
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const list = calls.find((c) => c.sql.includes('FROM sms.reject_event') && !c.sql.includes('COUNT(*)'))!;
    expect(list.sql).toContain('TOP (@cap)');
    expect(list.params.get('cap')).toBe(LIST_CAP);
    expect(r.list).toHaveLength(5000);
    expect(r.listTotal).toBe(7000);
    expect(r.total).toBe(7000);
    expect(r.listCap).toBe(5000);
    expect(r.note).toContain('Only the first 5,000 of 7,000 rejected cones are listed');
  });

  it('an uncut list adds nothing to the note', async () => {
    const { pool } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.note).toBe(REJECTED_CONES_NOTE);
  });

  it('ONE generation scopes the reject list, the count and the cone range alike, and the report states what it left out', async () => {
    const epochs: Rows = [
      { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones' },
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
      { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
    ];
    const present: Rows = [
      { tbl: 'cone_event', epoch_id: 9, n: 100 },
      { tbl: 'reject_event', epoch_id: 12, n: 5 },
      { tbl: 'cone_event', epoch_id: 1, n: 10 },
    ];
    const { pool, calls } = fakePool({ epochs, present });
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const bound = calls.filter((c) => c.sql.includes('FROM sms.reject_event') || c.sql.includes('FROM sms.cone_event'));
    expect(bound).toHaveLength(3);
    for (const c of bound) {
      const isCone = c.sql.includes('FROM sms.cone_event');
      expect(c.sql).toContain(isCone ? 'source_epoch = @gec0' : 'source_epoch = @ger0');
      expect(c.params.get(isCone ? 'gec0' : 'ger0')).toBe(isCone ? 9 : 12);
    }
    expect(r.generationNote.generation?.key).toBe('DATA_TP1U2_SEP07#3');
    expect(r.generationNote.spansGenerations).toBe(true);
    expect(r.generationNote.otherGenerationExcluded).toBe(10);
  });
});

/* ----------------------------------- W1-R6: a station-filtered range is never "line" */

describe('rejected-cones: a station-filtered range is not labelled "line"', () => {
  it('with a station filter the CSV carries the winder\'s own row and no line row', async () => {
    const { pool } = fakePool({ list: [LIST[0]!], ranges: [{ st: 7, n: 12, sm: 23400, mn: 1930, mx: 1990, bad: 0 }] });
    const r = await getRejectedConesReport(pool, 1, PERIOD, { station: 7 });
    const t = rejectedConesCsv(r);
    const scopes = t.rows.filter((x) => x[0] === 'weight_range').map((x) => x[t.headers.indexOf('scope')]);
    expect(scopes).toEqual(['winder']);
    const w = t.rows.find((x) => x[0] === 'weight_range')!;
    expect(w[t.headers.indexOf('winder')]).toBe(7);
    expect(w[t.headers.indexOf('n')]).toBe(12);
  });

  it('a filtered winder that weighed nothing still gets its own empty row, not a mislabelled line row', async () => {
    const { pool } = fakePool({ list: [], ranges: [] });
    const r = await getRejectedConesReport(pool, 1, PERIOD, { station: 9 });
    const t = rejectedConesCsv(r);
    const rows = t.rows.filter((x) => x[0] === 'weight_range');
    expect(rows).toHaveLength(1);
    expect(rows[0]![t.headers.indexOf('scope')]).toBe('winder');
    expect(rows[0]![t.headers.indexOf('winder')]).toBe(9);
    expect(rows[0]![t.headers.indexOf('n')]).toBe(0);
  });

  it('without a station filter the line row stays first', async () => {
    const { pool } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, { shift: 'morning' });
    const t = rejectedConesCsv(r);
    expect(t.rows.filter((x) => x[0] === 'weight_range').map((x) => x[t.headers.indexOf('scope')])[0]).toBe('line');
  });
});

/* -------------------------------------------- W0: the frozen contract */

describe('rejected-cones: the frozen contract (task W0, 1 Oct 2026)', () => {
  it('the CSV headers are exactly IFL report 6\'s final headers', () => {
    expect([...REJECTED_CONES_CSV_HEADERS]).toEqual([
      'section', 'date', 'shift', 'produced_at_plant_time', 'winder', 'hanger', 'weight_g', 'product', 'material_id', 'limits',
      'target_g', 'lo_g', 'hi_g', 'outside_by_g', 'limits_lower_bound', 'scope', 'n', 'min_g', 'max_g', 'avg_g',
    ]);
  });

  it('the report carries the list totals and the cap, the new row fields and what it assumes', async () => {
    const { pool } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.listTotal).toBe(3);
    expect(r.listCap).toBe(LIST_CAP);
    expect(r.listCap).toBe(5000);
    expect(r.excludedClockFault).toBe(0);
    expect(r.pendingIfl.length).toBeGreaterThan(0);
    // No product on record for these (material-less, pre-timeline) rows: the fields are present and say so.
    for (const row of r.list) {
      expect(row).toMatchObject({ productId: null, productLabel: null, productSource: null, limits: null, outsideByG: null, noLimitsReason: NO_PRODUCT_AT_TIME });
    }
    expect(r.list.map((x) => x.hanger)).toEqual([41, 7, null]);
  });

  it('timestamps leave as the plant wall clock, no Z, and a product-less row says so in words', async () => {
    const { pool } = fakePool();
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const t = rejectedConesCsv(r);
    const col = (name: string) => t.headers.indexOf(name);
    const first = t.rows.find((x) => x[0] === 'rejected_cone')!;
    expect(first[col('produced_at_plant_time')]).toBe('2026-09-01 07:00:00');
    expect(first[col('product')]).toBe(NO_PRODUCT_AT_TIME);
    expect(first[col('material_id')]).toBeNull();
    expect(t.headers).not.toContain('produced_at');
  });

  it('serialises a row with limits in force: label, target, bounds, signed outside-by and the lower-bound qualifier', () => {
    const row: RejectedConeRow = {
      date: '2026-08-15', shift: 'evening', winder: 6, hanger: 178, weightG: 2035, producedAtUtc: '2026-08-15T18:04:09.000Z',
      productId: 1021, productLabel: 'Product 1021', productSource: 'row',
      limits: { label: '1,960 ± 40 g', targetG: 1960, loG: 1920, hiG: 2000, lowerBound: true }, outsideByG: 35, noLimitsReason: null,
    };
    const data = {
      list: [row], total: 1, listTotal: 1, listCap: LIST_CAP, excludedClockFault: 0,
      weightRange: { line: { n: 0, minG: null, maxG: null, avgG: null }, byWinder: [] },
    } as unknown as RejectedConesReportData;
    const t = rejectedConesCsv(data);
    const col = (name: string) => t.headers.indexOf(name);
    const x = t.rows.find((r) => r[0] === 'rejected_cone')!;
    expect(x).toHaveLength(t.headers.length);
    expect([
      x[col('hanger')], x[col('weight_g')], x[col('product')], x[col('material_id')], x[col('limits')], x[col('target_g')], x[col('lo_g')], x[col('hi_g')],
      x[col('outside_by_g')], x[col('limits_lower_bound')], x[col('produced_at_plant_time')],
    ]).toEqual([178, 2035, 'Product 1021', 1021, '1,960 ± 40 g', 1960, 1920, 2000, 35, true, '2026-08-15 18:04:09']);
  });
});

/* ---------------------------------------------------- registration + notes */

describe('rejected-cones: registration and disclosure', () => {
  it('is registered in IFL\'s own words, at rank 1 with the shift and station filters', () => {
    expect(REPORT_TYPES).toContain('rejected-cones');
    expect(REPORT_TITLES['rejected-cones']).toBe('List of Rejected Cones Against Weight');
    expect(REPORT_RANK['rejected-cones']).toBe(1);
    expect(FILTERS_BY_TYPE['rejected-cones']).toEqual(['shift', 'station']);
    expect(REPORT_TYPES.indexOf('rejected-cones')).toBe(11);
  });

  it('buildReport dispatches to the builder', async () => {
    const { pool } = fakePool();
    const r = await buildReport(pool, 1, 'rejected-cones', PERIOD, {});
    expect(r.total).toBe(3);
  });

  it('a simulator source is disclosed on the header, in the CSV rows and the document', async () => {
    const { pool } = fakePool();
    const type = 'rejected-cones' as const;
    const data = await buildReport(pool, 1, type, PERIOD, {});
    const sim = {
      ...data,
      generationNote: {
        generation: { key: 'DATA_TP1U2_SIM#1', sourceDb: 'DATA_TP1U2_SIM', ordinal: 1, label: 'pack1_TP1U2 gen 1', simulator: true },
        spansGenerations: true,
        otherGenerationExcluded: 120,
        excludedSimulator: 0,
      },
    };
    const header = await buildHeader(pool, 1, {
      reportType: type, period: PERIOD, filters: {}, user: { username: 'u', displayName: 'U' }, lineNameFallback: 'Line 3', reportData: sim,
    });
    expect(header.simulatorSource).toBe(true);
    expect(header.spansGenerations).toBe(true);
    expect(header.generationLine).toMatch(/plant simulator/i);
    const rows = attributionRows(header).map((r) => r[0]).join('\n');
    expect(rows).toMatch(/Data batch:/);
    expect(rows).toMatch(/Excluded from another data batch: 120 readings/);
    expect(csvDocument(['a'], [[1]], header)).toMatch(/Data batch:/);
    expect(header.title).toBe(REPORT_TITLES[type]);
  });
});

/* ------------- W1-R6: R1 and R6 agree on the weight rejects (one dataset, both builders) */

describe('rejected-cones agrees with shift-production on how many cones were rejected on weight', () => {
  // The two reports answer one question from two angles: R1 counts the weight rejects per winder, R6 lists them.
  // They must never differ. This pool EVALUATES each query's filters over ONE in-memory dataset (the idiom of
  // shiftProduction.dataset.test.ts), so both builders count what the SQL would count, not what a canned row says.
  type Sh = 'morning' | 'evening' | 'night';
  interface DCone { id: number; day: string; shift: Sh; ts: number; epoch: number; station: number | null; hanger: number | null }
  interface DRej extends Omit<DCone, 'id'> { type: 'weight' | 'quality'; w: number | null; mid: number | null }
  const REG = [
    { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
    { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - quality rejects' },
    { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
    { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
    { epoch_id: 16, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectWeight1_TP1U2 gen 4' },
  ];
  const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00Z`);
  let seq = 1;
  const cone = (day: string, shift: Sh, hhmm: string, hanger: number, station: number | null, epoch = 9): DCone => ({ id: seq++, day, shift, ts: at(day, hhmm), epoch, station, hanger });
  const rej = (day: string, shift: Sh, hhmm: string, hanger: number | null, station: number | null, type: 'weight' | 'quality', w: number | null, epoch: number): DRej =>
    ({ day, shift, ts: at(day, hhmm), epoch, station, hanger, type, w, mid: null });

  const CONES: DCone[] = [
    ...Array.from({ length: 10 }, (_, i) => cone('2026-09-10', 'morning', `06:${10 + i}`, i + 1, 1)),
    ...Array.from({ length: 5 }, (_, i) => cone('2026-09-10', 'evening', `14:${10 + i}`, 20 + i, 2)),
    // the plant simulator's cones on the same day: out of scope for the real generation
    ...Array.from({ length: 4 }, (_, i) => cone('2026-09-10', 'morning', `06:${30 + i}`, 100 + i, 1, 13)),
  ];
  const REJECTS: DRej[] = [
    rej('2026-09-10', 'morning', '06:12', 3, 1, 'weight', 2032, 12), // the same cone as CONES[2]: logged twice
    rej('2026-09-10', 'morning', '07:30', 250, 1, 'weight', 2040, 12), // no cone row
    rej('2026-09-10', 'evening', '14:11', 21, 2, 'weight', null, 12), // a weight reject with no weight recorded: still a reject
    rej('2026-09-11', 'night', '23:00', 18, 3, 'weight', 1500, 12), // no cone row, another day and winder
    rej('2026-09-10', 'morning', '06:14', 5, 1, 'quality', null, 11), // quality: in neither report
    rej('2026-09-10', 'morning', '06:32', 102, 1, 'weight', 1500, 16), // simulator generation: in neither report
    rej('2026-09-12', 'morning', '07:00', 4, 1, 'weight', 2040, 12), // outside the period
  ];

  function evaluate(sql: string, p: Map<string, unknown>): Record<string, unknown>[] {
    if (sql.includes('FROM sms.source_epoch')) return REG;
    if (sql.includes('GROUP BY source_epoch')) {
      const rows: Record<string, unknown>[] = [];
      const win = (r: { day: string }) => (!p.has('genFrom') || r.day >= String(p.get('genFrom'))) && (!p.has('genTo') || r.day <= String(p.get('genTo')));
      const by = (t: { epoch: number; day: string }[], tbl: string) => {
        const m = new Map<number, number>();
        for (const r of t.filter(win)) m.set(r.epoch, (m.get(r.epoch) ?? 0) + 1);
        for (const [epoch_id, n] of m) rows.push({ tbl, epoch_id, n });
      };
      if (sql.includes('FROM sms.cone_event')) by(CONES, 'cone_event');
      if (sql.includes('FROM sms.reject_event')) by(REJECTS, 'reject_event');
      return rows;
    }
    if (sql.includes('sms.plausibility_rule') || sql.includes('sms.weight_rule') || sql.includes('sms.product')) return [];

    // the generation as the SQL USES it: only the epoch parameters the query text names count
    const ids = (letter: 'c' | 'r') => [...sql.matchAll(new RegExp(`@(ge${letter}\\d+)`, 'g'))].map((m) => Number(p.get(m[1]!)));
    const coneIds = ids('c');
    const rejIds = ids('r');
    const inPeriod = (r: { day: string; shift: Sh }) =>
      r.day >= String(p.get('from')) && r.day <= String(p.get('to')) && (!p.has('shift') || r.shift === p.get('shift'));
    const coneOk = (c: DCone) => inPeriod(c) && (coneIds.length === 0 || coneIds.includes(c.epoch));
    const rejOk = (r: DRej, filterStation: boolean) =>
      inPeriod(r) && r.type === 'weight' && (rejIds.length === 0 || rejIds.includes(r.epoch)) && (!filterStation || !p.has('station') || r.station === p.get('station')) &&
      // a query that (wrongly) asks for weight_g IS NOT NULL drops the reject with no recorded weight, as the SQL would
      (!sql.includes('weight_g IS NOT NULL') || r.w != null);
    const sameKey = (c: DCone, r: DRej) => c.ts === r.ts && (c.hanger ?? -1) === (r.hanger ?? -1);
    const group = <T extends { day: string; shift: Sh; station: number | null }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(`${r.day}|${r.shift}|${r.station}`, [...(m.get(`${r.day}|${r.shift}|${r.station}`) ?? []), r]);
      return [...m.values()];
    };
    const head = (r: { day: string; shift: Sh; station: number | null }) => ({ d: r.day, sc: r.shift, st: r.station });

    // ---- R6's own three queries
    if (sql.includes('TOP (@cap)') && sql.includes('FROM sms.reject_event')) {
      return REJECTS.filter((r) => rejOk(r, true) && r.ts > 0).sort((a, b) => a.ts - b.ts)
        .map((r) => ({ d: new Date(`${r.day}T00:00:00Z`), sc: r.shift, st: r.station, hg: r.hanger, w: r.w, ts: new Date(r.ts), mid: r.mid }));
    }
    if (sql.includes('COUNT(*) AS n') && sql.includes('AS fault')) {
      const rows = REJECTS.filter((r) => rejOk(r, true));
      return [{ n: rows.length, fault: rows.filter((r) => r.ts <= 0).length }];
    }
    if (sql.includes('AS sm')) return [];
    // ---- R1's four queries
    if (sql.includes('COUNT(DISTINCT hanger_num)')) return [{ h: new Set(CONES.filter(coneOk).map((c) => c.hanger)).size }];
    if (sql.includes('JOIN sms.cone_event')) {
      const matched = CONES.filter((c) => coneOk(c) && REJECTS.some((r) => rejOk(r, false) && sameKey(c, r)));
      return group(matched).map((g) => ({ ...head(g[0]!), n: new Set(g.map((c) => c.id)).size }));
    }
    if (sql.includes('FROM sms.reject_event')) return group(REJECTS.filter((r) => rejOk(r, false))).map((g) => ({ ...head(g[0]!), n: g.length }));
    if (sql.includes('AS pn')) return group(CONES.filter(coneOk)).map((g) => ({ ...head(g[0]!), n: g.length, pn: g.length, g: g.length * 1950, sr: 0 }));
    throw new Error(`unexpected query: ${sql}`);
  }

  function datasetPool(): ConnectionPool {
    return {
      request: () => {
        const inputs = new Map<string, unknown>();
        const req = {
          input: (n: string, _t: unknown, v: unknown) => { inputs.set(n, v); return req; },
          query: async (sql: string) => ({ recordset: evaluate(sql, inputs) }),
        };
        return req;
      },
    } as unknown as ConnectionPool;
  }
  const PD = { period: 'custom' as const, from: '2026-09-10', to: '2026-09-11' };

  it('over the period: the list has as many rows as shift-production counts weight rejects (a reject with no cone row, and one with no weight, included)', async () => {
    const [a, b] = [await getRejectedConesReport(datasetPool(), 1, PD, {}), await getShiftProductionReport(datasetPool(), 1, PD, {})];
    // 4 weight rejects in the real generation; the quality reject, the simulator reject and the 12 Sep reject are in neither
    expect(a.total).toBe(4);
    expect(a.list).toHaveLength(4);
    expect(b.grandTotal.weightRejects).toBe(4);
    expect(a.total).toBe(b.grandTotal.weightRejects);
    expect(a.list.map((r) => r.hanger)).toEqual([3, 250, 21, 18]);
    expect(a.list.find((r) => r.hanger === 21)!.weightG).toBeNull();
  });

  it('under a shift filter the two still agree', async () => {
    for (const shift of ['morning', 'evening', 'night'] as const) {
      const a = await getRejectedConesReport(datasetPool(), 1, PD, { shift });
      const b = await getShiftProductionReport(datasetPool(), 1, PD, { shift });
      expect([shift, a.total]).toEqual([shift, b.grandTotal.weightRejects]);
    }
    expect((await getRejectedConesReport(datasetPool(), 1, PD, { shift: 'morning' })).total).toBe(2);
  });

  it('a winder\'s rejects are that winder\'s row in shift-production', async () => {
    const b = await getShiftProductionReport(datasetPool(), 1, PD, {});
    for (const winder of [1, 2, 3]) {
      const a = await getRejectedConesReport(datasetPool(), 1, PD, { station: winder });
      const theirs = b.rows.filter((r) => r.winder === winder).reduce((s, r) => s + r.weightRejects, 0);
      expect([winder, a.total]).toEqual([winder, theirs]);
    }
  });
});
