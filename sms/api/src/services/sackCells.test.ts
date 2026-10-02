/**
 * The shared sack cell service (sackCells.ts, IFL reports, 1 Oct 2026).
 *
 * Three things are pinned, because every sack report stands on them:
 *  1. THE ARITHMETIC. A roll-up of cells must equal a two-pass computation over
 *     the raw sacks — the standard deviation especially, which is rebuilt from
 *     centred sums and must not drift when cells are centred differently.
 *  2. THE AGREEMENT. The cells' totals must be the numbers getSackSummary (the
 *     Sacks screen) prints for the same sacks: a figure on a report is the
 *     figure on the screen. Both are driven here from ONE dataset of raw sacks
 *     by a fake pool that aggregates the way the SQL does.
 *  3. THE QUERIES. One predicate (bindSackFilters), one generation, the rule as
 *     of the period end, every value a bound parameter.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getSackSummary } from './sacks.js';
import {
  getSackBins, getSackCells, listSacks, rollup, rollupAll, resolveSackContext, type SackCell,
} from './sackCells.js';

/* ------------------------------------------------------------- raw dataset */

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

/** A deterministic, plausible-looking spread of weights around 47.3 kg (0.02 kg resolution, like the scale). */
function spread(n: number, seed = 7): number[] {
  // mulberry32: a small, well-mixed seeded generator (no 53-bit overflow).
  let a = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    out.push(Math.round((47.0 + u * 0.6) * 50) / 50);
  }
  return out;
}

const sd2pass = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** A cell built from raw weights, centred at `centre` — exactly what the SQL's SUM(d), SUM(d*d) produce. */
function cellOf(ws: number[], over: Partial<SackCell> = {}, centre = 50): SackCell {
  const plaus = ws.filter((w) => w >= LO && w <= HI);
  return {
    date: '2026-09-01', shift: 'morning', materialId: 21, inRange: true,
    sacks: ws.length, kg: Math.round(ws.reduce((a, b) => a + b, 0) * 1000) / 1000,
    implausible: ws.length - plaus.length, plausible: plaus.length,
    plausKg: Math.round(plaus.reduce((a, b) => a + b, 0) * 1000) / 1000,
    sumD: plaus.reduce((a, b) => a + (b - centre), 0), sumD2: plaus.reduce((a, b) => a + (b - centre) ** 2, 0),
    centreKg: centre,
    minKg: plaus.length ? Math.min(...plaus) : null, maxKg: plaus.length ? Math.max(...plaus) : null,
    ...over,
  };
}

/* -------------------------------------------------------------- 1. the arithmetic */

describe('rollup — exact arithmetic over cells', () => {
  it('standard deviation from centred sums equals the two-pass reference within 1e-9', () => {
    const ws = spread(2000);
    const a = ws.slice(0, 700);
    const b = ws.slice(700, 1500);
    const c = ws.slice(1500);
    const all = rollupAll([cellOf(a, { shift: 'morning' }), cellOf(b, { shift: 'evening' }), cellOf(c, { shift: 'night' })]);
    expect(all.sdKg).not.toBeNull();
    expect(Math.abs(all.sdKg! - sd2pass(ws))).toBeLessThan(1e-9);
    expect(all.plausible).toBe(2000);
    // and per shift
    const per = rollup([cellOf(a, { shift: 'morning' }), cellOf(b, { shift: 'evening' })], (x) => x.shift);
    expect(Math.abs(per.get('morning')!.sdKg! - sd2pass(a))).toBeLessThan(1e-9);
    expect(Math.abs(per.get('evening')!.sdKg! - sd2pass(b))).toBeLessThan(1e-9);
  });

  it('is exact when the cells were centred on DIFFERENT constants', () => {
    const ws = spread(900, 11);
    const a = ws.slice(0, 300);
    const b = ws.slice(300);
    const mixed = rollupAll([cellOf(a, {}, 50), cellOf(b, { shift: 'evening' }, 47.3)]);
    expect(Math.abs(mixed.sdKg! - sd2pass(ws))).toBeLessThan(1e-9);
    // Merging in the other order gives the same answer.
    const swapped = rollupAll([cellOf(b, { shift: 'evening' }, 47.3), cellOf(a, {}, 50)]);
    expect(Math.abs(swapped.sdKg! - mixed.sdKg!)).toBeLessThan(1e-9);
  });

  it('a single plausible sack has no standard deviation, an empty set has no average', () => {
    expect(rollupAll([cellOf([47.2])]).sdKg).toBeNull();
    expect(rollupAll([cellOf([47.2])]).avgKg).toBe(47.2);
    const none = rollupAll([]);
    expect(none).toMatchObject({ sacks: 0, kg: 0, avgKg: null, minKg: null, maxKg: null, sdKg: null, rejected: 0, passed: 0, noFlag: 0 });
  });

  it('sums sacks, kilograms and the three verdicts exactly; implausible sacks stay in kg but leave the average, min, max and SD', () => {
    const f = rollupAll([
      cellOf([47.2, 47.4], { inRange: true }),
      cellOf([47.3, 0], { inRange: false }), // 0 kg: a scale fault, in kg and sacks, not in the statistics
      cellOf([47.1], { inRange: null }),
    ]);
    expect(f.sacks).toBe(5);
    expect(f.kg).toBe(189);
    expect(f.passed).toBe(2);
    expect(f.rejected).toBe(2);
    expect(f.noFlag).toBe(1);
    expect(f.implausible).toBe(1);
    expect(f.plausible).toBe(4);
    expect(f.avgKg).toBe(47.25); // (47.2 + 47.4 + 47.3 + 47.1) / 4, the 0 kg sack excluded
    expect(f.minKg).toBe(47.1);
    expect(f.maxKg).toBe(47.4);
  });

  it('floating-point sums of thousandths do not leak: 0.1 + 0.2 style noise is gone', () => {
    const cells = [0.1, 0.2, 0.3].map((x) => cellOf([47 + x], { shift: 'morning' }));
    expect(rollupAll(cells).kg).toBe(141.6);
  });

  it('groups by any key, skips cells the key maps to null, keeps first-appearance order', () => {
    const cells = [
      cellOf([47.2], { shift: 'night', materialId: null }),
      cellOf([47.3], { shift: 'morning', materialId: 21 }),
      cellOf([47.4], { shift: 'night', materialId: 21 }),
    ];
    const byShift = rollup(cells, (c) => c.shift);
    expect([...byShift.keys()]).toEqual(['night', 'morning']);
    expect(byShift.get('night')!.sacks).toBe(2);
    const onlyProducts = rollup(cells, (c) => (c.materialId == null ? null : String(c.materialId)));
    expect([...onlyProducts.keys()]).toEqual(['21']);
    expect(onlyProducts.get('21')!.sacks).toBe(2);
  });
});

/* ------------------------------------------- a fake pool that aggregates like the SQL */

interface Stmt { sql: string; inputs: Map<string, unknown> }

interface DbOpts {
  basis?: 'as_recorded' | 'gross' | 'net';
  tare?: number;
  epochs?: boolean;
}

function datasetPool(sacks: RawSack[], opts: DbOpts = {}) {
  const statements: Stmt[] = [];
  const basis = opts.basis ?? 'as_recorded';
  const tare = opts.tare ?? 0.5;
  const sel = (inputs: Map<string, unknown>, sql: string): RawSack[] => {
    let rows = sacks;
    const shift = inputs.get('shift');
    if (shift) rows = rows.filter((s) => s.shift === shift);
    const product = inputs.get('product');
    if (product != null) rows = rows.filter((s) => s.mat === product);
    // listSacks' optional scale-verdict clause (only its own two queries: the
    // summary's SELECT list also mentions `e.in_range = 1`)
    if (sql.includes('AS listed') || sql.includes('TOP (@listCap)')) {
      if (sql.includes('e.in_range = 0')) rows = rows.filter((s) => s.inRange === false);
      else if (sql.includes('e.in_range = 1')) rows = rows.filter((s) => s.inRange === true);
      else if (sql.includes('e.in_range IS NULL')) rows = rows.filter((s) => s.inRange == null);
    }
    return rows;
  };
  const plaus = (w: number | null) => w != null && w >= LO && w <= HI;
  const group = <T>(rows: RawSack[], key: (s: RawSack) => string, fold: (g: RawSack[]) => T): T[] => {
    const m = new Map<string, RawSack[]>();
    for (const s of rows) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
    return [...m.values()].map(fold);
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) {
            return { recordset: opts.epochs ? [{ tbl: 'sack_event', epoch_id: 10, n: sacks.length }, { tbl: 'sack_event', epoch_id: 14, n: 9999 }] : [] };
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
          // ---- the cell query
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
          // ---- getSackSummary's aggregates
          const summaryRow = (grp: string | number | null, g: RawSack[]) => {
            const p = g.filter((s) => plaus(s.w));
            return {
              grp, n: g.length, kg: sum(g.map((s) => s.w ?? 0)),
              inr: g.filter((s) => s.inRange === true).length, noflag: g.filter((s) => s.inRange == null).length,
              implausible: g.filter((s) => s.w != null && !plaus(s.w)).length,
              plaus_kg: sum(p.map((s) => s.w as number)), plaus_n: p.length, product_name: null,
            };
          };
          if (sql.includes("'total' AS grp")) return { recordset: [summaryRow('total', rows)] };
          if (sql.includes('GROUP BY e.shift_code')) return { recordset: group(rows, (s) => s.shift, (g) => summaryRow(g[0]!.shift, g)) };
          if (sql.includes('GROUP BY e.material_id')) return { recordset: group(rows, (s) => String(s.mat), (g) => summaryRow(g[0]!.mat, g)) };
          if (sql.includes('FROM sms.cone_event')) return { recordset: [{ n: 0 }] };
          if (sql.includes('no_attr')) return { recordset: [{ n: rows.length, no_attr: rows.filter((s) => s.mat == null).length }] };
          // ---- bins
          if (sql.includes('FLOOR(ROUND(')) {
            const adj = Number(inputs.get('adjKg'));
            const bin = Number(inputs.get('binKg'));
            return {
              recordset: group(rows, (s) => `${plaus(s.w) ? Math.floor(Math.round(((s.w as number) - adj) / bin * 1e6) / 1e6) : 'x'}|${s.w == null ? 2 : plaus(s.w) ? 0 : 1}|${s.shift}|${s.inRange}`, (g) => {
                const s = g[0]!;
                return {
                  bin: plaus(s.w) ? Math.floor(Math.round(((s.w as number) - adj) / bin * 1e6) / 1e6) : null,
                  kind: s.w == null ? 2 : plaus(s.w) ? 0 : 1, sc: s.shift, ir: s.inRange, n: g.length,
                };
              }),
            };
          }
          // ---- the list
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
                .sort((a, b) => (a.ts ?? a.id) - (b.ts ?? b.id)).slice(0, cap)
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

/** ~400 sacks over three days and shifts, two materials and one without, with the awkward ones in. */
function dataset(): RawSack[] {
  const ws = spread(400, 3);
  const shifts = ['morning', 'evening', 'night'] as const;
  const out: RawSack[] = ws.map((w, i) => ({
    id: i + 1,
    date: ['2026-09-01', '2026-09-02', '2026-09-03'][i % 3]!,
    shift: shifts[i % 3]!,
    mat: i % 7 === 0 ? null : i % 2 === 0 ? 21 : 1021,
    inRange: i % 11 === 0 ? false : i % 50 === 0 ? null : true,
    w,
  }));
  out.push({ id: 1001, date: '2026-09-02', shift: 'morning', mat: 21, inRange: false, w: 0 });
  out.push({ id: 1002, date: '2026-09-02', shift: 'morning', mat: 21, inRange: true, w: 16.34 }); // an in-range-by-the-scale 16 kg reading
  out.push({ id: 1003, date: '2026-09-03', shift: 'night', mat: null, inRange: false, w: 39.42 });
  return out;
}

/* ------------------------------------------------- 2. the agreement with getSackSummary */

describe('sackCells totals == getSackSummary totals (one dataset, both services)', () => {
  const Q = { from: '2026-09-01', to: '2026-09-03' };

  for (const basis of ['as_recorded', 'net'] as const) {
    it(`${basis}: totals, per shift and per product agree to the printed precision`, async () => {
      const { pool } = datasetPool(dataset(), { basis, tare: 0.5 });
      const summary = await getSackSummary(pool, 1, Q);
      const { cells, weightBasis } = await getSackCells(pool, 1, Q);
      expect(weightBasis).toBe(basis);
      const all = rollupAll(cells);
      expect(all.sacks).toBe(summary.totals.sacks);
      expect(Math.round(all.kg * 10) / 10).toBe(summary.totals.kg);
      expect(all.avgKg).toBe(summary.totals.avgKg);
      expect(all.implausible).toBe(summary.totals.implausible);
      expect(all.passed).toBe(summary.totals.inRange);
      expect(all.noFlag).toBe(summary.totals.noFlag);
      // The share the screen prints is over the sacks that carry a verdict.
      expect(Math.round((1000 * all.passed) / (all.passed + all.rejected)) / 10).toBe(summary.totals.inRangePct);

      const byShift = rollup(cells, (c) => c.shift);
      for (const s of summary.byShift) {
        const f = byShift.get(s.shift as 'morning')!;
        expect([f.sacks, Math.round(f.kg * 10) / 10, f.avgKg, f.implausible]).toEqual([s.sacks, s.kg, s.avgKg, s.implausible]);
      }
      const byProduct = rollup(cells, (c) => String(c.materialId));
      for (const p of summary.byProduct) {
        const f = byProduct.get(String(p.materialId))!;
        expect([f.sacks, Math.round(f.kg * 10) / 10, f.avgKg]).toEqual([p.sacks, p.kg, p.avgKg]);
      }
    });
  }

  it('the standard deviation over the dataset equals the two-pass reference, through the whole pipeline', async () => {
    const data = dataset();
    const { pool } = datasetPool(data);
    const { cells } = await getSackCells(pool, 1, Q);
    const plausible = data.filter((s) => s.w != null && s.w >= LO && s.w <= HI).map((s) => s.w as number);
    expect(Math.abs(rollupAll(cells).sdKg! - sd2pass(plausible))).toBeLessThan(1e-9);
  });

  it('the 16.34 kg and 0 kg readings are in the sack count and the kilograms but not in the average', async () => {
    const data = dataset();
    const { pool } = datasetPool(data);
    const { cells } = await getSackCells(pool, 1, Q);
    const all = rollupAll(cells);
    expect(all.sacks).toBe(403);
    expect(all.implausible).toBe(3); // 0, 16.34, 39.42
    const plausible = data.filter((s) => s.w != null && s.w >= LO && s.w <= HI).map((s) => s.w as number);
    expect(all.avgKg).toBe(Math.round((100 * plausible.reduce((a, b) => a + b, 0)) / plausible.length) / 100);
    expect(all.minKg).toBeGreaterThan(46.9);
  });
});

/* ------------------------------------------------------------ 3. the queries */

describe('getSackCells — the queries', () => {
  const Q = { from: '2026-09-01', to: '2026-09-03' };

  it('binds line, period, plausibility window and the centre as parameters; groups by date, shift, material and verdict', async () => {
    const { pool, statements } = datasetPool([{ id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 }]);
    await getSackCells(pool, 1, { ...Q, shift: 'morning', product: 21 });
    const st = statements.find((s) => s.sql.includes('GROUP BY e.shift_date'))!;
    expect(st.sql).toContain('GROUP BY e.shift_date, e.shift_code, e.material_id, e.in_range');
    expect(st.sql).toMatch(/e\.weight_kg BETWEEN @spLo AND @spHi/);
    expect(st.sql).toContain('shift_code = @shift');
    expect(st.sql).toContain('material_id = @product');
    expect(st.inputs.get('line')).toBe(1);
    expect(st.inputs.get('from')).toBe('2026-09-01');
    expect(st.inputs.get('to')).toBe('2026-09-03');
    expect(st.inputs.get('spLo')).toBe(40);
    expect(st.inputs.get('spHi')).toBe(60);
    expect(st.inputs.get('refKg')).toBe(50);
    expect(st.inputs.get('shift')).toBe('morning');
    expect(st.inputs.get('product')).toBe(21);
  });

  it('a shift range reaches the query with its four parameters', async () => {
    const { pool, statements } = datasetPool([]);
    await getSackCells(pool, 1, { ...Q, shiftRange: { from: '2026-09-01', fromShift: 'evening', to: '2026-09-03', toShift: 'morning' } });
    const st = statements.find((s) => s.sql.includes('GROUP BY e.shift_date'))!;
    expect(st.sql).toContain('@srFrom');
    expect(st.inputs.get('srFromOrd')).toBe(2);
    expect(st.inputs.get('srToOrd')).toBe(1);
  });

  it('net basis: the tare comes off every sack, the centre moves with it, spread is untouched', async () => {
    const data: RawSack[] = [
      { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 },
      { id: 2, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.6 },
      { id: 3, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 0 },
    ];
    const gross = await getSackCells(datasetPool(data, { basis: 'gross' }).pool, 1, Q);
    const net = await getSackCells(datasetPool(data, { basis: 'net', tare: 0.5 }).pool, 1, Q);
    const [g] = gross.cells;
    const [n] = net.cells;
    expect(net.weightBasis).toBe('net');
    expect(net.tareKg).toBe(0.5);
    expect(n!.kg).toBe(g!.kg - 0.5 * 3); // 94.8 - 1.5
    expect(n!.plausKg).toBe(g!.plausKg - 0.5 * 2);
    expect(n!.minKg).toBe(46.7);
    expect(n!.maxKg).toBe(47.1);
    expect(n!.centreKg).toBe(g!.centreKg - 0.5);
    expect(rollupAll(net.cells).avgKg).toBe(46.9);
    expect(rollupAll(net.cells).sdKg!).toBeCloseTo(rollupAll(gross.cells).sdKg!, 12);
  });

  it('one generation: the sack epoch is bound, and the cells say what was left out', async () => {
    const data: RawSack[] = [{ id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 }];
    const { pool, statements } = datasetPool(data, { epochs: true });
    const r = await getSackCells(pool, 1, Q);
    const st = statements.find((s) => s.sql.includes('GROUP BY e.shift_date'))!;
    expect(st.sql).toMatch(/e\.source_epoch = @ges0/);
    expect(st.inputs.get('ges0')).toBe(10);
    expect(r.generationNote.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(r.generationNote.spansGenerations).toBe(true);
    expect(r.generationNote.otherGenerationExcluded).toBe(9999);
    expect(r.generationNote.excludedSimulator).toBe(9999);
  });

  it('a context resolved once is shared: no second scope query, no second rule read', async () => {
    const { pool, statements } = datasetPool([{ id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: false, w: 47.2 }], { epochs: true });
    const ctx = await resolveSackContext(pool, 1, Q);
    const before = statements.length;
    await getSackCells(pool, 1, Q, ctx);
    await getSackBins(pool, 1, Q, 0.1, ctx);
    await listSacks(pool, 1, Q, { cap: 10, inRange: false, ctx });
    const after = statements.slice(before);
    expect(after.some((s) => s.sql.includes('sms.plausibility_rule') || s.sql.includes('sms.weight_rule'))).toBe(false);
    for (const s of after) expect(s.inputs.get('ges0')).toBe(10);
  });

  it('the rules are read as of the period end, and a changed rule is reported', async () => {
    // Two plausibility versions: 40-60 until 2026-09-02 12:00, 45-55 after. A period ending 2026-09-03 sees 45-55.
    const statements: Stmt[] = [];
    const pool = {
      request: () => {
        const inputs = new Map<string, unknown>();
        const req = {
          input: (n: string, _t: unknown, v: unknown) => { inputs.set(n, v); return req; },
          query: async (sql: string) => {
            if (sql.includes('AS tbl, source_epoch AS epoch_id') || sql.includes('FROM sms.source_epoch')) return { recordset: [] };
            statements.push({ sql, inputs: new Map(inputs) });
            if (sql.includes('sms.plausibility_rule')) {
              return { recordset: [
                { cl: 1500, ch: 2100, sl: 45, sh: 55, effective_from: new Date('2026-09-02T12:00:00Z') },
                { cl: 1500, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2000-01-01T00:00:00Z') },
              ] };
            }
            if (sql.includes('sms.weight_rule')) return { recordset: [] };
            return { recordset: [] };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;
    const r = await getSackCells(pool, 1, Q);
    expect(r.plausibility).toEqual({ loKg: 45, hiKg: 55 });
    expect(r.plausibilityRuleChangedInPeriod).toBe(true);
    expect(r.weightRuleChangedInPeriod).toBe(false);
    expect(r.weightBasis).toBe('as_recorded'); // an empty weight_rule history is the documented default
    expect(statements.find((s) => s.sql.includes('GROUP BY e.shift_date'))!.inputs.get('spLo')).toBe(45);
  });
});

describe('getSackBins', () => {
  const Q = { from: '2026-09-01', to: '2026-09-03' };
  const data: RawSack[] = [
    { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.2 },
    { id: 2, date: '2026-09-01', shift: 'morning', mat: 21, inRange: true, w: 47.24 },
    { id: 3, date: '2026-09-01', shift: 'evening', mat: 21, inRange: false, w: 47.4 },
    { id: 4, date: '2026-09-01', shift: 'evening', mat: 21, inRange: false, w: 0 },
    { id: 5, date: '2026-09-01', shift: 'night', mat: 21, inRange: null, w: null },
  ];

  it('bins by the bound width on the basis, ROUND before FLOOR, and keeps the implausible and weightless apart', async () => {
    const { pool, statements } = datasetPool(data);
    const r = await getSackBins(pool, 1, Q, 0.1);
    const st = statements.find((s) => s.sql.includes('FLOOR(ROUND('))!;
    expect(st.sql).toContain('FLOOR(ROUND((e.weight_kg - @adjKg) / @binKg, 6))');
    expect(st.inputs.get('binKg')).toBe(0.1);
    expect(st.inputs.get('adjKg')).toBe(0);
    expect(r.binKg).toBe(0.1);
    const plausible = r.rows.filter((x) => x.kind === 'plausible');
    // 47.2 and 47.24 share the 47.2 bin; 47.4 sits exactly on the 47.4 edge (47.4 / 0.1 is 473.99999... unrounded)
    expect(plausible.map((x) => [x.fromKg, x.shift, x.inRange, x.sacks]).sort()).toEqual([[47.2, 'morning', true, 2], [47.4, 'evening', false, 1]]);
    expect(r.rows.filter((x) => x.kind === 'implausible')).toEqual([{ kind: 'implausible', bin: null, fromKg: null, shift: 'evening', inRange: false, sacks: 1 }]);
    expect(r.rows.filter((x) => x.kind === 'noWeight')).toEqual([{ kind: 'noWeight', bin: null, fromKg: null, shift: 'night', inRange: null, sacks: 1 }]);
    // every sack lands in exactly one row
    expect(r.rows.reduce((a, x) => a + x.sacks, 0)).toBe(5);
  });

  it('a net basis moves the bins down by the tare', async () => {
    const { pool } = datasetPool(data, { basis: 'net', tare: 0.5 });
    const r = await getSackBins(pool, 1, Q, 0.1);
    expect(r.weightBasis).toBe('net');
    expect(r.rows.filter((x) => x.kind === 'plausible').map((x) => x.fromKg).sort()).toEqual([46.7, 46.9]);
  });

  it('refuses a width that is not a positive number', async () => {
    const { pool } = datasetPool(data);
    await expect(getSackBins(pool, 1, Q, 0)).rejects.toThrow(/binKg/);
    await expect(getSackBins(pool, 1, Q, Number.NaN)).rejects.toThrow(/binKg/);
  });
});

describe('listSacks', () => {
  const Q = { from: '2026-09-01', to: '2026-09-03' };
  const data: RawSack[] = [
    { id: 1, date: '2026-09-01', shift: 'morning', mat: 21, inRange: false, w: 47.2, ts: 300, num: 11 },
    { id: 2, date: '2026-09-01', shift: 'morning', mat: null, inRange: false, w: 0, ts: 100, num: 12 },
    { id: 3, date: '2026-09-01', shift: 'evening', mat: 21, inRange: true, w: 47.3, ts: 200, num: 13 },
    { id: 4, date: '1969-12-31', shift: 'evening', mat: null, inRange: false, w: 0, ts: 0, num: null },
  ];

  it('lists oldest first, marks the implausible, and leaves the zeroed-clock row out of the list and the total — counting it', async () => {
    const { pool, statements } = datasetPool(data);
    const r = await listSacks(pool, 1, Q, { cap: 100, inRange: false });
    expect(r.rows.map((x) => x.sackEventId)).toEqual([2, 1]);
    expect(r.rows.map((x) => x.implausible)).toEqual([true, false]);
    expect(r.rows[1]).toMatchObject({ sackNum: 11, materialId: 21, inRange: false, weightKg: 47.2, weightOnBasisKg: 47.2, producedAtMs: 300 });
    expect(r.total).toBe(2); // the two rejected sacks with a real clock; id 3 passed
    expect(r.excludedClockFault).toBe(1); // id 4: rejected, but its clock is zeroed
    const rows = statements.find((s) => s.sql.includes('TOP (@listCap)'))!;
    expect(rows.sql).toContain('e.production_ts_utc_ms > 0');
    expect(rows.sql).toContain('e.in_range = 0');
    expect(rows.inputs.get('listCap')).toBe(100);
  });

  it('the cap limits the rows, never the total', async () => {
    const { pool } = datasetPool(data);
    const r = await listSacks(pool, 1, Q, { cap: 1 });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.sackEventId).toBe(2);
    expect(r.total).toBe(3);
    expect(r.cap).toBe(1);
  });

  it('the verdict clause follows the option: passed, no verdict, or none at all', async () => {
    const run = async (inRange: boolean | null | undefined) => {
      const { pool, statements } = datasetPool(data);
      await listSacks(pool, 1, Q, { cap: 5, ...(inRange === undefined ? {} : { inRange }) });
      return statements.find((s) => s.sql.includes('TOP (@listCap)'))!.sql;
    };
    expect(await run(true)).toContain('e.in_range = 1');
    expect(await run(null)).toContain('e.in_range IS NULL');
    const all = await run(undefined);
    expect(all).not.toContain('e.in_range = ');
    expect(all).not.toContain('e.in_range IS NULL');
  });

  it('a net basis reports the basis weight beside the recorded one', async () => {
    const { pool } = datasetPool(data, { basis: 'net', tare: 0.5 });
    const r = await listSacks(pool, 1, Q, { cap: 10, inRange: false });
    expect(r.rows.find((x) => x.sackEventId === 1)).toMatchObject({ weightKg: 47.2, weightOnBasisKg: 46.7 });
    expect(r.weightBasis).toBe('net');
  });
});
