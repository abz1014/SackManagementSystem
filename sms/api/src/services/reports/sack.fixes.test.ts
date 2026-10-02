/**
 * The existing 'sack' report, five fixes (IFL reports, 1 Oct 2026, Task D-R5).
 * One regression test per fix, each written to FAIL against the code before
 * the fix:
 *
 *  D-S1  the shift range reaches getWeights, so the distribution is cut at the
 *        same two shift edges as the totals beside it.
 *  D-S2  every average is over the PLAUSIBLE sacks: a 16.34 kg reading the
 *        scale passed is not a sack of 16.34 kg, and no longer drags the mean.
 *  D-S4  the weight basis is always the rule in force at the period END, with
 *        or without a shift filter (it used to be "right now" under one).
 *  D-S5  the in-range share is over the sacks that carry a scale verdict; a
 *        sack with no verdict is not a pass.
 *  D-S6  the day table lists only days with a sack, and says how many days of
 *        cones alone it left out.
 *
 * The shared cells (getSackCells) are mocked with hand-built cells — their SQL
 * and arithmetic are pinned in sackCells.test.ts — and the roll-up is the real
 * one. getWeights calls through to the real function wherever a test needs to
 * see its SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('../register.js', () => ({ listEvents: vi.fn(), countEvents: vi.fn() }));
vi.mock('../weights.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../weights.js')>();
  return { ...actual, getWeights: vi.fn(), getConfiguredBasis: vi.fn() };
});
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});
vi.mock('../sackCells.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sackCells.js')>();
  return { ...actual, getSackCells: vi.fn() };
});

import { getProduction } from '../production.js';
import { countEvents } from '../register.js';
import { getWeights, getConfiguredBasis } from '../weights.js';
import { loadProductCatalogue } from '../productLimits.js';
import { getSackCells, type SackCell, type SackCellsResult } from '../sackCells.js';
import { getSackReport, sackCsv } from './sack.js';
import type { ShiftRange } from '../../shiftRange.js';

const POOL = {} as unknown as ConnectionPool;
const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-03' };
const RANGE: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-03', toShift: 'morning' };

/** A production row; `unmatchedRejects` explicit so toReportLine's fallback is not in play. */
const prow = (group: string, over: Record<string, unknown> = {}) => ({
  group, cones: 0, rejectedCones: 0, unmatchedRejects: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: 99.5, sacksPassedScalePct: null, ...over,
});

function setProduction(rows: { none?: unknown[]; shift?: unknown[]; day?: unknown[]; product?: unknown[] }) {
  vi.mocked(getProduction).mockImplementation(async (_p, _l, q) => {
    const r = q.groupBy === 'none' ? rows.none : q.groupBy === 'shift' ? rows.shift : q.groupBy === 'day' ? rows.day : rows.product;
    return { groupBy: q.groupBy, rows: (r ?? []) as never, unattributed: null, states: null, implausible: null, dataIssues: [] };
  });
}

/** A cell from raw weights, centred at 50 like the SQL. */
function cell(ws: number[], over: Partial<SackCell> = {}): SackCell {
  const plaus = ws.filter((w) => w >= 40 && w <= 60);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    date: '2026-09-02', shift: 'morning', materialId: 21, inRange: true,
    sacks: ws.length, kg: r3(ws.reduce((a, b) => a + b, 0)),
    implausible: ws.length - plaus.length, plausible: plaus.length, plausKg: r3(plaus.reduce((a, b) => a + b, 0)),
    sumD: plaus.reduce((a, b) => a + (b - 50), 0), sumD2: plaus.reduce((a, b) => a + (b - 50) ** 2, 0), centreKg: 50,
    minKg: plaus.length ? Math.min(...plaus) : null, maxKg: plaus.length ? Math.max(...plaus) : null,
    ...over,
  };
}

function cellsResult(cells: SackCell[], over: Partial<SackCellsResult> = {}): SackCellsResult {
  return {
    cells, weightBasis: 'as_recorded', tareKg: 0.5, plausibility: { loKg: 40, hiKg: 60 },
    generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0, excludedSimulator: 0 },
    weightRuleChangedInPeriod: false, plausibilityRuleChangedInPeriod: false,
    ...over,
  };
}

const fakeWeights = (basis: 'as_recorded' | 'gross' | 'net' = 'as_recorded') => ({
  basis,
  cone: { count: 0, implausible: 0, avg: null, min: null, max: null, stdev: null, unit: 'g', bucketSize: 2, histogram: [], outliers: [] },
  sack: { count: 3, implausible: 1, avg: 47.25, min: 47.25, max: 47.25, stdev: 0, unit: 'kg', bucketSize: 0.02, histogram: [{ bucket: 47.24, count: 2 }], outliers: [] },
  note: '',
});

beforeEach(() => {
  vi.mocked(getProduction).mockReset();
  vi.mocked(countEvents).mockReset().mockResolvedValue({
    count: 0, note: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 }, dataIssues: [],
  } as never);
  vi.mocked(getWeights).mockReset().mockResolvedValue(fakeWeights() as never);
  vi.mocked(getConfiguredBasis).mockReset().mockResolvedValue('gross');
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue({ distinctLabel: (id: number) => `P${id}` } as never);
  vi.mocked(getSackCells).mockReset().mockResolvedValue(cellsResult([]));
  setProduction({});
});

/* ---------------------------------------------------------------- D-S1 */

describe('D-S1 — the shift range reaches the distribution', () => {
  it('getWeights is called WITH the shift range (it used to be called with the dates alone)', async () => {
    await getSackReport(POOL, 1, PERIOD, {}, RANGE);
    expect(getWeights).toHaveBeenCalledWith(POOL, 1, undefined, PERIOD.from, PERIOD.to, RANGE);
    // and the cells the averages come from are cut at the same two edges
    expect(getSackCells).toHaveBeenCalledWith(POOL, 1, { from: PERIOD.from, to: PERIOD.to, shift: undefined, shiftRange: RANGE });
  });

  it('without a range nothing is passed on, and under a shift filter the whole-period distribution is still withheld', async () => {
    await getSackReport(POOL, 1, PERIOD, {});
    expect(vi.mocked(getWeights).mock.calls[0]![5]).toBeUndefined();
    vi.mocked(getWeights).mockClear();
    const d = await getSackReport(POOL, 1, PERIOD, { shift: 'night' }, RANGE);
    expect(getWeights).not.toHaveBeenCalled();
    expect(d.distribution).toBeNull();
  });

  it('through the REAL getWeights: every sack and cone statement carries the shift-range clause and its four parameters', async () => {
    const actual = await vi.importActual<typeof import('../weights.js')>('../weights.js');
    vi.mocked(getWeights).mockImplementation(actual.getWeights);
    const seen: { sql: string; params: Map<string, unknown> }[] = [];
    const pool = {
      request: () => {
        const params = new Map<string, unknown>();
        const req = {
          input: (n: string, _t: unknown, v: unknown) => { params.set(n, v); return req; },
          query: async (sql: string) => {
            if (sql.includes('AS tbl, source_epoch AS epoch_id') || sql.includes('FROM sms.source_epoch')) return { recordset: [] };
            seen.push({ sql, params: new Map(params) });
            if (sql.includes('FROM sms.plausibility_rule')) return { recordset: [{ cl: 1500, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2000-01-01T00:00:00Z') }] };
            if (sql.includes('FROM sms.weight_rule')) return { recordset: [] };
            if (sql.includes('STDEV(')) return { recordset: [{ n: 0, avg: null, mn: null, mx: null, sd: null, excluded: 0 }] };
            return { recordset: [] };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;
    await getSackReport(pool, 1, PERIOD, {}, RANGE);
    const dataQueries = seen.filter((s) => /FROM sms\.(sack_event|cone_event)/.test(s.sql));
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const s of dataQueries) {
      expect(s.sql).toContain('@srFrom');
      expect(s.params.get('srFromOrd')).toBe(2); // evening
      expect(s.params.get('srToOrd')).toBe(1); // morning
    }
    seen.length = 0;
    await getSackReport(pool, 1, PERIOD, {});
    for (const s of seen) expect(s.sql).not.toContain('@srFrom');
  });
});

/* ---------------------------------------------------------------- D-S2 */

describe('D-S2 — every average is over the plausible sacks', () => {
  // Two ordinary sacks of 47.25 kg and one 16.34 kg reading the scale marked in range.
  // Production divides kilograms by sacks: 110.84 / 3 = 36.95. The truth about the sacks is 47.25.
  beforeEach(() => {
    const prod = { sacks: 3, sackWeightKg: 110.84, cones: 600 };
    setProduction({
      none: [prow('total', prod)],
      shift: [prow('morning', prod)],
      day: [prow('2026-09-02', prod)],
      product: [prow('21', prod)],
    });
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.25, 47.25, 16.34], { inRange: true })]));
  });

  it('the 16.34 kg in-range sack is counted and weighed but is not in any average', async () => {
    const d = await getSackReport(POOL, 1, PERIOD, {});
    expect(d.totals.sacks).toBe(3);
    expect(d.totals.sackWeightKg).toBe(110.8); // kilograms still cover every sack
    expect(d.totals.avgSackKg).toBe(47.25); // not 36.95
    expect(d.byShift[0]!.avgSackKg).toBe(47.25);
    expect(d.byDay[0]!.avgSackKg).toBe(47.25);
    expect(d.byProduct[0]!.avgSackKg).toBe(47.25);
    expect(d.byProduct[0]!.sacks).toBe(3);
  });

  it('a group with no plausible sack prints no average rather than a polluted one', async () => {
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([0], { inRange: false })]));
    setProduction({ none: [prow('total', { sacks: 1, sackWeightKg: 0 })], shift: [prow('morning', { sacks: 1, sackWeightKg: 0 })], day: [prow('2026-09-02', { sacks: 1, sackWeightKg: 0 })], product: [prow('21', { sacks: 1, sackWeightKg: 0 })] });
    const d = await getSackReport(POOL, 1, PERIOD, {});
    expect(d.totals.avgSackKg).toBeNull();
    expect(d.byShift[0]!.avgSackKg).toBeNull();
    expect(d.byProduct[0]!.avgSackKg).toBeNull();
  });

  it('the product average follows the sack\'s own material, and the no-product group has its own', async () => {
    setProduction({
      none: [prow('total', { sacks: 3, sackWeightKg: 141.9 })],
      product: [prow('21', { sacks: 2, sackWeightKg: 94.4 }), prow('none', { sacks: 1, sackWeightKg: 47.5 })],
    });
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([
      cell([47.2, 47.2], { materialId: 21 }), cell([47.5], { materialId: null }),
    ]));
    const d = await getSackReport(POOL, 1, PERIOD, {});
    expect(d.byProduct.map((p) => [p.productId, p.avgSackKg])).toEqual([[21, 47.2], [null, 47.5]]);
  });

  it('the CSV carries the corrected average', async () => {
    const t = sackCsv(await getSackReport(POOL, 1, PERIOD, {}));
    expect(t.rows[0]![t.headers.indexOf('avg_sack_kg')]).toBe(47.25);
  });
});

/* ---------------------------------------------------------------- D-S4 */

describe('D-S4 — the weight basis is the rule at the period end, with or without a shift filter', () => {
  it('the same period names the same basis whether or not a shift is chosen; the basis "right now" is never consulted', async () => {
    // At the period end the rule said net; today's rule is gross (getConfiguredBasis).
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.2])], { weightBasis: 'net' }));
    vi.mocked(getWeights).mockResolvedValue(fakeWeights('net') as never);
    const all = await getSackReport(POOL, 1, PERIOD, {});
    const night = await getSackReport(POOL, 1, PERIOD, { shift: 'night' });
    expect(all.weightBasis).toBe('net');
    expect(night.weightBasis).toBe('net'); // it used to be 'gross' here
    expect(getConfiguredBasis).not.toHaveBeenCalled();
  });

  it('with no weight rule on file the documented default is as_recorded', async () => {
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([], { weightBasis: 'as_recorded' }));
    const d = await getSackReport(POOL, 1, PERIOD, { shift: 'morning' });
    expect(d.weightBasis).toBe('as_recorded');
  });
});

/* ---------------------------------------------------------------- D-S5 */

describe('D-S5 — a sack with no scale verdict is not a pass', () => {
  it('the in-range share is passed / (passed + rejected), not (sacks - rejected) / sacks', async () => {
    // 10 sacks: 8 passed, 1 rejected, 1 carries no verdict. The register counts the one rejected sack.
    vi.mocked(countEvents).mockResolvedValue({ count: 1, note: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 }, dataIssues: [] } as never);
    setProduction({ none: [prow('total', { sacks: 10, sackWeightKg: 472 })] });
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([
      cell(Array(8).fill(47.2), { inRange: true }), cell([47.2], { inRange: false }), cell([47.2], { inRange: null }),
    ]));
    const d = await getSackReport(POOL, 1, PERIOD, {});
    expect(d.rejectedByScale).toBe(1);
    expect(d.inRangePct).toBe(88.9); // 8 / 9; the old formula said 90 (9 / 10)
  });

  it('every sack carrying a verdict gives the plain share; none carrying one gives no share at all, not 0 and not 100', async () => {
    setProduction({ none: [prow('total', { sacks: 4, sackWeightKg: 188.8 })] });
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.2, 47.2, 47.2], { inRange: true }), cell([47.2], { inRange: false })]));
    expect((await getSackReport(POOL, 1, PERIOD, {})).inRangePct).toBe(75);
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.2, 47.2, 47.2, 47.2], { inRange: null })]));
    expect((await getSackReport(POOL, 1, PERIOD, {})).inRangePct).toBeNull();
  });
});

/* ---------------------------------------------------------------- D-S6 */

describe('D-S6 — the day table lists only days with a sack, and counts the rest', () => {
  it('a day that holds cones and no sack is left out and counted', async () => {
    setProduction({
      none: [prow('total', { cones: 9000, sacks: 3, sackWeightKg: 141.6 })],
      day: [
        prow('2026-09-01', { cones: 5000, sacks: 0, sackWeightKg: 0 }),
        prow('2026-09-02', { cones: 2000, sacks: 3, sackWeightKg: 141.6 }),
        prow('2026-09-03', { cones: 2000, sacks: 0, sackWeightKg: 0 }),
      ],
    });
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.2, 47.2, 47.2])]));
    const d = await getSackReport(POOL, 1, PERIOD, {});
    expect(d.byDay.map((r) => r.group)).toEqual(['2026-09-02']);
    expect(d.omittedConeOnlyDays).toBe(2);
    // the CSV's day rows are the listed days only
    expect(sackCsv(d).rows.filter((r) => r[0] === 'day').map((r) => r[1])).toEqual(['2026-09-02']);
  });

  it('when every day has a sack nothing is omitted, and the count is 0 (computed), not absent', async () => {
    setProduction({
      none: [prow('total', { sacks: 6, sackWeightKg: 283.2 })],
      day: [prow('2026-09-01', { sacks: 3, sackWeightKg: 141.6 }), prow('2026-09-02', { sacks: 3, sackWeightKg: 141.6 })],
    });
    const d = await getSackReport(POOL, 1, PERIOD, {});
    expect(d.byDay).toHaveLength(2);
    expect(d.omittedConeOnlyDays).toBe(0);
  });
});
