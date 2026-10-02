/**
 * Rejected Unknown (Lifter) Report — IFL report 8 of 8 (task W1-R8, 1 Oct 2026).
 *
 * The pool is a recording fake that answers by the shape of the SQL; a fake
 * cannot execute a WHERE, so filters and generation scoping are proven by the
 * SQL text and the parameters bound on it, and the arithmetic (inspected,
 * rate, the unknown count, why[]) by the rows it returns.
 *
 * The DEFINITION is a draft: an "unknown lifter" is a reject with no lifter or no
 * winder number recorded, and nothing else (orchestrator decision, 1 Oct 2026).
 * A zero reason code is NOT an unknown lifter; it is counted in table A and
 * listed in its own, separately titled list. The cases below pin that draft and
 * the three promises the report makes around it: it is empty in a normal period
 * and says so, the zeroed-clock records are listed for the period's OWN
 * generation whatever period is chosen, and every count comes from one source
 * generation.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'IFL' }, unit: { name: 'Unit 2' } })) }));

import {
  getRejectedUnknownLifterReport, rejectedUnknownLifterCsv, whyUnknown, REJECTED_UNKNOWN_LIFTER_CSV_HEADERS, REJECTED_UNKNOWN_LIFTER_EMPTY,
  REJECTED_UNKNOWN_LIFTER_NOTE, REJECTED_UNKNOWN_LIFTER_PENDING_IFL, LIFTERS_ON_LINE, whyNoLifter, whyZeroCode,
  WHY_NO_LIFTER, WHY_NO_WINDER, WHY_ZERO_CODE, WHY_CLOCK_ZEROED,
} from './rejectedUnknownLifter.js';
import { REPORT_TYPES, REPORT_TITLES, REPORT_RANK, FILTERS_BY_TYPE, LIST_CAP } from './common.js';
import { buildReport, reportCsv } from './index.js';
import type { ShiftRange } from '../../shiftRange.js';

interface Call { sql: string; params: Map<string, unknown> }
type Rows = Record<string, unknown>[];

interface FakeData {
  cones?: Rows;
  /** Per-lifter reject aggregates: { li, q, zq, w, nl, fault } (nl = no lifter or no winder). */
  rejects?: Rows;
  /** getUnmatchedRejects' rows: { grp, n }. */
  unmatched?: Rows;
  /** Table B: no lifter or no winder recorded. */
  list?: Rows;
  /** Table B2: a zero reason code. */
  zerolist?: Rows;
  /** Block C. */
  zeroed?: Rows;
  epochs?: Rows;
  present?: Rows;
}

const kind = (sql: string): 'unmatched' | 'cones' | 'rejects' | 'list' | 'zerolist' | 'zeroed' | 'other' => {
  if (sql.includes('NOT EXISTS')) return 'unmatched';
  if (sql.includes('GROUP BY lifter_station') && sql.includes('FROM sms.cone_event')) return 'cones';
  if (sql.includes('GROUP BY lifter_station')) return 'rejects';
  if (sql.includes('TOP (@cap)') && sql.includes('production_ts_utc_ms > 0') && sql.includes('tube_inspect_code = 0')) return 'zerolist';
  if (sql.includes('TOP (@cap)') && sql.includes('production_ts_utc_ms > 0')) return 'list';
  if (sql.includes('TOP (@cap)') && sql.includes('production_ts_utc_ms <= 0')) return 'zeroed';
  return 'other';
};

function fakePool(data: FakeData = {}): { pool: ConnectionPool; calls: (Call & { kind: ReturnType<typeof kind> })[] } {
  const calls: (Call & { kind: ReturnType<typeof kind> })[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (n: string, _t: unknown, v: unknown) => { params.set(n, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('GROUP BY source_epoch')) return { recordset: data.present ?? [], rowsAffected: [0] };
          if (sql.includes('FROM sms.source_epoch')) return { recordset: data.epochs ?? [], rowsAffected: [0] };
          const k = kind(sql);
          calls.push({ sql, params, kind: k });
          const rows = { unmatched: data.unmatched, cones: data.cones, rejects: data.rejects, list: data.list, zerolist: data.zerolist, zeroed: data.zeroed, other: [] }[k] ?? [];
          return { recordset: rows, rowsAffected: [0] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const PERIOD = { period: 'custom' as const, from: '2026-08-15', to: '2026-08-15' };
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const reject = (over: Rows[number] = {}): Rows[number] => ({
  d: day('2026-08-15'), sc: 'night', ts: new Date('2026-08-16T04:17:16.150Z'), hg: 27, st: 2, li: 2, rt: 'quality', tc: 0, mc: 0, w: null, ...over,
});

const EPOCHS: Rows = [
  { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones' },
  { epoch_id: 3, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - quality rejects' },
  { epoch_id: 4, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - weight rejects' },
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - quality rejects' },
  { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
];
const PRESENT_BOTH: Rows = [
  { tbl: 'cone_event', epoch_id: 9, n: 5000 },
  { tbl: 'reject_event', epoch_id: 11, n: 200 },
  { tbl: 'reject_event', epoch_id: 12, n: 3 },
  { tbl: 'cone_event', epoch_id: 1, n: 400 },
  { tbl: 'reject_event', epoch_id: 3, n: 20 },
  { tbl: 'reject_event', epoch_id: 4, n: 1 },
];

/* ------------------------------------------------------------ A: per lifter */

describe('rejected-unknown-lifter: table A, per lifter', () => {
  const cones: Rows = [{ li: 1, n: 100 }, { li: 2, n: 50 }, { li: null, n: 2 }];
  const rejects: Rows = [
    { li: 1, q: 3, zq: 0, w: 1, nl: 0, fault: 0 },
    { li: 2, q: 2, zq: 0, w: 0, nl: 0, fault: 0 },
  ];

  it('lists lifters 1..14 in order, with cones, inspected (cones + unmatched rejects), rejects and a 2 dp rate', async () => {
    const { pool } = fakePool({ cones, rejects, unmatched: [{ grp: '1', n: 1 }] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(LIFTERS_ON_LINE).toBe(14);
    expect(r.lifters.slice(0, 14).map((x) => x.lifter)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(r.lifters[0]).toEqual({ lifter: 1, cones: 100, inspected: 101, qualityRejects: 3, zeroCodeRejects: 0, weightRejects: 1, total: 4, ratePct: 3.96 });
    expect(r.lifters[1]).toMatchObject({ lifter: 2, cones: 50, inspected: 50, total: 2, ratePct: 4 });
    // a lifter with no record at all is still a row, with a null rate, not a divide by zero
    expect(r.lifters[2]).toEqual({ lifter: 3, cones: 0, inspected: 0, qualityRejects: 0, zeroCodeRejects: 0, weightRejects: 0, total: 0, ratePct: null });
  });

  it('the "No lifter recorded" bucket comes last, and only when it has anything', async () => {
    const withNone = await getRejectedUnknownLifterReport(fakePool({ cones, rejects, unmatched: [] }).pool, 1, PERIOD, {});
    expect(withNone.lifters).toHaveLength(15);
    expect(withNone.lifters[14]).toMatchObject({ lifter: null, cones: 2, inspected: 2 });
    const without = await getRejectedUnknownLifterReport(fakePool({ cones: cones.slice(0, 2), rejects, unmatched: [] }).pool, 1, PERIOD, {});
    expect(without.lifters).toHaveLength(14);
    expect(without.lifters.some((x) => x.lifter == null)).toBe(false);
  });

  it('the total row sums every lifter and the bucket, and uses the same rate rule', async () => {
    const { pool } = fakePool({ cones, rejects, unmatched: [{ grp: '1', n: 1 }, { grp: 'none', n: 1 }] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    // cones 152, unmatched 2 => inspected 154; rejects 5 + 1 = 6 total (3 + 2 quality, 1 weight)
    expect(r.total).toEqual({ lifter: null, cones: 152, inspected: 154, qualityRejects: 5, zeroCodeRejects: 0, weightRejects: 1, total: 6, ratePct: 3.9 });
  });

  it('a rejected cone with no cone row is an inspected unit: grouped by the REJECT\'s lifter, zeroed-clock ones parked apart', async () => {
    const { pool, calls } = fakePool({ cones, rejects, unmatched: [{ grp: '2', n: 3 }, { grp: 'fault', n: 9 }] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.lifters[1]!.inspected).toBe(53); // 50 cones + 3 unmatched
    expect(r.total.inspected).toBe(152 + 3); // the 'fault' group is not in the denominator
    const q = calls.find((c) => c.kind === 'unmatched')!;
    expect(q.sql).toContain('re.lifter_station');
    expect(q.sql).toContain('re.production_ts_utc_ms <= 0');
  });

  it('a lifter number beyond 14 is listed, never dropped', async () => {
    const { pool } = fakePool({ cones: [{ li: 15, n: 7 }], rejects: [], unmatched: [] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.lifters.map((x) => x.lifter)).toContain(15);
    expect(r.lifters.find((x) => x.lifter === 15)).toMatchObject({ cones: 7, inspected: 7 });
  });

  it('counts the zero reason code among QUALITY rejects only, in SQL, as tube 0 OR material 0 (the draft)', async () => {
    const { pool, calls } = fakePool({ cones, rejects: [{ li: 1, q: 3, zq: 2, w: 0, nl: 0, fault: 0 }], unmatched: [], zerolist: [reject(), reject()] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.lifters[0]!.zeroCodeRejects).toBe(2);
    expect(r.total.zeroCodeRejects).toBe(2);
    const q = calls.find((c) => c.kind === 'rejects')!;
    expect(q.sql).toContain("reject_type = 'quality' AND (tube_inspect_code = 0 OR material_inspect_code = 0)");
  });
});

/* ------------------------------------ B: the rejects with no lifter or winder */

describe('rejected-unknown-lifter: table B (no lifter or winder) and the empty state', () => {
  it('a period where every reject carries a lifter has no list, never runs the list query, and says so', async () => {
    const { pool, calls } = fakePool({
      cones: [{ li: 1, n: 100 }], rejects: [{ li: 1, q: 3, zq: 0, w: 1, nl: 0, fault: 0 }], unmatched: [], list: [reject()],
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.unknownCount).toBe(0);
    expect(r.list).toEqual([]);
    expect(r.listTotal).toBe(0);
    expect(calls.some((c) => c.kind === 'list')).toBe(false);
    expect(REJECTED_UNKNOWN_LIFTER_EMPTY).toBe('Every rejected cone in this period carries a lifter number.');
  });

  it('REGRESSION: a reject with a lifter, a winder and a ZERO reason code is not an unknown-lifter reject (it is B2 own, not B)', async () => {
    // 2026-08-15, the real Sept day: one quality reject, hanger 27, lifter 2, winder 2, codes 0/0.
    const { pool, calls } = fakePool({
      cones: [{ li: 2, n: 4854 }], rejects: [{ li: 2, q: 1, zq: 1, w: 0, nl: 0, fault: 0 }], unmatched: [], list: [reject()], zerolist: [reject()],
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.unknownCount).toBe(0);
    expect(r.list).toEqual([]);
    expect(r.listTotal).toBe(0);
    expect(calls.some((c) => c.kind === 'list')).toBe(false);
    expect(r.zeroCodeTotal).toBe(1);
    expect(r.zeroCodeList).toHaveLength(1);
    expect(r.zeroCodeList[0]).toMatchObject({ hanger: 27, winder: 2, lifter: 2, tubeCode: 0, materialCode: 0, why: [WHY_ZERO_CODE] });
    // the zero code is still counted in table A's "of which" column
    expect(r.lifters[1]).toMatchObject({ lifter: 2, qualityRejects: 1, zeroCodeRejects: 1 });
  });

  it('lists each no-lifter reject with why: no lifter, no winder, in the order returned', async () => {
    const list: Rows = [
      reject({ ts: new Date('2026-08-15T08:00:00Z'), sc: 'morning', li: null, st: null, hg: 105, tc: 1, mc: 11 }),
      reject({ ts: new Date('2026-08-16T04:17:16.150Z'), li: null, st: 2, hg: 27, tc: 2, mc: 1 }),
      reject({ ts: new Date('2026-08-16T05:00:00Z'), li: 14, st: null, hg: 8, rt: 'weight', tc: null, mc: null, w: 2035 }),
    ];
    const { pool, calls } = fakePool({
      cones: [{ li: 2, n: 10 }], rejects: [{ li: null, q: 2, zq: 0, w: 0, nl: 2, fault: 0 }, { li: 14, q: 0, zq: 0, w: 1, nl: 1, fault: 0 }], unmatched: [], list,
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.unknownCount).toBe(3);
    expect(r.listTotal).toBe(3);
    expect(r.list.map((x) => x.why)).toEqual([
      [WHY_NO_LIFTER, WHY_NO_WINDER],
      [WHY_NO_LIFTER],
      [WHY_NO_WINDER],
    ]);
    expect(r.list[0]).toMatchObject({ hanger: 105, winder: null, lifter: null, rejectType: 'quality', tubeCode: 1, materialCode: 11, weightG: null, producedAtUtc: '2026-08-15T08:00:00.000Z' });
    expect(r.list[2]).toMatchObject({ rejectType: 'weight', tubeCode: null, materialCode: null, weightG: 2035, lifter: 14 });
    const q = calls.find((c) => c.kind === 'list')!;
    expect(q.sql).toMatch(/ORDER BY production_ts_utc_ms/);
    expect(q.params.get('cap')).toBe(LIST_CAP);
    // a no-lifter list is not a zero-code list
    expect(calls.some((c) => c.kind === 'zerolist')).toBe(false);
  });

  it('the unknown predicate is no lifter OR no winder, on SQL and JS alike, and nothing about a reason code', async () => {
    const { pool, calls } = fakePool({ cones: [{ li: 1, n: 1 }], rejects: [{ li: null, q: 1, zq: 0, w: 0, nl: 1, fault: 0 }], unmatched: [], list: [reject({ li: null })] });
    await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    const sql = calls.find((c) => c.kind === 'list')!.sql;
    expect(sql).toContain('lifter_station IS NULL');
    expect(sql).toContain('source_station IS NULL');
    expect(sql).not.toContain('tube_inspect_code = 0');
    expect(sql).not.toContain('material_inspect_code = 0');
    expect(sql).toContain('production_ts_utc_ms > 0');
    // and the aggregate's own "unknown" count (nl) carries no code term either
    const agg = calls.find((c) => c.kind === 'rejects')!.sql;
    const nl = agg.slice(agg.indexOf('AS zq'), agg.indexOf('AS nl'));
    expect(nl).not.toContain('tube_inspect_code');
  });

  it('whyNoLifter / whyZeroCode / whyUnknown each name only the reasons they own', () => {
    const clean = { lifter: 3, winder: 3, rejectType: 'quality', tubeCode: 2, materialCode: 1 };
    expect(whyNoLifter(clean)).toEqual([]);
    expect(whyNoLifter({ ...clean, lifter: null })).toEqual([WHY_NO_LIFTER]);
    expect(whyNoLifter({ ...clean, lifter: 0, winder: null })).toEqual([WHY_NO_LIFTER, WHY_NO_WINDER]);
    const zeroCodedNoWinder = { ...clean, winder: null, tubeCode: 0 };
    expect(whyNoLifter(zeroCodedNoWinder)).toEqual([WHY_NO_WINDER]); // a zero code is not an unknown lifter
    expect(whyZeroCode(clean)).toEqual([]);
    expect(whyZeroCode({ ...clean, tubeCode: 0 })).toEqual([WHY_ZERO_CODE]);
    expect(whyZeroCode({ ...clean, materialCode: 0 })).toEqual([WHY_ZERO_CODE]);
    // a weight reject carries no code, so it is never zero-coded
    expect(whyZeroCode({ ...clean, rejectType: 'weight', tubeCode: null, materialCode: null })).toEqual([]);
    expect(whyZeroCode({ ...clean, rejectType: 'weight', tubeCode: 0, materialCode: 0 })).toEqual([]);
    // every reason together (the zeroed-clock block uses this)
    expect(whyUnknown(clean)).toEqual([]);
    expect(whyUnknown({ ...clean, lifter: null, tubeCode: 0 })).toEqual([WHY_NO_LIFTER, WHY_ZERO_CODE]);
    expect(whyUnknown({ ...clean, zeroedClock: true })).toEqual([WHY_CLOCK_ZEROED]);
  });

  it('the list is cut at the cap, listTotal is the real count, and the note says so', async () => {
    const many: Rows = Array.from({ length: LIST_CAP }, (_, i) => reject({ li: null, ts: new Date(Date.UTC(2026, 7, 15, 8, 0, 0) + i * 1000) }));
    const { pool } = fakePool({ cones: [{ li: 2, n: 99999 }], rejects: [{ li: null, q: 7000, zq: 0, w: 0, nl: 7000, fault: 0 }], unmatched: [], list: many });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.list).toHaveLength(5000);
    expect(r.listTotal).toBe(7000);
    expect(r.unknownCount).toBe(7000);
    expect(r.listCap).toBe(5000);
    expect(r.note).toContain('Only the first 5,000 of 7,000 rejects with no lifter or winder recorded are listed');
  });

  it('zeroed-clock records inside the period are counted as clock faults and left out of A, B and B2', async () => {
    const { pool, calls } = fakePool({ cones: [{ li: 1, n: 10 }], rejects: [{ li: 1, q: 1, zq: 0, w: 0, nl: 0, fault: 2 }, { li: null, q: 0, zq: 0, w: 0, nl: 0, fault: 1 }], unmatched: [] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.excludedClockFault).toBe(3);
    const q = calls.find((c) => c.kind === 'rejects')!;
    expect(q.sql).toContain("production_ts_utc_ms > 0 AND reject_type = 'quality'");
    expect(q.sql).toContain('production_ts_utc_ms <= 0');
    // the detail lists exclude them too
    const { pool: p2, calls: c2 } = fakePool({ cones: [{ li: 1, n: 10 }], rejects: [{ li: null, q: 1, zq: 1, w: 0, nl: 1, fault: 1 }], unmatched: [], list: [reject({ li: null })], zerolist: [reject({ li: null })] });
    await getRejectedUnknownLifterReport(p2, 1, PERIOD, {});
    expect(c2.find((c) => c.kind === 'list')!.sql).toContain('production_ts_utc_ms > 0');
    expect(c2.find((c) => c.kind === 'zerolist')!.sql).toContain('production_ts_utc_ms > 0');
  });
});

/* ------------------------------ B2: the rejects with a zero reason code */

describe('rejected-unknown-lifter: table B2, a zero reason code (a separate list; meaning not confirmed by IFL)', () => {
  it('lists each zero-coded reject with its own why, in the order returned, on its own query', async () => {
    const zerolist: Rows = [
      reject({ ts: new Date('2026-08-15T09:00:00Z'), sc: 'morning', hg: 31, tc: 2, mc: 0 }),
      reject({ ts: new Date('2026-08-16T04:17:16.150Z'), hg: 27, tc: 0, mc: 0 }),
    ];
    const { pool, calls } = fakePool({
      cones: [{ li: 2, n: 4854 }], rejects: [{ li: 2, q: 5, zq: 2, w: 0, nl: 0, fault: 0 }], unmatched: [], zerolist,
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroCodeTotal).toBe(2);
    expect(r.zeroCodeTotal).toBe(r.total.zeroCodeRejects); // list total and the table's own column cannot disagree
    expect(r.zeroCodeList.map((x) => [x.hanger, x.tubeCode, x.materialCode])).toEqual([[31, 2, 0], [27, 0, 0]]);
    expect(r.zeroCodeList.every((x) => x.why.length === 1 && x.why[0] === WHY_ZERO_CODE)).toBe(true);
    const q = calls.find((c) => c.kind === 'zerolist')!;
    expect(q.sql).toContain("reject_type = 'quality' AND (tube_inspect_code = 0 OR material_inspect_code = 0)");
    expect(q.sql).toMatch(/ORDER BY production_ts_utc_ms/);
    expect(q.params.get('cap')).toBe(LIST_CAP);
    // no lifter-less reject here, so the no-lifter list is never queried
    expect(calls.some((c) => c.kind === 'list')).toBe(false);
  });

  it('a reject with no lifter AND a zero code is on both lists, each naming its own reason', async () => {
    const both = reject({ li: null, st: null, hg: 12, tc: 0, mc: 0 });
    const { pool } = fakePool({
      cones: [{ li: 1, n: 10 }], rejects: [{ li: null, q: 1, zq: 1, w: 0, nl: 1, fault: 0 }], unmatched: [], list: [both], zerolist: [both],
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.list[0]!.why).toEqual([WHY_NO_LIFTER, WHY_NO_WINDER]);
    expect(r.zeroCodeList[0]!.why).toEqual([WHY_ZERO_CODE]);
  });

  it('with no zero-coded reject in the period the list is empty and its query never runs', async () => {
    const { pool, calls } = fakePool({ cones: [{ li: 1, n: 100 }], rejects: [{ li: 1, q: 3, zq: 0, w: 1, nl: 0, fault: 0 }], unmatched: [], zerolist: [reject()] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroCodeList).toEqual([]);
    expect(r.zeroCodeTotal).toBe(0);
    expect(calls.some((c) => c.kind === 'zerolist')).toBe(false);
  });

  it('is cut at the cap with its own real total and its own note sentence', async () => {
    const many: Rows = Array.from({ length: LIST_CAP }, (_, i) => reject({ ts: new Date(Date.UTC(2026, 7, 15, 8, 0, 0) + i * 1000) }));
    const { pool } = fakePool({ cones: [{ li: 2, n: 99999 }], rejects: [{ li: 2, q: 7000, zq: 7000, w: 0, nl: 0, fault: 0 }], unmatched: [], zerolist: many });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroCodeList).toHaveLength(5000);
    expect(r.zeroCodeTotal).toBe(7000);
    expect(r.note).toContain('Only the first 5,000 of 7,000 rejects with a zero reason code are listed');
    expect(r.note).not.toContain('with no lifter or winder recorded are listed');
  });

  it('the one generation, the filters and shiftRange scope this list like the others', async () => {
    const range: ShiftRange = { from: '2026-08-15', fromShift: 'morning', to: '2026-08-15', toShift: 'evening' };
    const { pool, calls } = fakePool({
      cones: [{ li: 1, n: 5 }], rejects: [{ li: 1, q: 1, zq: 1, w: 0, nl: 0, fault: 0 }], unmatched: [], zerolist: [reject()], epochs: EPOCHS, present: PRESENT_BOTH,
    });
    await getRejectedUnknownLifterReport(pool, 1, PERIOD, { shift: 'evening', product: 1021 }, range);
    const c = calls.find((x) => x.kind === 'zerolist')!;
    expect(c.params.get('shift')).toBe('evening');
    expect(c.params.get('product')).toBe(1021);
    expect(c.params.get('srFromOrd')).toBe(1);
    expect([c.params.get('ger0'), c.params.get('ger1')]).toEqual([11, 12]);
  });
});

/* ----------------------------------------------- C: the zeroed-clock block */

describe('rejected-unknown-lifter: block C, the zeroed-clock records of the period\'s own generation', () => {
  const sentinel = reject({ d: day('1969-12-31'), sc: 'night', ts: new Date('1970-01-01T00:00:00Z'), hg: 270, st: null, li: null, tc: 0, mc: 0 });

  it('reads the period\'s own generation by its key, whatever the period: never another generation\'s epochs', async () => {
    const { pool, calls } = fakePool({
      cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [], zeroed: [sentinel], epochs: EPOCHS, present: PRESENT_BOTH,
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.generationNote.generation?.key).toBe('DATA_TP1U2_SEP07#3');
    const q = calls.find((c) => c.kind === 'zeroed')!;
    // the September generation's reject epochs (11, 12) and nothing of July's (3, 4)
    expect(q.sql).toContain('production_ts_utc_ms <= 0');
    expect(q.sql).toContain('source_epoch IN (@ger0, @ger1)');
    expect([q.params.get('ger0'), q.params.get('ger1')]).toEqual([11, 12]);
    expect([...q.params.values()]).not.toContain(3);
    expect([...q.params.values()]).not.toContain(4);
    // period-independent: no date window, no filter on the zeroed query
    for (const n of ['from', 'to', 'shift', 'product', 'station']) expect(q.params.has(n)).toBe(false);
    expect(r.zeroedClock.generation).toBe('September copy - cones');
  });

  it('the same fixture read for a July period binds July\'s epochs (3, 4) and none of September\'s', async () => {
    const julyOnly: Rows = PRESENT_BOTH.filter((p) => [1, 3, 4].includes(Number(p.epoch_id)));
    const { pool, calls } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [], zeroed: [sentinel], epochs: EPOCHS, present: julyOnly });
    const r = await getRejectedUnknownLifterReport(pool, 1, { period: 'custom', from: '2026-07-03', to: '2026-07-03' }, {});
    expect(r.generationNote.generation?.key).toBe('DATA_TP1U2#1');
    const q = calls.find((c) => c.kind === 'zeroed')!;
    expect([q.params.get('ger0'), q.params.get('ger1')]).toEqual([3, 4]);
    expect([...q.params.values()]).not.toContain(11);
    expect([...q.params.values()]).not.toContain(12);
  });

  it('lists the records with their why, including "Clock zeroed (1970)" and every other reason that applies', async () => {
    const { pool } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [], zeroed: [sentinel], epochs: EPOCHS, present: PRESENT_BOTH });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroedClock.rows).toHaveLength(1);
    expect(r.zeroedClock.rows[0]).toMatchObject({ date: '1969-12-31', hanger: 270, tubeCode: 0, materialCode: 0, producedAtUtc: '1970-01-01T00:00:00.000Z' });
    expect(r.zeroedClock.rows[0]!.why).toEqual([WHY_NO_LIFTER, WHY_NO_WINDER, WHY_ZERO_CODE, WHY_CLOCK_ZEROED]);
  });

  it('a zeroed-clock record with hanger 0 (the July weight sentinel) lists no hanger, never "hanger 0"', async () => {
    const weightSentinel = reject({ d: day('1969-12-31'), ts: new Date('1970-01-01T00:00:00Z'), hg: 0, st: null, li: null, rt: 'weight', tc: null, mc: null, w: 0 });
    const { pool } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [], zeroed: [weightSentinel], epochs: EPOCHS, present: PRESENT_BOTH });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroedClock.rows[0]!.hanger).toBeNull();
    const t = rejectedUnknownLifterCsv(r);
    const row = t.rows.find((x) => x[0] === 'zeroed_clock')!;
    expect(row[t.headers.indexOf('hanger')]).toBeNull();
  });

  it('with no source generation (a period that holds nothing) block C is empty and runs no query', async () => {
    const { pool, calls } = fakePool({});
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroedClock).toEqual({ generation: null, rows: [] });
    expect(calls.some((c) => c.kind === 'zeroed')).toBe(false);
  });

  it('a simulator generation is named as the plant simulator', async () => {
    const epochs: Rows = [{ epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'simulator', label: 'pack1_TP1U2 gen 4' }];
    const present: Rows = [{ tbl: 'cone_event', epoch_id: 13, n: 100 }, { tbl: 'reject_event', epoch_id: 13, n: 3 }];
    const { pool } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [], zeroed: [], epochs, present });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.zeroedClock.generation).toBe('pack1_TP1U2 gen 4 (plant simulator, synthetic data)');
  });
});

/* ----------------------------------------------- filters, scope, contract */

describe('rejected-unknown-lifter: one generation, the filters, the registry', () => {
  it('shift, product and shiftRange are bound on the cone, reject and unmatched queries alike; one generation scopes all three', async () => {
    const range: ShiftRange = { from: '2026-08-15', fromShift: 'morning', to: '2026-08-15', toShift: 'evening' };
    const { pool, calls } = fakePool({
      cones: [{ li: 1, n: 5 }], rejects: [{ li: 1, q: 1, zq: 0, w: 0, nl: 1, fault: 0 }], unmatched: [], list: [reject()], epochs: EPOCHS, present: PRESENT_BOTH,
    });
    await getRejectedUnknownLifterReport(pool, 1, PERIOD, { shift: 'evening', product: 1021 }, range);
    for (const k of ['cones', 'rejects', 'unmatched', 'list'] as const) {
      const c = calls.find((x) => x.kind === k)!;
      expect(c.params.get('shift'), k).toBe('evening');
      expect(c.params.get('product'), k).toBe(1021);
      expect(c.params.get('srFromOrd'), k).toBe(1);
      expect(c.params.get('srToOrd'), k).toBe(2);
      expect(c.params.has('station'), k).toBe(false);
    }
    // the generation: September's cone epoch (9) on the cones, its reject epochs (11, 12) on the rejects
    expect(calls.find((x) => x.kind === 'cones')!.params.get('gec0')).toBe(9);
    expect([calls.find((x) => x.kind === 'rejects')!.params.get('ger0'), calls.find((x) => x.kind === 'rejects')!.params.get('ger1')]).toEqual([11, 12]);
    // the unmatched query constrains BOTH tables to the one generation (its own cone side too)
    const um = calls.find((x) => x.kind === 'unmatched')!;
    expect(um.sql).toContain('source_epoch IN (@ger0, @ger1)');
    expect([...um.params.values()]).toContain(9);
  });

  it('carries the note, the draft definition as an "assumed until IFL confirms" line, the cap and a generation note', async () => {
    const { pool } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [], epochs: EPOCHS, present: PRESENT_BOTH });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.note).toBe(REJECTED_UNKNOWN_LIFTER_NOTE);
    expect(r.pendingIfl).toEqual([...REJECTED_UNKNOWN_LIFTER_PENDING_IFL]);
    expect(r.pendingIfl.join(' ')).toMatch(/tube 0 or material 0/);
    // the draft names the lifter and the winder only; the zero code is a separate, unconfirmed question
    expect(r.pendingIfl[0]).toMatch(/no lifter number or no winder number/);
    expect(r.pendingIfl[0]).not.toMatch(/reason code/);
    expect(r.pendingIfl[1]).toMatch(/zero reason code.*not confirmed/);
    expect(r.listCap).toBe(5000);
    expect(r.generationNote).toMatchObject({ spansGenerations: true, otherGenerationExcluded: 421 });
  });

  it('a period with no cones and no rejects is an empty, valid report', async () => {
    const { pool, calls } = fakePool({});
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    expect(r.lifters).toEqual([]);
    expect(r.total).toEqual({ lifter: null, cones: 0, inspected: 0, qualityRejects: 0, zeroCodeRejects: 0, weightRejects: 0, total: 0, ratePct: null });
    expect(r.unknownCount).toBe(0);
    expect(r.list).toEqual([]);
    expect(r.excludedClockFault).toBe(0);
    expect(calls.some((c) => c.kind === 'list')).toBe(false);
  });

  it('is registered in IFL\'s own words, rank 1, with the shift and product filters and no station filter', () => {
    expect(REPORT_TYPES).toContain('rejected-unknown-lifter');
    expect(REPORT_TITLES['rejected-unknown-lifter']).toBe('Rejected Unknown (Lifter) Report');
    expect(REPORT_RANK['rejected-unknown-lifter']).toBe(1);
    expect(FILTERS_BY_TYPE['rejected-unknown-lifter']).toEqual(['shift', 'product']);
  });

  it('buildReport dispatches to the builder', async () => {
    const { pool } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [{ li: 1, q: 1, zq: 0, w: 0, nl: 0, fault: 0 }], unmatched: [] });
    const r = await buildReport(pool, 1, 'rejected-unknown-lifter', PERIOD, {});
    expect(r.total).toMatchObject({ cones: 5, qualityRejects: 1 });
  });
});

/* ------------------------------------------------------------------- CSV */

describe('rejected-unknown-lifter: CSV', () => {
  it('five sections, every row the header width; the no-lifter bucket has an empty lifter; no_lifter and zero_code rows are told apart by section', async () => {
    const list: Rows = [reject({ li: null, st: null, ts: new Date('2026-08-16T04:17:16.150Z') })];
    const zerolist: Rows = [reject({ li: 2, st: 2, hg: 27, ts: new Date('2026-08-16T04:17:16.150Z') })];
    const sentinel = reject({ d: day('1969-12-31'), ts: new Date('1970-01-01T00:00:00Z'), li: null, st: null, hg: 270 });
    const { pool } = fakePool({
      cones: [{ li: 1, n: 100 }, { li: null, n: 2 }],
      rejects: [{ li: 1, q: 3, zq: 1, w: 1, nl: 0, fault: 0 }, { li: null, q: 1, zq: 0, w: 0, nl: 1, fault: 0 }],
      unmatched: [],
      list,
      zerolist,
      zeroed: [sentinel],
      epochs: EPOCHS,
      present: PRESENT_BOTH,
    });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    const t = rejectedUnknownLifterCsv(r);
    expect(t.headers).toEqual(REJECTED_UNKNOWN_LIFTER_CSV_HEADERS);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
    expect([...new Set(t.rows.map((x) => x[0]))]).toEqual(['lifter', 'total', 'no_lifter', 'zero_code', 'zeroed_clock']);
    const col = (n: string) => t.headers.indexOf(n);
    const lifterRows = t.rows.filter((x) => x[0] === 'lifter');
    expect(lifterRows).toHaveLength(15);
    expect(lifterRows[14]![col('lifter')]).toBeNull();
    expect(lifterRows[0]).toEqual(expect.arrayContaining([1, 100, 101 - 1, 3, 1, 1, 4]));
    const noLifter = t.rows.filter((x) => x[0] === 'no_lifter');
    expect(noLifter).toHaveLength(1);
    expect(noLifter[0]![col('produced_at_plant_time')]).toBe('2026-08-16 04:17:16');
    expect(noLifter[0]![col('why')]).toBe(`${WHY_NO_LIFTER}; ${WHY_NO_WINDER}`);
    const zeroCode = t.rows.filter((x) => x[0] === 'zero_code');
    expect(zeroCode).toHaveLength(1);
    expect(zeroCode[0]![col('hanger')]).toBe(27);
    expect([col('tube_code'), col('material_code')].map((i) => zeroCode[0]![i])).toEqual([0, 0]);
    expect(zeroCode[0]![col('why')]).toBe(WHY_ZERO_CODE);
    const zeroed = t.rows.find((x) => x[0] === 'zeroed_clock')!;
    expect(zeroed[col('date')]).toBe('1969-12-31');
    expect(zeroed[col('why')]).toContain(WHY_CLOCK_ZEROED);
    expect(reportCsv('rejected-unknown-lifter', r)).toEqual(t);
  });

  it('a payload from before the zero-code list existed still exports: no zero_code rows, no crash', async () => {
    const { pool } = fakePool({ cones: [{ li: 1, n: 5 }], rejects: [], unmatched: [] });
    const r = await getRejectedUnknownLifterReport(pool, 1, PERIOD, {});
    const legacy = { ...r } as Partial<typeof r>;
    delete legacy.zeroCodeList;
    delete legacy.zeroCodeTotal;
    const t = rejectedUnknownLifterCsv(legacy as typeof r);
    expect(t.rows.some((x) => x[0] === 'zero_code')).toBe(false);
  });
});
