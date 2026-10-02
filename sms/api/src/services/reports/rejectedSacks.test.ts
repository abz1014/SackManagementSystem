/**
 * Rejected Sack Report - Daily (IFL report 2): the real builder, driven end to
 * end over a fake pool that answers the shared sack service's SQL the way SQL
 * Server would (cells grouped, the list capped, the verdict clause honoured).
 * What is proven here: each of the four tables is the right reading of the
 * right sacks; "rejected" is the scale's own bit and nothing else; a sack with
 * no flag is counted apart, never as a pass; a 0 kg reject is an implausible
 * one; the passed range is per product over plausible weights; the list is
 * capped without the count ever being; and ONE generation / one rule context
 * serves every query. The SQL itself (grouping, binding, the zeroed-clock
 * clause) is pinned in sackCells.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});

import { ProductCatalogue, loadProductCatalogue } from '../productLimits.js';
import {
  getRejectedSacksReport, rejectedSacksCsv, REJECTED_SACKS_CSV_HEADERS, REJECTED_SACKS_NOTE, REJECTED_SACKS_PENDING_IFL,
  type RejectedSacksReportData,
} from './rejectedSacks.js';
import { LIST_CAP } from './common.js';

/* ------------------------------------------------------------- the catalogue */

function catalogue(): ProductCatalogue {
  const p = (productId: number, description: string, countText: string | null) => ({
    productId, label: description, activeFlag: true, description, lotCode: null, color: null, blend: null, countText, tubeType: null,
  });
  // 21 -> count 36, 1021 -> count 30, 24 -> a product with no count on record
  return new ProductCatalogue([p(21, 'Product 21', '36'), p(1021, 'Product 1021', '30'), p(24, 'Product 24', null)], []);
}

/* ------------------------------------------------------------- the fake pool */

interface RawSack {
  id: number;
  date: string;
  shift: 'morning' | 'evening' | 'night';
  mat: number | null;
  inRange: boolean | null;
  w: number | null;
  /** plant-clock ms; <= 0 is the zeroed-clock sentinel */
  ts?: number;
  num?: number | null;
}

const LO = 40;
const HI = 60;

interface Stmt { sql: string; inputs: Map<string, unknown> }
interface DbOpts { basis?: 'as_recorded' | 'gross' | 'net'; tare?: number; epochs?: boolean }

const plaus = (w: number | null) => w != null && w >= LO && w <= HI;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function datasetPool(sacks: RawSack[], opts: DbOpts = {}) {
  const statements: Stmt[] = [];
  const basis = opts.basis ?? 'as_recorded';
  const tare = opts.tare ?? 0.5;
  const sel = (inputs: Map<string, unknown>, sql: string): RawSack[] => {
    let rows = sacks.filter((s) => s.date >= String(inputs.get('from')) && s.date <= String(inputs.get('to')));
    const shift = inputs.get('shift');
    if (shift) rows = rows.filter((s) => s.shift === shift);
    const product = inputs.get('product');
    if (product != null) rows = rows.filter((s) => s.mat === product);
    // listSacks' own two queries carry the scale-verdict clause
    if (sql.includes('AS listed') || sql.includes('TOP (@listCap)')) {
      if (sql.includes('e.in_range = 0')) rows = rows.filter((s) => s.inRange === false);
      else if (sql.includes('e.in_range = 1')) rows = rows.filter((s) => s.inRange === true);
      else if (sql.includes('e.in_range IS NULL')) rows = rows.filter((s) => s.inRange == null);
    }
    return rows;
  };
  const group = <T>(rows: RawSack[], key: (s: RawSack) => string, fold: (g: RawSack[]) => T): T[] => {
    const m = new Map<string, RawSack[]>();
    for (const s of rows) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
    return [...m.values()].map(fold);
  };
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) {
            return { recordset: opts.epochs ? [{ tbl: 'sack_event', epoch_id: 10, n: sacks.length }, { tbl: 'sack_event', epoch_id: 14, n: 7 }] : [] };
          }
          if (sql.includes('FROM sms.source_epoch')) {
            return { recordset: opts.epochs ? [
              { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'sacks gen 3' },
              { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'simulator', label: 'sacks sim' },
            ] : [] };
          }
          statements.push({ sql, inputs: new Map(inputs) });
          if (sql.includes('sms.plausibility_rule')) return { recordset: [{ cl: 1500, ch: 2100, sl: LO, sh: HI, effective_from: new Date('2000-01-01T00:00:00Z') }] };
          if (sql.includes('sms.weight_rule')) return { recordset: [{ basis, tube: 70, tare, effective_from: new Date('2000-01-01T00:00:00Z') }] };
          const rows = sel(inputs, sql);
          if (sql.includes('GROUP BY e.shift_date')) {
            const ref = Number(inputs.get('refKg'));
            return {
              recordset: group(rows, (s) => `${s.date}|${s.shift}|${s.mat}|${s.inRange}`, (g) => {
                const p = g.filter((s) => plaus(s.w));
                const ws = p.map((s) => s.w as number);
                return {
                  d: g[0]!.date, sc: g[0]!.shift, mid: g[0]!.mat, ir: g[0]!.inRange, n: g.length,
                  kg: sum(g.map((s) => s.w ?? 0)),
                  implausible: g.filter((s) => s.w != null && !plaus(s.w)).length,
                  plaus_n: p.length, plaus_kg: sum(ws),
                  sum_d: sum(ws.map((w) => w - ref)), sum_d2: sum(ws.map((w) => (w - ref) ** 2)),
                  min_w: ws.length ? Math.min(...ws) : null, max_w: ws.length ? Math.max(...ws) : null,
                };
              }),
            };
          }
          if (sql.includes('AS listed')) {
            return { recordset: [{
              listed: rows.filter((s) => (s.ts ?? 1) > 0).length,
              clock: rows.filter((s) => (s.ts ?? 1) <= 0).length,
            }] };
          }
          if (sql.includes('TOP (@listCap)')) {
            const cap = Number(inputs.get('listCap'));
            return {
              recordset: rows.filter((s) => (s.ts ?? 1) > 0)
                .sort((a, b) => (a.ts ?? 1_000_000 + a.id) - (b.ts ?? 1_000_000 + b.id)).slice(0, cap)
                .map((s) => ({ id: s.id, d: s.date, sc: s.shift, ts: s.ts ?? 1_000_000 + s.id, num: s.num ?? null, mid: s.mat, ir: s.inRange, w: s.w })),
            };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-02' };

/** Eleven hand-checked sacks over two days: every awkward case once. */
function fixture(): RawSack[] {
  return [
    { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2, num: 1 },
    { id: 2, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.4, num: 2 },
    { id: 3, date: '2026-09-01', shift: 'morning', mat: 21, inRange: false, w: 47.9, num: 3 }, // rejected, plausible weight
    { id: 4, date: '2026-09-01', shift: 'morning', mat: null, inRange: false, w: 0, num: 4 }, // rejected, 0 kg fault, no product
    { id: 5, date: '2026-09-01', shift: 'evening', mat: 1021, inRange: true, w: 47.0, num: 5 },
    { id: 6, date: '2026-09-01', shift: 'evening', mat: 1021, inRange: null, w: 47.3, num: 6 }, // the scale recorded no verdict
    { id: 7, date: '2026-09-01', shift: 'night', mat: 21, inRange: true, w: 46.9, num: 7 },
    { id: 8, date: '2026-09-02', shift: 'morning', mat: 1021, inRange: false, w: 45.3, num: 8 }, // rejected, plausible weight
    { id: 9, date: '2026-09-02', shift: 'morning', mat: 1021, inRange: true, w: 47.6, num: 9 },
    { id: 10, date: '2026-09-02', shift: 'night', mat: null, inRange: true, w: 47.1, num: 10 }, // passed, no product
    { id: 11, date: '2026-09-02', shift: 'night', mat: 21, inRange: false, w: null, num: 11 }, // rejected, no weight at all
    // A zeroed clock: stamped 1970-01-01, so shift_date 1969-12-31. No period a screen can reach holds it.
    { id: 12, date: '1969-12-31', shift: 'night', mat: null, inRange: false, w: 0, ts: 0, num: null },
  ];
}

beforeEach(() => {
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue(catalogue());
});

/* --------------------------------------------------------------- the tables */

describe('getRejectedSacksReport — table A: sacks and rejected sacks per date and shift', () => {
  it('one row per production date and shift, morning/evening/night inside a day; rejected is the scale\'s in_range = 0, nothing else', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.byShift.map((r) => `${r.date} ${r.shift} ${r.sacks}/${r.rejected}`)).toEqual([
      '2026-09-01 morning 4/2', '2026-09-01 evening 2/0', '2026-09-01 night 1/0',
      '2026-09-02 morning 2/1', '2026-09-02 night 2/1',
    ]);
    expect(d.byShift.map((r) => r.rejectedPct)).toEqual([50, 0, 0, 50, 50]);
  });

  it('day totals and the period total add up to the rows; the share is to 0.01', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.byDay).toEqual([
      { date: '2026-09-01', sacks: 7, rejected: 2, rejectedPct: 28.57 },
      { date: '2026-09-02', sacks: 4, rejected: 2, rejectedPct: 50 },
    ]);
    expect(d.total).toEqual({ sacks: 11, rejected: 4, rejectedPct: 36.36, noFlag: 1 });
    for (const g of [d.byShift, d.byDay]) {
      expect(g.reduce((a, r) => a + r.sacks, 0)).toBe(d.total.sacks);
      expect(g.reduce((a, r) => a + r.rejected, 0)).toBe(d.total.rejected);
    }
  });

  it('a sack with NO in-range flag is counted apart (noFlag) and is neither rejected nor passed', async () => {
    const { pool } = datasetPool([
      { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: null, w: 47.3 },
      { id: 2, date: '2026-09-01', shift: 'morning', mat: 21, inRange: null, w: 47.1 },
      { id: 3, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 },
    ]);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.total).toEqual({ sacks: 3, rejected: 0, rejectedPct: 0, noFlag: 2 });
    expect(d.rejectedSplit).toEqual({ implausible: 0, plausible: 0 });
    // the two unflagged sacks are not in the passed range either: only the flagged pass counts
    expect(d.passedRange.all).toEqual({ sacks: 1, minKg: 47.2, maxKg: 47.2 });
    expect(d.list).toEqual([]);
    expect(d.listTotal).toBe(0);
  });

  it('a small share is not rounded to nothing: 1 rejected in 4,000 sacks is 0.03 %, not 0.0', async () => {
    const sacks: RawSack[] = Array.from({ length: 4000 }, (_, i) => ({
      id: i + 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: i !== 0, w: 47.2,
    }));
    const { pool } = datasetPool(sacks);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.total.rejected).toBe(1);
    expect(d.total.rejectedPct).toBe(0.03);
  });

  it('a period with no sacks is an empty, valid report: no shares, no rows, no range', async () => {
    const { pool } = datasetPool([]);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.byShift).toEqual([]);
    expect(d.byDay).toEqual([]);
    expect(d.total).toEqual({ sacks: 0, rejected: 0, rejectedPct: null, noFlag: 0 });
    expect(d.rejectedSplit).toEqual({ implausible: 0, plausible: 0 });
    expect(d.passedRange).toEqual({ byProduct: [], all: { sacks: 0, minKg: null, maxKg: null } });
    expect(d.list).toEqual([]);
    expect(d.listTotal).toBe(0);
    expect(d.listCap).toBe(LIST_CAP);
    expect(d.excludedClockFault).toBe(0);
  });
});

describe('getRejectedSacksReport — table B: what the rejected sacks weighed', () => {
  it('a 0 kg reject is implausible, a 45.3 kg reject is plausible, a reject with no weight at all sits with the implausible; they add up to the rejected count', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    // rejected: id 3 (47.9, plausible), id 4 (0 kg), id 8 (45.3, plausible), id 11 (no weight)
    expect(d.rejectedSplit).toEqual({ implausible: 2, plausible: 2 });
    expect(d.rejectedSplit.implausible + d.rejectedSplit.plausible).toBe(d.total.rejected);
  });

  it('only rejected sacks are counted: a passed sack with a plausible weight and an unflagged one do not enter B', async () => {
    const { pool } = datasetPool([
      { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 },
      { id: 2, date: '2026-09-01', shift: 'morning', mat: 21, inRange: null, w: 0 },
      { id: 3, date: '2026-09-01', shift: 'morning', mat: 21, inRange: false, w: 47.8 },
    ]);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.rejectedSplit).toEqual({ implausible: 0, plausible: 1 });
  });
});

describe('getRejectedSacksReport — table C: the range of the sacks the scale passed', () => {
  it('per product, over passed sacks with a plausible weight only: min and max are a stated fact, no tolerance', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    // counts read as numbers: 30 before 36; the sacks with no product last
    expect(d.passedRange.byProduct).toEqual([
      { productId: 1021, productLabel: 'Product 1021', yarnCount: '30', sacks: 2, minKg: 47, maxKg: 47.6 },
      { productId: 21, productLabel: 'Product 21', yarnCount: '36', sacks: 3, minKg: 46.9, maxKg: 47.4 },
      { productId: null, productLabel: 'No product on the reading', yarnCount: null, sacks: 1, minKg: 47.1, maxKg: 47.1 },
    ]);
    expect(d.passedRange.all).toEqual({ sacks: 6, minKg: 46.9, maxKg: 47.6 });
  });

  it('a rejected 47.9 kg sack and a rejected 45.3 kg sack never widen the passed range', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.passedRange.all.maxKg).toBe(47.6); // not 47.9
    expect(d.passedRange.all.minKg).toBe(46.9); // not 45.3
  });

  it('a passed sack the scale let through at an implausible weight is left out of the range, not made its minimum', async () => {
    const { pool } = datasetPool([
      { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 },
      { id: 2, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 16.34 },
    ]);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.passedRange.byProduct[0]).toMatchObject({ productId: 21, sacks: 1, minKg: 47.2, maxKg: 47.2 });
  });

  it('a product with no count on record, or one the catalogue has never heard of, still gets a row with no yarn count', async () => {
    const { pool } = datasetPool([
      { id: 1, date: '2026-09-01', shift: 'morning', mat: 24, inRange: true, w: 47.2 },
      { id: 2, date: '2026-09-01', shift: 'morning', mat: 99, inRange: true, w: 47.3 },
      { id: 3, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.4 },
    ]);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.passedRange.byProduct.map((r) => [r.productId, r.productLabel, r.yarnCount])).toEqual([
      [21, 'Product 21', '36'], [24, 'Product 24', null], [99, 'Product 99', null],
    ]);
  });

  it('when the scale passed nothing there is no row and no range (never a made-up one)', async () => {
    const { pool } = datasetPool([{ id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: false, w: 47.9 }]);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.passedRange).toEqual({ byProduct: [], all: { sacks: 0, minKg: null, maxKg: null } });
  });
});

describe('getRejectedSacksReport — table D: the list of rejected sacks', () => {
  it('every rejected sack, oldest first, with its product, yarn count and weight; a 0 kg and a weightless one are marked implausible', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.list.map((r) => r.sackNum)).toEqual([3, 4, 8, 11]);
    expect(d.list[0]).toEqual({
      date: '2026-09-01', shift: 'morning', producedAtUtc: new Date(1_000_003).toISOString(), sackNum: 3,
      productId: 21, productLabel: 'Product 21', yarnCount: '36', weightKg: 47.9, implausible: false,
    });
    expect(d.list[1]).toMatchObject({ sackNum: 4, productId: null, productLabel: null, yarnCount: null, weightKg: 0, implausible: true });
    expect(d.list[2]).toMatchObject({ sackNum: 8, productId: 1021, yarnCount: '30', weightKg: 45.3, implausible: false });
    expect(d.list[3]).toMatchObject({ sackNum: 11, weightKg: null, implausible: true });
    expect(d.listTotal).toBe(4);
    expect(d.listTotal).toBe(d.total.rejected);
    expect(d.listCap).toBe(LIST_CAP);
  });

  it('the list asks for the scale\'s rejections only (in_range = 0) and for real clocks only, with the cap bound as a parameter', async () => {
    const { pool, statements } = datasetPool(fixture());
    await getRejectedSacksReport(pool, 1, PERIOD, {});
    const rows = statements.find((s) => s.sql.includes('TOP (@listCap)'))!;
    expect(rows.sql).toContain('e.in_range = 0');
    expect(rows.sql).toContain('e.production_ts_utc_ms > 0');
    expect(rows.inputs.get('listCap')).toBe(LIST_CAP);
  });

  it('the zeroed-clock sack is excluded and counted: the list and listTotal never hold it', async () => {
    const { pool } = datasetPool(fixture());
    // Only a period reaching 1969 can hold it at all.
    const d = await getRejectedSacksReport(pool, 1, { period: 'custom', from: '1969-12-30', to: '2026-09-02' }, {});
    expect(d.excludedClockFault).toBe(1);
    expect(d.list.some((r) => r.date === '1969-12-31')).toBe(false);
    expect(d.listTotal).toBe(4);
    // and a reachable period states none, because none is in it
    const normal = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(normal.excludedClockFault).toBe(0);
    expect(normal.total.sacks).toBe(11);
  });

  it('the cap limits the rows, never the count: 5,003 rejected sacks list 5,000 and the tables still count all 5,003', async () => {
    const many: RawSack[] = Array.from({ length: 5003 }, (_, i) => ({
      id: i + 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: false, w: 47.9, num: i + 1,
    }));
    const { pool } = datasetPool(many);
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.list).toHaveLength(LIST_CAP);
    expect(d.listTotal).toBe(5003);
    expect(d.listCap).toBe(LIST_CAP);
    expect(d.total.rejected).toBe(5003);
    expect(d.byShift[0]!.rejected).toBe(5003);
    expect(d.list[0]!.sackNum).toBe(1); // oldest first: the cut falls on the NEWEST rows
  });
});

describe('getRejectedSacksReport — filters, basis, one generation', () => {
  it('a shift and a product filter narrow every table and the list together', async () => {
    const { pool, statements } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, { shift: 'morning', product: 21 });
    expect(d.total).toEqual({ sacks: 3, rejected: 1, rejectedPct: 33.33, noFlag: 0 });
    expect(d.list.map((r) => r.sackNum)).toEqual([3]);
    for (const s of statements.filter((x) => x.sql.includes('sms.sack_event'))) {
      expect(s.inputs.get('shift')).toBe('morning');
      expect(s.inputs.get('product')).toBe(21);
    }
    expect(statements.filter((x) => x.sql.includes('sms.sack_event')).length).toBeGreaterThanOrEqual(3);
  });

  it('a shift range reaches the cell query and both list queries', async () => {
    const { pool, statements } = datasetPool(fixture());
    await getRejectedSacksReport(pool, 1, PERIOD, {}, { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' });
    const sack = statements.filter((x) => x.sql.includes('sms.sack_event'));
    expect(sack).toHaveLength(3); // cells, list count, list rows
    for (const s of sack) {
      expect(s.sql).toContain('@srFrom');
      expect(s.inputs.get('srFromOrd')).toBe(2);
      expect(s.inputs.get('srToOrd')).toBe(1);
    }
  });

  it('a net basis takes the tare off every weight shown: the list and the passed range, and the basis is reported', async () => {
    const { pool } = datasetPool(fixture(), { basis: 'net', tare: 0.5 });
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.weightBasis).toBe('net');
    expect(d.list[0]!.weightKg).toBe(47.4); // 47.9 - 0.5
    expect(d.passedRange.all).toEqual({ sacks: 6, minKg: 46.4, maxKg: 47.1 });
    // the window the weights are judged on is reported as set in Setup
    expect(d.plausibility).toEqual({ loKg: LO, hiKg: HI });
  });

  it('ONE generation and ONE rule context serve the cells and the list: the same epoch is bound in all three queries, the rules are read once', async () => {
    const { pool, statements } = datasetPool(fixture(), { epochs: true });
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    const sack = statements.filter((x) => x.sql.includes('sms.sack_event'));
    expect(sack).toHaveLength(3);
    for (const s of sack) expect(s.inputs.get('ges0')).toBe(10);
    expect(statements.filter((s) => s.sql.includes('sms.plausibility_rule'))).toHaveLength(1);
    expect(statements.filter((s) => s.sql.includes('sms.weight_rule'))).toHaveLength(1);
    expect(d.generationNote.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(d.generationNote.otherGenerationExcluded).toBe(7);
  });
});

describe('getRejectedSacksReport — the note and the assumptions', () => {
  it('carries the method note and the "Assumed until IFL confirms" lines; never calls a sack under- or overweight', async () => {
    const { pool } = datasetPool(fixture());
    const d = await getRejectedSacksReport(pool, 1, PERIOD, {});
    expect(d.note).toBe(REJECTED_SACKS_NOTE);
    expect(d.pendingIfl).toEqual([...REJECTED_SACKS_PENDING_IFL]);
    expect(d.pendingIfl.length).toBeGreaterThanOrEqual(3);
    expect(d.pendingIfl.join(' ')).toMatch(/tolerance/);
    expect(d.pendingIfl.join(' ')).toMatch(/0 kg/);
    // "no sack is called underweight or overweight" appears only to say it is not done
    expect(`${d.note} ${d.pendingIfl.join(' ')}`.replace(/no sack is called underweight or overweight/, '')).not.toMatch(/underweight|overweight/i);
  });

  it('a weight or plausibility rule recorded inside the period is stated, as a record and not as a change of value', async () => {
    const { pool } = datasetPool(fixture());
    // The fake serves one version per rule: a rule saved inside the period is reported by the service from two versions.
    const changed = {
      request: () => {
        const base = (pool as unknown as { request: () => { input: (...a: unknown[]) => unknown; query: (sql: string) => Promise<unknown> } }).request();
        const req: { input: (...a: unknown[]) => typeof req; query: (sql: string) => Promise<unknown> } = {
          input: (...a) => { base.input(...a); return req; },
          query: async (sql: string) => {
            if (sql.includes('sms.plausibility_rule')) {
              return { recordset: [
                { cl: 1500, ch: 2100, sl: 45, sh: 55, effective_from: new Date('2026-09-01T12:00:00Z') },
                { cl: 1500, ch: 2100, sl: LO, sh: HI, effective_from: new Date('2000-01-01T00:00:00Z') },
              ] };
            }
            return base.query(sql);
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;
    const d = await getRejectedSacksReport(changed, 1, PERIOD, {});
    expect(d.note).toContain('Setup recorded a new plausible-weight-window version during this period');
    expect(d.plausibility).toEqual({ loKg: 45, hiKg: 55 });
    expect(d.note).not.toContain('weight-basis version');
  });
});

/* ----------------------------------------------------------------------- CSV */

describe('rejectedSacksCsv — the built report in its frozen columns', () => {
  const col = (t: ReturnType<typeof rejectedSacksCsv>, n: string) => t.headers.indexOf(n);
  const section = (t: ReturnType<typeof rejectedSacksCsv>, s: string) => t.rows.filter((r) => r[0] === s);

  async function built(): Promise<RejectedSacksReportData> {
    const { pool } = datasetPool(fixture());
    return getRejectedSacksReport(pool, 1, PERIOD, {});
  }

  it('every row is the header\'s width, in sections A, B, C and D', async () => {
    const t = rejectedSacksCsv(await built());
    expect([...t.headers]).toEqual([...REJECTED_SACKS_CSV_HEADERS]);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    expect(section(t, 'shift_count')).toHaveLength(5);
    expect(section(t, 'day_total')).toHaveLength(2);
    expect(section(t, 'period_total')).toHaveLength(1);
    expect(section(t, 'rejected_split')).toHaveLength(2);
    expect(section(t, 'passed_range')).toHaveLength(4); // three products + the all-products row
    expect(section(t, 'rejected_sack')).toHaveLength(4);
  });

  it('the period total carries the no-flag count; the split rows say implausible true / false; the all-products row closes the range', async () => {
    const t = rejectedSacksCsv(await built());
    const total = section(t, 'period_total')[0]!;
    expect(['sacks', 'rejected', 'rejected_pct', 'no_flag'].map((n) => total[col(t, n)])).toEqual([11, 4, 36.36, 1]);
    expect(section(t, 'rejected_split').map((r) => [r[col(t, 'implausible')], r[col(t, 'sacks')]])).toEqual([[true, 2], [false, 2]]);
    const last = section(t, 'passed_range').at(-1)!;
    expect([last[col(t, 'product')], last[col(t, 'sacks')], last[col(t, 'min_kg')], last[col(t, 'max_kg')]]).toEqual(['All products', 6, 46.9, 47.6]);
  });

  it('a rejected sack\'s time is the plant wall clock without a zone marker, in a column named for the plant clock', async () => {
    const t = rejectedSacksCsv(await built());
    expect(t.headers).toContain('produced_at_plant_time');
    const first = section(t, 'rejected_sack')[0]!;
    expect(first[col(t, 'produced_at_plant_time')]).toBe('1970-01-01 00:16:40'); // the fixture's 1,000,003 ms, read with UTC getters only
    expect(String(first[col(t, 'produced_at_plant_time')])).not.toMatch(/Z|T/);
    expect(first[col(t, 'sack_num')]).toBe(3);
    expect(first[col(t, 'material_id')]).toBe(21);
    expect(first[col(t, 'yarn_count')]).toBe('36');
    expect(first[col(t, 'weight_kg')]).toBe(47.9);
    expect(first[col(t, 'implausible')]).toBe(false);
  });
});
