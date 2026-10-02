/**
 * SPS Production Report, count-wise packing (IFL report 3): the composition of
 * the matrix from the shared cells. `getSackCells` is mocked with hand-built
 * cells (its own SQL and arithmetic are pinned in sackCells.test.ts); the
 * roll-up is the real one, so what is proven here is that each table is the
 * right grouping of the right cells, in the right order, with the right
 * population behind every average.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../sackCells.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sackCells.js')>();
  return { ...actual, getSackCells: vi.fn() };
});
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});

import { getSackCells, type SackCell, type SackCellsResult } from '../sackCells.js';
import { loadProductCatalogue } from '../productLimits.js';
import {
  getSpsPackingReport, spsPackingCsv, spsPackingPendingIfl, SPS_PACKING_CSV_HEADERS, SPS_PACKING_PENDING_IFL,
  SPS_NO_PRODUCT_KEY, SPS_NO_PRODUCT_LABEL, SPS_NO_COUNT_KEY, SPS_NO_COUNT_LABEL, SPS_BLOCK_LABEL,
} from './spsPacking.js';

const POOL = {} as unknown as ConnectionPool;
const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-03' };

/** Count text by material id: 21 -> "36", 24 -> "36 Slub"; materials 7 and 9 SHARE "30"; 99 has a product but no count. */
const COUNT_TEXT: Record<number, string | null> = { 20: '18', 21: '36', 24: '36 Slub', 23: '20 Slub', 22: '50', 7: '30', 9: '30', 99: null };

function catalogue() {
  return {
    product: (id: number) => (id in COUNT_TEXT ? { productId: id, label: `P${id}`, countText: COUNT_TEXT[id] } : null),
    distinctLabel: (id: number) => `P${id}`,
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** A cell from raw weights, centred at 50, exactly as the SQL would produce it. */
function cell(ws: number[], over: Partial<SackCell> = {}): SackCell {
  const plaus = ws.filter((w) => w >= 40 && w <= 60);
  return {
    date: '2026-09-01', shift: 'morning', materialId: 21, inRange: true,
    sacks: ws.length, kg: r3(ws.reduce((a, b) => a + b, 0)),
    implausible: ws.length - plaus.length, plausible: plaus.length, plausKg: r3(plaus.reduce((a, b) => a + b, 0)),
    sumD: plaus.reduce((a, b) => a + (b - 50), 0), sumD2: plaus.reduce((a, b) => a + (b - 50) ** 2, 0), centreKg: 50,
    minKg: plaus.length ? Math.min(...plaus) : null, maxKg: plaus.length ? Math.max(...plaus) : null,
    ...over,
  };
}

function result(cells: SackCell[], over: Partial<SackCellsResult> = {}): SackCellsResult {
  return {
    cells, weightBasis: 'as_recorded', tareKg: 0.5, plausibility: { loKg: 40, hiKg: 60 },
    generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0, excludedSimulator: 0 },
    weightRuleChangedInPeriod: false, plausibilityRuleChangedInPeriod: false,
    ...over,
  };
}

/** Raw weights behind the fixture: three days, three shifts, counts 36 / 30 (two materials) / 36 Slub, a count-less product and no product. */
const WS = {
  d1m21: [47.2, 47.3, 47.4, 47.1],
  d1m21rej: [47.5], // same shift, same material, the scale's other verdict: ONE matrix cell
  d1e7: [47.0, 47.2],
  d1n: [47.3, 0], // no product; the second a 0 kg scale fault
  d2m7: [47.4, 47.5, 47.3],
  d2m9: [47.6], // material 9: the same count "30" as material 7
  d3m24: [47.2],
  d3e99: [47.3, 47.1], // a product whose count is not on record
};

function fixtureCells(): SackCell[] {
  return [
    cell(WS.d1m21, { date: '2026-09-01', shift: 'morning', materialId: 21, inRange: true }),
    cell(WS.d1m21rej, { date: '2026-09-01', shift: 'morning', materialId: 21, inRange: false }),
    cell(WS.d1e7, { date: '2026-09-01', shift: 'evening', materialId: 7, inRange: true }),
    cell(WS.d1n, { date: '2026-09-01', shift: 'night', materialId: null, inRange: false }),
    cell(WS.d2m7, { date: '2026-09-02', shift: 'morning', materialId: 7, inRange: true }),
    cell(WS.d2m9, { date: '2026-09-02', shift: 'morning', materialId: 9, inRange: null }),
    cell(WS.d3m24, { date: '2026-09-03', shift: 'morning', materialId: 24, inRange: true }),
    cell(WS.d3e99, { date: '2026-09-03', shift: 'evening', materialId: 99, inRange: true }),
  ];
}

beforeEach(() => {
  vi.mocked(getSackCells).mockReset().mockResolvedValue(result(fixtureCells()));
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue(catalogue() as never);
});

describe('getSpsPackingReport — the matrix', () => {
  it('one row per production date and shift, chronological, morning / evening / night inside a day; a verdict split of one shift is ONE cell', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.rows.map((r) => `${r.date} ${r.shift}`)).toEqual([
      '2026-09-01 morning', '2026-09-01 evening', '2026-09-01 night',
      '2026-09-02 morning',
      '2026-09-03 morning', '2026-09-03 evening',
    ]);
    const m = d.rows[0]!; // 4 passed + 1 rejected sack of material 21 in the morning
    expect(m.cells).toEqual({ '36': { sacks: 5, kg: 236.5 } });
    expect(m.total).toEqual({ sacks: 5, kg: 236.5 });
  });

  it('two materials sharing one yarn count are summed into ONE cell, and both ids are listed on the column', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const day2 = d.rows.find((r) => r.date === '2026-09-02')!;
    expect(day2.cells['30']).toEqual({ sacks: 4, kg: r3(47.4 + 47.5 + 47.3 + 47.6) }); // 3 of material 7 + 1 of material 9
    expect(d.columns.find((c) => c.key === '30')).toMatchObject({ yarnCount: '30', label: '30', materialIds: [7, 9] });
    const thirty = d.totals.find((t) => t.key === '30')!;
    expect(thirty).toMatchObject({ sacks: 6, materialIds: [7, 9] }); // 2 evening sacks of material 7 + the 4 above
  });

  it('a sack with no product on the reading (July, or a blank) is its own LAST column, no yarn count; a product with no count is a different column before it', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.columns.map((c) => c.label)).toEqual(['30', '36', '36 Slub', SPS_NO_COUNT_LABEL, SPS_NO_PRODUCT_LABEL]);
    const none = d.columns[4]!;
    expect(none).toMatchObject({ key: SPS_NO_PRODUCT_KEY, yarnCount: null, materialIds: [] });
    const unknown = d.columns[3]!;
    expect(unknown).toMatchObject({ key: SPS_NO_COUNT_KEY, yarnCount: null, materialIds: [99] });
    expect(d.totals.find((t) => t.key === SPS_NO_PRODUCT_KEY)).toMatchObject({ sacks: 2, label: SPS_NO_PRODUCT_LABEL });
    expect(d.totals.find((t) => t.key === SPS_NO_COUNT_KEY)).toMatchObject({ sacks: 2, label: SPS_NO_COUNT_LABEL });
    // the note says what the "count not on record" column is, only because one exists
    expect(d.note).toContain(SPS_NO_COUNT_LABEL);
  });

  it('columns sort the way a person reads counts: 18, 20 Slub, 30, 36, 36 Slub, 50 — not as text', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result([
      cell([47.2], { materialId: 22 }), cell([47.2], { materialId: 24 }), cell([47.2], { materialId: 21 }),
      cell([47.2], { materialId: 23 }), cell([47.2], { materialId: 20 }), cell([47.2], { materialId: 7 }),
    ]));
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.columns.map((c) => c.label)).toEqual(['18', '20 Slub', '30', '36', '36 Slub', '50']);
    expect(d.totals.map((t) => t.label)).toEqual(d.columns.map((c) => c.label));
  });

  it('a row\'s cells follow the column order, and a count with no sacks in that row is absent, not zero', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const evening3 = d.rows.find((r) => r.date === '2026-09-03' && r.shift === 'evening')!;
    expect(Object.keys(evening3.cells)).toEqual([SPS_NO_COUNT_KEY]);
    const morning3 = d.rows.find((r) => r.date === '2026-09-03' && r.shift === 'morning')!;
    expect(Object.keys(morning3.cells)).toEqual(['36 Slub']);
    // a column order check on a row with several cells
    vi.mocked(getSackCells).mockResolvedValue(result([
      cell([47.2], { materialId: null }), cell([47.2], { materialId: 24 }), cell([47.2], { materialId: 20 }),
    ]));
    const many = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(Object.keys(many.rows[0]!.cells)).toEqual(['18', '36 Slub', SPS_NO_PRODUCT_KEY]);
  });

  it('a count text that looks like a prototype key stays an ordinary own key', async () => {
    COUNT_TEXT[77] = '__proto__';
    try {
      vi.mocked(getSackCells).mockResolvedValue(result([cell([47.2, 47.3], { materialId: 77 })]));
      const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
      expect(Object.keys(d.rows[0]!.cells)).toEqual(['__proto__']);
      expect(Object.getPrototypeOf(d.rows[0]!.cells)).toBe(Object.prototype);
    } finally {
      delete COUNT_TEXT[77];
    }
  });
});

describe('getSpsPackingReport — totals', () => {
  it('rows, counts and the grand total all add up to the same sacks, and to the same kilograms EXACTLY (thousandths)', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const milli = (n: number) => Math.round(n * 1000);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(d.grandTotal.sacks).toBe(Object.values(WS).flat().length);
    expect(sum(d.rows.map((r) => r.total.sacks))).toBe(d.grandTotal.sacks);
    expect(sum(d.totals.map((t) => t.sacks))).toBe(d.grandTotal.sacks);
    expect(sum(d.rows.map((r) => milli(r.total.kg)))).toBe(milli(d.grandTotal.kg));
    expect(sum(d.totals.map((t) => milli(t.kg)))).toBe(milli(d.grandTotal.kg));
    for (const r of d.rows) {
      expect(sum(Object.values(r.cells).map((c) => c.sacks))).toBe(r.total.sacks);
      expect(sum(Object.values(r.cells).map((c) => milli(c.kg)))).toBe(milli(r.total.kg));
    }
    expect(d.grandTotal.kg).toBe(r3(Object.values(WS).flat().reduce((a, b) => a + b, 0)));
  });

  it('thousandths survive: no rounding to 0.1 anywhere a sum is exported', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result([
      cell([47.123, 47.456, 46.987], { date: '2026-09-01', shift: 'morning', materialId: 21 }), // 141.566
      cell([47.211, 47.309], { date: '2026-09-01', shift: 'evening', materialId: 21 }), // 94.520
      cell([47.077, 47.151, 47.399], { date: '2026-09-02', shift: 'morning', materialId: 7 }), // 141.627
    ]));
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.rows.map((r) => r.total.kg)).toEqual([141.566, 94.52, 141.627]);
    expect(d.totals.find((t) => t.key === '36')!.kg).toBe(236.086);
    expect(d.grandTotal.kg).toBe(377.713);
  });

  it('the average is over plausible sacks only: a 0 kg scale fault stays in the sacks and the kilograms but not in the mean; the share is of all sacks', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const none = d.totals.find((t) => t.key === SPS_NO_PRODUCT_KEY)!;
    expect(none.sacks).toBe(2);
    expect(none.kg).toBe(47.3);
    expect(none.avgKg).toBe(47.3); // not 23.65
    expect(d.implausibleSacks).toBe(1);
    // the grand mean is the two-pass mean over the plausible raw sacks
    const plaus = Object.values(WS).flat().filter((w) => w >= 40 && w <= 60);
    expect(d.grandTotal.avgKg).toBe(Math.round((100 * plaus.reduce((a, b) => a + b, 0)) / plaus.length) / 100);
    // shares are of ALL sacks (the 0 kg sack too), one decimal
    const all = Object.values(WS).flat().length;
    expect(d.totals.find((t) => t.key === '36')!.sharePct).toBe(Math.round((1000 * 5) / all) / 10);
  });

  it('an empty period is a valid empty report that still carries its SPS block, note and assumptions', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result([]));
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.columns).toEqual([]);
    expect(d.rows).toEqual([]);
    expect(d.totals).toEqual([]);
    expect(d.grandTotal).toEqual({ sacks: 0, kg: 0, avgKg: null });
    expect(d.implausibleSacks).toBe(0);
    expect(d.sps).toEqual({ number: 1, label: SPS_BLOCK_LABEL, confirmed: false });
    expect(d.note).toMatch(/\S/);
    expect(d.pendingIfl.length).toBeGreaterThan(0);
    expect(spsPackingCsv(d).rows).toHaveLength(1); // the grand total, nothing else
  });
});

describe('real data, 15 Aug 2026 (September generation): by count 18 = 60, 30 = 100, 36 = 68', () => {
  // The kilograms are the sums read from the source by sqlcmd (1 Oct 2026); the sack counts by
  // count are the audit's. One cell per count, material ids as the production database carries them.
  it('reconciles to the source, count by count', async () => {
    const c = (materialId: number, sacks: number, kg: number): SackCell =>
      ({ ...cell([]), date: '2026-08-15', shift: 'morning', materialId, inRange: true, sacks, kg, plausible: sacks, plausKg: kg, minKg: 47, maxKg: 47.6, sumD: 0, sumD2: 0, centreKg: 50 });
    vi.mocked(getSackCells).mockResolvedValue(result([c(20, 60, 2836.72), c(1021, 100, 4734.8), c(21, 68, 3214.56)]));
    COUNT_TEXT[1021] = '30';
    try {
      const d = await getSpsPackingReport(POOL, 1, { period: 'custom', from: '2026-08-15', to: '2026-08-15' }, {});
      expect(d.totals.map((t) => [t.label, t.sacks, t.kg])).toEqual([['18', 60, 2836.72], ['30', 100, 4734.8], ['36', 68, 3214.56]]);
      expect(d.grandTotal).toMatchObject({ sacks: 228, kg: 10786.08 });
    } finally {
      delete COUNT_TEXT[1021];
    }
  });
});

describe('getSpsPackingReport — what it asks of the cells', () => {
  it('passes the period, the shift and product filters and the shift range through untouched', async () => {
    const shiftRange = { from: '2026-09-01', fromShift: 'evening' as const, to: '2026-09-03', toShift: 'morning' as const };
    await getSpsPackingReport(POOL, 7, PERIOD, { shift: 'night' }, shiftRange);
    expect(getSackCells).toHaveBeenCalledTimes(1);
    expect(getSackCells).toHaveBeenCalledWith(POOL, 7, { from: '2026-09-01', to: '2026-09-03', shift: 'night', product: undefined, shiftRange });
  });

  it('carries the weight basis, the generation note, the line and the period from the cells', async () => {
    const generationNote = { generation: { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: null, simulator: false }, spansGenerations: true, otherGenerationExcluded: 6199, excludedSimulator: 6199 };
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells(), { weightBasis: 'gross', generationNote }));
    const d = await getSpsPackingReport(POOL, 1, PERIOD, { shift: 'morning' });
    expect(d.weightBasis).toBe('gross');
    expect(d.generationNote).toEqual(generationNote);
    expect(d.lineId).toBe(1);
    expect(d.period).toEqual(PERIOD);
    expect(d.filters).toEqual({ shift: 'morning' });
  });
});

describe('the SPS block, the note and the assumptions', () => {
  it('names the one SPS as this line\'s one sack scale and marks it unconfirmed', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.sps).toEqual({ number: 1, label: SPS_BLOCK_LABEL, confirmed: false });
    expect(SPS_BLOCK_LABEL).toContain('one sack scale');
    expect(SPS_BLOCK_LABEL).toContain('PLC_sack1');
    expect(d.pendingIfl.join(' ')).toContain('has not confirmed that an SPS is a sack scale');
  });

  it('prints that counts come from today\'s product master, and never attributes a sack to a winder', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.note).toContain('today’s product master');
    expect(d.note).toContain('No sack is attributed to a winder');
    expect(d.note).not.toMatch(/\b(underweight|overweight|out of tolerance|faulty)\b/i);
    expect(d.pendingIfl.join(' ')).toContain('today’s product master');
  });

  it('the assumptions name the plausible window actually used; a net basis also names the tare, gross does not', () => {
    const lines = spsPackingPendingIfl('as_recorded', 0.5, 40, 60);
    expect(lines.slice(0, SPS_PACKING_PENDING_IFL.length)).toEqual([...SPS_PACKING_PENDING_IFL]);
    expect(lines.join(' ')).toContain('less than 40 kg or more than 60 kg');
    expect(lines.join(' ')).toContain('IFL has not confirmed the window');
    expect(lines.join(' ')).not.toContain('tare');
    const net = spsPackingPendingIfl('net', 0.5, 45, 55).join(' ');
    expect(net).toContain('net of a 0.5 kg sack tare');
    expect(net).toContain('less than 45 kg or more than 55 kg');
  });

  it('a rule version recorded inside the period is disclosed as a record, not claimed as a change of value', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells(), { weightRuleChangedInPeriod: true, plausibilityRuleChangedInPeriod: true }));
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    expect(d.note).toContain('recorded a new weight-basis version');
    expect(d.note).toContain('recorded a new plausible-weight-window version');
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells()));
    expect((await getSpsPackingReport(POOL, 1, PERIOD, {})).note).not.toContain('recorded a new');
  });
});

describe('spsPackingCsv', () => {
  it('keeps the frozen headers; every row is exactly as wide; the sections are the contract\'s', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const t = spsPackingCsv(d);
    expect([...t.headers]).toEqual([...SPS_PACKING_CSV_HEADERS]);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    expect([...new Set(t.rows.map((r) => r[0]))]).toEqual(['cell', 'shift_total', 'count_total', 'grand_total']);
    expect(t.rows.filter((r) => r[0] === 'shift_total')).toHaveLength(d.rows.length);
    expect(t.rows.filter((r) => r[0] === 'count_total')).toHaveLength(d.columns.length);
  });

  it('a cell row carries the SPS label, the count, the space-separated material ids, the sacks and the exact kilograms', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const t = spsPackingCsv(d);
    const col = (n: string) => t.headers.indexOf(n as never);
    const cells = t.rows.filter((r) => r[0] === 'cell');
    const thirty = cells.find((r) => r[col('yarn_count')] === '30' && r[col('date')] === '2026-09-02')!;
    expect(thirty[col('material_ids')]).toBe('7 9');
    expect(thirty[col('sacks')]).toBe(4);
    expect(thirty[col('kg')]).toBe(r3(47.4 + 47.5 + 47.3 + 47.6));
    expect(thirty[col('sps')]).toBe(SPS_BLOCK_LABEL);
    const none = cells.find((r) => r[col('yarn_count')] === SPS_NO_PRODUCT_LABEL)!;
    expect(none[col('material_ids')]).toBe('');
    // one cell row per matrix cell
    expect(cells).toHaveLength(d.rows.reduce((a, r) => a + Object.keys(r.cells).length, 0));
  });

  it('the grand total row carries the period figures and 100 % of the sacks; a count total carries the average and the share', async () => {
    const d = await getSpsPackingReport(POOL, 1, PERIOD, {});
    const t = spsPackingCsv(d);
    const col = (n: string) => t.headers.indexOf(n as never);
    const grand = t.rows.find((r) => r[0] === 'grand_total')!;
    expect([grand[col('sacks')], grand[col('kg')], grand[col('share_pct')]]).toEqual([d.grandTotal.sacks, d.grandTotal.kg, 100]);
    const c36 = t.rows.find((r) => r[0] === 'count_total' && r[col('yarn_count')] === '36')!;
    expect([c36[col('sacks')], c36[col('avg_kg')]]).toEqual([5, d.totals.find((x) => x.key === '36')!.avgKg]);
    expect(c36[col('share_pct')]).toBe(d.totals.find((x) => x.key === '36')!.sharePct);
  });
});
