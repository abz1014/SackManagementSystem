/**
 * Sack Packing Weight Summary (IFL report 5): the composition of the report
 * from the shared cells. `getSackCells` is mocked with hand-built cells (its
 * own SQL and arithmetic are pinned in sackCells.test.ts); the roll-up is the
 * real one, so what is proven here is that each table is the right grouping of
 * the right cells, in the right order, rounded the way a reader sees it.
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
  getSackWeightSummaryReport, sackWeightSummaryCsv, sackWeightSummaryPendingIfl, SACK_WEIGHT_SUMMARY_CSV_HEADERS,
  NO_PRODUCT_LABEL, NO_COUNT_LABEL,
} from './sackWeightSummary.js';

const POOL = {} as unknown as ConnectionPool;
const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-03' };

/** Count text by material id: 21 -> "36", 24 -> "36 Slub", two materials (7, 9) share "36"? no: 7 and 9 share "30". */
const COUNT_TEXT: Record<number, string | null> = { 20: '18', 21: '36', 24: '36 Slub', 23: '20 Slub', 22: '50', 7: '30', 9: '30', 99: null };

function catalogue() {
  return {
    product: (id: number) => (id in COUNT_TEXT ? { productId: id, label: `P${id}`, countText: COUNT_TEXT[id] } : null),
    distinctLabel: (id: number) => `P${id}`,
  };
}

const sd2pass = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** A cell from raw weights, centred at 50, exactly as the SQL would produce it. */
function cell(ws: number[], over: Partial<SackCell> = {}): SackCell {
  const plaus = ws.filter((w) => w >= 40 && w <= 60);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
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

/** The raw weights behind the fixture: three days, three shifts, three materials and one without. */
const W = {
  d1m21: [47.2, 47.3, 47.4, 47.1],
  d1m21rej: [47.5],
  d1e21: [47.0, 47.2],
  d1n: [47.3, 0], // no product, the second a 0 kg scale fault
  d2m7: [47.4, 47.5, 47.3],
  d2e9: [47.6],
  d3m24: [47.2],
  d3e99: [47.3, 47.1], // material with no count on record
  d3n98: [47.25], // material the catalogue has never heard of
};

function fixtureCells(): SackCell[] {
  return [
    cell(W.d1m21, { date: '2026-09-01', shift: 'morning', materialId: 21, inRange: true }),
    cell(W.d1m21rej, { date: '2026-09-01', shift: 'morning', materialId: 21, inRange: false }),
    cell(W.d1e21, { date: '2026-09-01', shift: 'evening', materialId: 21, inRange: true }),
    cell(W.d1n, { date: '2026-09-01', shift: 'night', materialId: null, inRange: false }),
    cell(W.d2m7, { date: '2026-09-02', shift: 'morning', materialId: 7, inRange: true }),
    cell(W.d2e9, { date: '2026-09-02', shift: 'evening', materialId: 9, inRange: null }),
    cell(W.d3m24, { date: '2026-09-03', shift: 'morning', materialId: 24, inRange: true }),
    cell(W.d3e99, { date: '2026-09-03', shift: 'evening', materialId: 99, inRange: true }),
    cell(W.d3n98, { date: '2026-09-03', shift: 'night', materialId: 98, inRange: true }),
  ];
}

beforeEach(() => {
  vi.mocked(getSackCells).mockReset().mockResolvedValue(result(fixtureCells()));
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue(catalogue() as never);
});

describe('getSackWeightSummaryReport — the tables', () => {
  it('one row per production date and shift, chronological with morning, evening, night inside a day; a verdict split of one shift is ONE row', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.rows.map((r) => `${r.date} ${r.shift}`)).toEqual([
      '2026-09-01 morning', '2026-09-01 evening', '2026-09-01 night',
      '2026-09-02 morning', '2026-09-02 evening',
      '2026-09-03 morning', '2026-09-03 evening', '2026-09-03 night',
    ]);
    const m = d.rows[0]!; // passed 4 + rejected 1 sacks of the same shift
    const all = [...W.d1m21, ...W.d1m21rej];
    expect(m.sacks).toBe(5);
    expect(m.kg).toBe(236.5);
    expect(m.avgKg).toBe(47.3);
    expect(m.minKg).toBe(47.1);
    expect(m.maxKg).toBe(47.5);
    expect(m.sdKg).toBe(Math.round(sd2pass(all) * 1000) / 1000);
    expect(m.rejectedByScale).toBe(1);
    expect(m.implausible).toBe(0);
  });

  it('a 0 kg scale fault stays in the sack count, the kilograms and the rejected count but out of average, lightest and SD', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    const n = d.rows.find((r) => r.date === '2026-09-01' && r.shift === 'night')!;
    expect(n.sacks).toBe(2);
    expect(n.kg).toBe(47.3);
    expect(n.avgKg).toBe(47.3); // not 23.65
    expect(n.minKg).toBe(47.3);
    expect(n.sdKg).toBeNull(); // one plausible sack
    expect(n.implausible).toBe(1);
    expect(n.rejectedByScale).toBe(2); // the scale rejected both
  });

  it('day totals, shift totals and the grand total each add up to the rows', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.dayTotals.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(d.shiftTotals.map((r) => r.shift)).toEqual(['morning', 'evening', 'night']);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    for (const group of [d.rows, d.dayTotals, d.shiftTotals, d.byYarnCount]) {
      expect(sum(group.map((r) => r.sacks))).toBe(d.total.sacks);
      // exact to the thousandth, not "close at 0.1" (gate round 3)
      expect(Math.round(sum(group.map((r) => r.kg)) * 1000)).toBe(Math.round(d.total.kg * 1000));
      expect(sum(group.map((r) => r.rejectedByScale))).toBe(d.total.rejectedByScale);
      expect(sum(group.map((r) => r.implausible))).toBe(d.total.implausible);
    }
    expect(d.total.sacks).toBe(17);
    expect(d.total.implausible).toBe(1);
    expect(d.total.rejectedByScale).toBe(3); // 1 rejected morning sack + the night pair
  });

  it('kilograms carry their thousandths: a day\'s rows add to its total and the days add to the grand total EXACTLY, so an exported SUM is checkable (rounding to 0.1 broke this)', async () => {
    // Sack weights are stored to 0.001 kg; none of these shift sums lands on a tenth.
    const wsA = [47.123, 47.456, 46.987]; // 141.566
    const wsB = [47.211, 47.309]; // 94.520
    const wsC = [47.077, 47.151, 47.399]; // 141.627
    vi.mocked(getSackCells).mockResolvedValue(result([
      cell(wsA, { date: '2026-09-01', shift: 'morning', materialId: 21, inRange: true }),
      cell(wsB, { date: '2026-09-01', shift: 'evening', materialId: 21, inRange: true }),
      cell(wsC, { date: '2026-09-02', shift: 'morning', materialId: 7, inRange: true }),
    ]));
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    const milli = (n: number) => Math.round(n * 1000);
    expect(d.rows.map((r) => r.kg)).toEqual([141.566, 94.52, 141.627]);
    expect(d.dayTotals.map((r) => r.kg)).toEqual([236.086, 141.627]);
    expect(d.total.kg).toBe(377.713);
    for (const group of [d.rows, d.dayTotals, d.shiftTotals, d.byYarnCount]) {
      expect(group.reduce((a, r) => a + milli(r.kg), 0)).toBe(milli(d.total.kg));
    }
    // and the CSV carries the same thousandths, not a rounded copy
    const t = sackWeightSummaryCsv(d);
    const kgCol = t.headers.indexOf('kg');
    expect(t.rows.find((r) => r[0] === 'grand_total')![kgCol]).toBe(377.713);
    expect(t.rows.filter((r) => r[0] === 'day_shift').map((r) => r[kgCol])).toEqual([141.566, 94.52, 141.627]);
  });

  it('a shift total and the grand total spread are the two-pass figures over the raw sacks, not an average of averages', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    const raw = Object.values(W).flat().filter((w) => w >= 40 && w <= 60);
    expect(d.total.sdKg).toBe(Math.round(sd2pass(raw) * 1000) / 1000);
    expect(d.total.avgKg).toBe(Math.round((100 * raw.reduce((a, b) => a + b, 0)) / raw.length) / 100);
    expect(d.total.minKg).toBe(47);
    expect(d.total.maxKg).toBe(47.6);
    const morning = [...W.d1m21, ...W.d1m21rej, ...W.d2m7, ...W.d3m24];
    expect(d.shiftTotals.find((s) => s.shift === 'morning')!.sdKg).toBe(Math.round(sd2pass(morning) * 1000) / 1000);
  });

  it('yarn counts: ascending as numbers, two materials with one count share a row, unknown count then no product last', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.byYarnCount.map((c) => c.label)).toEqual(['30', '36', '36 Slub', NO_COUNT_LABEL, NO_PRODUCT_LABEL]);
    const thirty = d.byYarnCount[0]!;
    expect(thirty).toMatchObject({ yarnCount: '30', materialIds: [7, 9], sacks: 4 }); // 3 + 1 sacks of materials 7 and 9
    expect(d.byYarnCount[1]).toMatchObject({ yarnCount: '36', materialIds: [21], sacks: 7 });
    // a material with a product but no count on record, and one the catalogue does not know, are one different fact from "no product"
    expect(d.byYarnCount[3]).toMatchObject({ yarnCount: null, label: NO_COUNT_LABEL, materialIds: [98, 99], sacks: 3 });
    expect(d.byYarnCount[4]).toMatchObject({ yarnCount: null, label: NO_PRODUCT_LABEL, materialIds: [], sacks: 2 });
  });

  it('counts sort the way a person reads them: 18, 20 Slub, 30, 36, 36 Slub, 50, not as text', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result([
      cell([47.2], { materialId: 22 }), cell([47.2], { materialId: 24 }), cell([47.2], { materialId: 21 }),
      cell([47.2], { materialId: 23 }), cell([47.2], { materialId: 20 }), cell([47.2], { materialId: 7 }),
    ]));
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.byYarnCount.map((c) => c.label)).toEqual(['18', '20 Slub', '30', '36', '36 Slub', '50']);
  });

  it('an empty period is a valid, empty report that still carries its note and assumptions', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result([]));
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.rows).toEqual([]);
    expect(d.dayTotals).toEqual([]);
    expect(d.shiftTotals).toEqual([]);
    expect(d.byYarnCount).toEqual([]);
    expect(d.total).toEqual({ sacks: 0, kg: 0, avgKg: null, minKg: null, maxKg: null, sdKg: null, rejectedByScale: 0, implausible: 0 });
    expect(d.note).toMatch(/\S/);
    expect(d.pendingIfl.length).toBeGreaterThan(0);
    expect(sackWeightSummaryCsv(d).rows).toHaveLength(1); // the grand total, nothing else
  });
});

describe('getSackWeightSummaryReport — what it asks of the cells', () => {
  it('passes the period, the shift and product filters and the shift range through untouched', async () => {
    const shiftRange = { from: '2026-09-01', fromShift: 'evening' as const, to: '2026-09-03', toShift: 'morning' as const };
    await getSackWeightSummaryReport(POOL, 7, PERIOD, { shift: 'night', product: 21 }, shiftRange);
    expect(getSackCells).toHaveBeenCalledTimes(1);
    expect(getSackCells).toHaveBeenCalledWith(POOL, 7, { from: '2026-09-01', to: '2026-09-03', shift: 'night', product: 21, shiftRange });
  });

  it('carries the weight basis, the plausibility window and the generation note from the cells', async () => {
    const generationNote = { generation: { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: null, simulator: false }, spansGenerations: true, otherGenerationExcluded: 6199, excludedSimulator: 6199 };
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells(), { weightBasis: 'gross', plausibility: { loKg: 45, hiKg: 55 }, generationNote }));
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.weightBasis).toBe('gross');
    expect(d.plausibility).toEqual({ loKg: 45, hiKg: 55 });
    expect(d.generationNote).toEqual(generationNote);
    expect(d.lineId).toBe(1);
    expect(d.period).toEqual(PERIOD);
  });
});

describe('the note and the assumptions', () => {
  it('states the basis, never calls a sack under- or over-weight, and says no machine is recorded', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.note).toContain('nothing is subtracted');
    expect(d.note).toMatch(/no sack tolerance/);
    expect(d.note).toMatch(/no machine/);
    expect(d.note).not.toMatch(/\b(underweight|overweight|under-weight is|out of tolerance|faulty)\b/i);
  });

  it('a net basis names the tare in the note AND as an unconfirmed assumption; gross does not', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells(), { weightBasis: 'net', tareKg: 0.5 }));
    const net = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(net.note).toContain('net: the 0.5 kg sack tare');
    expect(net.pendingIfl.join(' ')).toContain('net of a 0.5 kg sack tare');
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells(), { weightBasis: 'gross' }));
    const gross = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(gross.pendingIfl.join(' ')).not.toContain('tare');
  });

  it('the assumptions name the window actually used, the SD convention and the count mapping', () => {
    const lines = sackWeightSummaryPendingIfl('as_recorded', 0.5, 40, 60);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('less than 40 kg or more than 60 kg');
    expect(lines[0]).toContain('IFL has not confirmed the window');
    expect(lines[1]).toContain('sample standard deviation');
    expect(lines[2]).toContain('today’s product master');
    expect(sackWeightSummaryPendingIfl('net', 0.5, 45, 55)[0]).toContain('0.5 kg sack tare');
    expect(sackWeightSummaryPendingIfl('net', 0.5, 45, 55)[1]).toContain('less than 45 kg or more than 55 kg');
  });

  it('a rule version recorded inside the period is disclosed as a record, not claimed as a change of value', async () => {
    vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells(), { weightRuleChangedInPeriod: true, plausibilityRuleChangedInPeriod: true }));
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    expect(d.note).toContain('recorded a new weight-basis version');
    expect(d.note).toContain('recorded a new plausible-weight-window version');
    const quiet = await (async () => {
      vi.mocked(getSackCells).mockResolvedValue(result(fixtureCells()));
      return getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    })();
    expect(quiet.note).not.toContain('recorded a new');
  });
});

describe('sackWeightSummaryCsv', () => {
  it('keeps the frozen headers; every row is exactly as wide; the sections are the contract\'s', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    const t = sackWeightSummaryCsv(d);
    expect([...t.headers]).toEqual([...SACK_WEIGHT_SUMMARY_CSV_HEADERS]);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    const sections = [...new Set(t.rows.map((r) => r[0]))];
    expect(sections).toEqual(['day_shift', 'day_total', 'shift_total', 'yarn_count', 'grand_total']);
    expect(t.rows.filter((r) => r[0] === 'day_shift')).toHaveLength(d.rows.length);
  });

  it('a yarn count row carries the count text and the space-separated material ids; a lone-sack SD is an empty cell, not 0', async () => {
    const d = await getSackWeightSummaryReport(POOL, 1, PERIOD, {});
    const t = sackWeightSummaryCsv(d);
    const col = (n: string) => t.headers.indexOf(n as never);
    const thirty = t.rows.find((r) => r[0] === 'yarn_count' && r[col('yarn_count')] === '30')!;
    expect(thirty[col('material_ids')]).toBe('7 9');
    const night = t.rows.find((r) => r[0] === 'day_shift' && r[col('date')] === '2026-09-01' && r[col('shift')] === 'night')!;
    expect(night[col('sd_kg')]).toBeNull();
    expect(night[col('implausible')]).toBe(1);
    const grand = t.rows.find((r) => r[0] === 'grand_total')!;
    expect(grand[col('sacks')]).toBe(17);
  });
});
