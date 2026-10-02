/**
 * SPS Sack Weight Range Report (IFL report 4): the bands and the spread.
 *
 * `getSackBins` / `getSackCells` / `resolveSackContext` are mocked with
 * hand-built rows (their own SQL and arithmetic are pinned in
 * sackCells.test.ts); the pure `defaultBands` and `buildBands` and the real
 * roll-up are exercised for real, so what is proven here is that the bands
 * are anchored on the right sacks, edges fall where a person reads them, every
 * sack is counted once, and the spread is the two-pass figure over the
 * plausible sacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import type { ShiftCode } from '@sms/shared';

vi.mock('../sackCells.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sackCells.js')>();
  return { ...actual, getSackCells: vi.fn(), getSackBins: vi.fn(), resolveSackContext: vi.fn() };
});

import {
  getSackBins, getSackCells, resolveSackContext,
  type SackBinRow, type SackBins, type SackCell, type SackCellsResult, type SackContext,
} from '../sackCells.js';
import {
  getSackWeightRangeReport, sackWeightRangeCsv, sackWeightRangePendingIfl, defaultBands, buildBands, binOfKg,
  SACK_WEIGHT_RANGE_CSV_HEADERS, SACK_WEIGHT_RANGE_PENDING_IFL, BAND_KG, WIDE_BAND_KG, MAX_BANDS,
  type BandPlan,
} from './sackWeightRange.js';

const POOL = {} as unknown as ConnectionPool;
const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-03' };
const NO_GEN = { generation: null, spansGenerations: false, otherGenerationExcluded: 0, excludedSimulator: 0 };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const sd2pass = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

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

function cellsResult(cells: SackCell[], over: Partial<SackCellsResult> = {}): SackCellsResult {
  return {
    cells, weightBasis: 'as_recorded', tareKg: 0.5, plausibility: { loKg: 40, hiKg: 60 }, generationNote: NO_GEN,
    weightRuleChangedInPeriod: false, plausibilityRuleChangedInPeriod: false,
    ...over,
  };
}

/** A bin row at weight `kg` on the report's basis, as the SQL would produce it. */
function bin(kg: number, shift: ShiftCode, inRange: boolean | null, sacks: number): SackBinRow {
  const b = binOf(kg);
  return { kind: 'plausible', bin: b, fromKg: b / 10, shift, inRange, sacks };
}
const binOf = (kg: number): number => Math.floor(Math.round((kg / 0.1) * 1e6) / 1e6);
const implausibleBin = (shift: ShiftCode, inRange: boolean | null, sacks: number): SackBinRow =>
  ({ kind: 'implausible', bin: null, fromKg: null, shift, inRange, sacks });

function binsResult(rows: SackBinRow[]): SackBins {
  return { binKg: 0.1, rows, weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 }, generationNote: NO_GEN };
}

const CTX = { marker: 'the one context' } as unknown as SackContext;

/**
 * A period like the real September one: the scale passes 47.0 - 47.6 kg; it rejects the
 * sacks outside that, and the 0 kg faults. Raw weights, so cells and bins are built from the same sacks.
 */
const SACKS: { w: number; shift: ShiftCode; date: string; ir: boolean | null }[] = [
  // passed: 47.0 - 47.6
  ...[47.0, 47.04, 47.2, 47.2, 47.3, 47.4, 47.4, 47.4].map((w) => ({ w, shift: 'morning' as const, date: '2026-09-01', ir: true as boolean | null })),
  ...[47.1, 47.25, 47.5, 47.6].map((w) => ({ w, shift: 'evening' as const, date: '2026-09-01', ir: true as boolean | null })),
  ...[47.3, 47.3].map((w) => ({ w, shift: 'night' as const, date: '2026-09-02', ir: true as boolean | null })),
  // rejected by the scale, plausible, outside what it passed
  ...[46.2, 46.75].map((w) => ({ w, shift: 'morning' as const, date: '2026-09-01', ir: false as boolean | null })),
  ...[47.8, 48.9, 55.48].map((w) => ({ w, shift: 'evening' as const, date: '2026-09-02', ir: false as boolean | null })),
  // the scale's other fault: a 0 kg reading, rejected
  { w: 0, shift: 'night', date: '2026-09-02', ir: false },
  // no verdict recorded
  { w: 47.3, shift: 'night', date: '2026-09-02', ir: null },
];

function fixtureCells(): SackCell[] {
  const groups = new Map<string, number[]>();
  const meta = new Map<string, { date: string; shift: ShiftCode; ir: boolean | null }>();
  for (const s of SACKS) {
    const k = `${s.date}|${s.shift}|${s.ir}`;
    groups.set(k, [...(groups.get(k) ?? []), s.w]);
    meta.set(k, { date: s.date, shift: s.shift, ir: s.ir });
  }
  return [...groups].map(([k, ws]) => cell(ws, { date: meta.get(k)!.date, shift: meta.get(k)!.shift, inRange: meta.get(k)!.ir }));
}

function fixtureBins(): SackBinRow[] {
  const agg = new Map<string, SackBinRow>();
  for (const s of SACKS) {
    const row = s.w >= 40 && s.w <= 60 ? bin(s.w, s.shift, s.ir, 1) : implausibleBin(s.shift, s.ir, 1);
    const k = `${row.kind}|${row.bin}|${row.shift}|${row.inRange}`;
    const have = agg.get(k);
    if (have) have.sacks += 1;
    else agg.set(k, row);
  }
  return [...agg.values()];
}

beforeEach(() => {
  vi.mocked(resolveSackContext).mockReset().mockResolvedValue(CTX);
  vi.mocked(getSackCells).mockReset().mockResolvedValue(cellsResult(fixtureCells()));
  vi.mocked(getSackBins).mockReset().mockResolvedValue(binsResult(fixtureBins()));
});

/* ------------------------------------------------------- the pure pieces */

describe('binOfKg: ROUND before FLOOR, as the SQL does', () => {
  it('a weight exactly on a 0.1 edge belongs to the bin that STARTS there, though 47.4 / 0.1 is 473.99999999999994', () => {
    expect(47.4 / 0.1).toBeLessThan(474); // the floating-point trap this guards
    expect(Math.floor(47.4 / 0.1)).toBe(473); // the naive answer is wrong ...
    expect(binOfKg(47.4)).toBe(474); // ... this one is right
    expect(binOfKg(46.8)).toBe(468);
    expect(binOfKg(47.8)).toBe(478);
    expect(binOfKg(49.4)).toBe(494);
  });

  it('a weight inside a bin stays in it: 47.43 is in 47.4, 47.399 is in 47.3', () => {
    expect(binOfKg(47.43)).toBe(474);
    expect(binOfKg(47.399)).toBe(473);
    expect(binOfKg(47.0)).toBe(470);
  });
});

describe('defaultBands', () => {
  it('0.2 kg either side of what the scale passed: 47.0 - 47.6 gives ten 0.1 kg bands, 46.8 to 47.8', () => {
    const p = defaultBands({ minKg: 47.0, maxKg: 47.6 }, { minKg: 46.2, maxKg: 55.48 })!;
    expect(p).toMatchObject({ bandKg: BAND_KG, step: 1, fromBin: 468, toBin: 478, anchor: 'passed', bandCount: 10 });
  });

  it('floor(lightest) and ceil(heaviest): a weight inside a bin rounds OUT to the bin edge before the margin is added', () => {
    // 47.04 -> floor 47.0 -> 46.8 ; 47.63 -> ceil 47.7 -> 47.9
    const p = defaultBands({ minKg: 47.04, maxKg: 47.63 }, null)!;
    expect([p.fromBin, p.toBin]).toEqual([468, 479]);
    // a heaviest sack exactly on an edge: 47.6 -> ceil 47.6 -> 47.8 (not 47.9)
    expect(defaultBands({ minKg: 47.0, maxKg: 47.6 }, null)!.toBin).toBe(478);
  });

  it('exact-edge weights are not pushed a bin by floating point: 47.4 and 46.8 land on the edge they name', () => {
    const p = defaultBands({ minKg: 46.8, maxKg: 47.4 }, null)!;
    expect([p.fromBin, p.toBin]).toEqual([466, 476]); // 46.8 -> 468 - 2 ; 47.4 -> 474 + 2
  });

  it('when the scale passed nothing the bands are built around the plausible sacks instead', () => {
    const p = defaultBands(null, { minKg: 46.2, maxKg: 48.9 })!;
    expect(p.anchor).toBe('plausible');
    // 460 .. 491 is 31 bands at 0.1 kg, one more than 30: widened to 0.2 kg, edges to multiples of 0.2 kg
    expect(p.step).toBe(2);
    expect([p.fromBin, p.toBin]).toEqual([460, 492]);
    expect(p.bandCount).toBe(16);
  });

  it('no plausible sack at all: no bands', () => {
    expect(defaultBands(null, null)).toBeNull();
  });

  it('exactly 30 bands stays at 0.1 kg; 31 widens to 0.2 kg with edges on multiples of 0.2 kg', () => {
    // from = 470 - 2 = 468, to = ceil(max) + 2 ; 30 bands -> to = 498 -> ceil(max) = 496 -> 49.6
    const thirty = defaultBands({ minKg: 47.0, maxKg: 49.6 }, null)!;
    expect(thirty).toMatchObject({ step: 1, bandCount: MAX_BANDS, bandKg: 0.1 });
    const thirtyOne = defaultBands({ minKg: 47.0, maxKg: 49.7 }, null)!;
    expect(thirtyOne).toMatchObject({ step: 2, bandKg: WIDE_BAND_KG });
    expect(thirtyOne.fromBin % 2).toBe(0);
    expect(thirtyOne.toBin % 2).toBe(0);
    expect(thirtyOne.fromBin).toBe(468);
    expect(thirtyOne.toBin).toBe(500);
    expect(thirtyOne.bandCount).toBe(16);
  });

  it('a single weight still gets a margin either side', () => {
    expect(defaultBands({ minKg: 47.0, maxKg: 47.0 }, null)).toMatchObject({ fromBin: 468, toBin: 472, bandCount: 4 });
  });
});

describe('buildBands', () => {
  const plan: BandPlan = defaultBands({ minKg: 47.0, maxKg: 47.6 }, null)!;

  it('rows read below-tail, bands ascending, above-tail, implausible; labels carry the edges', () => {
    const b = buildBands([bin(47.2, 'morning', true, 1)], plan);
    expect(b.map((x) => x.kind)).toEqual(['below', ...Array(10).fill('band'), 'above', 'implausible']);
    expect(b[0]!.label).toBe('Below 46.8 kg');
    expect(b[1]!.label).toBe('46.8 - 46.9 kg');
    expect(b[10]!.label).toBe('47.7 - 47.8 kg');
    expect(b[11]!.label).toBe('47.8 kg and above');
    expect(b[12]!.label).toBe('Implausible weight');
    expect([b[1]!.fromKg, b[1]!.toKg]).toEqual([46.8, 46.9]);
    expect([b[0]!.fromKg, b[0]!.toKg]).toEqual([null, 46.8]);
    expect([b[11]!.fromKg, b[11]!.toKg]).toEqual([47.8, null]);
    expect([b[12]!.fromKg, b[12]!.toKg]).toEqual([null, null]);
  });

  it('a band includes its lower edge and excludes its upper: 47.2 is in 47.2 - 47.3, 47.199 in 47.1 - 47.2, 47.8 in the above-tail, 46.8 in the first band', () => {
    const at = (kg: number) => buildBands([bin(kg, 'morning', true, 1)], plan).find((x) => x.total.total === 1)!.label;
    expect(at(47.2)).toBe('47.2 - 47.3 kg');
    expect(at(47.199)).toBe('47.1 - 47.2 kg');
    expect(at(47.8)).toBe('47.8 kg and above');
    expect(at(47.799)).toBe('47.7 - 47.8 kg');
    expect(at(46.8)).toBe('46.8 - 46.9 kg');
    expect(at(46.799)).toBe('Below 46.8 kg');
    expect(at(47.4)).toBe('47.4 - 47.5 kg'); // the floating-point edge case, end to end
  });

  it('every row carries all three shifts; counts split by the scale\'s verdict; a sack with no verdict is counted apart, never as a pass', () => {
    const b = buildBands(
      [bin(47.2, 'morning', true, 3), bin(47.2, 'morning', false, 2), bin(47.2, 'night', null, 4), bin(47.25, 'evening', true, 1)],
      plan,
    );
    const row = b.find((x) => x.label === '47.2 - 47.3 kg')!;
    expect(row.byShift.morning).toEqual({ passed: 3, rejected: 2, noFlag: 0, total: 5 });
    expect(row.byShift.evening).toEqual({ passed: 1, rejected: 0, noFlag: 0, total: 1 });
    expect(row.byShift.night).toEqual({ passed: 0, rejected: 0, noFlag: 4, total: 4 });
    expect(row.total).toEqual({ passed: 4, rejected: 2, noFlag: 4, total: 10 });
    expect(Object.keys(row.byShift)).toEqual(['morning', 'evening', 'night']);
  });

  it('tails hold every plausible sack beyond the bands, however far; the implausible row holds 0 kg faults and sacks with no weight', () => {
    const b = buildBands(
      [bin(40.1, 'morning', false, 2), bin(46.75, 'morning', false, 1), bin(47.8, 'evening', false, 1), bin(55.48, 'evening', false, 3),
        implausibleBin('night', false, 2), { kind: 'noWeight', bin: null, fromKg: null, shift: 'night', inRange: null, sacks: 1 }],
      plan,
    );
    const by = (k: string) => b.find((x) => x.kind === k)!;
    expect(by('below').total.rejected).toBe(3);
    expect(by('above').total.rejected).toBe(4);
    expect(by('implausible').total).toEqual({ passed: 0, rejected: 2, noFlag: 1, total: 3 });
  });

  it('shares are of ALL sacks in the table, one decimal, and the rows add to the whole', () => {
    const b = buildBands([bin(47.2, 'morning', true, 3), bin(47.3, 'morning', true, 1), implausibleBin('night', false, 1), bin(40.1, 'morning', false, 1)], plan);
    const all = 6;
    expect(b.reduce((a, x) => a + x.total.total, 0)).toBe(all);
    expect(b.find((x) => x.label === '47.2 - 47.3 kg')!.sharePct).toBe(50);
    expect(b.find((x) => x.kind === 'implausible')!.sharePct).toBe(16.7);
    expect(b.find((x) => x.label === '47.0 - 47.1 kg')!.sharePct).toBe(0);
  });

  it('a 0.2 kg plan merges bin pairs on multiples of 0.2: 46.8 - 47.0, 47.0 - 47.2', () => {
    const wide = defaultBands({ minKg: 46.0, maxKg: 49.0 }, null)!;
    expect(wide.step).toBe(2);
    const b = buildBands([bin(46.8, 'morning', true, 1), bin(46.9, 'morning', true, 1), bin(47.0, 'morning', true, 1), bin(47.1, 'morning', false, 2)], wide);
    expect(b.find((x) => x.label === '46.8 - 47.0 kg')!.total).toMatchObject({ passed: 2, total: 2 });
    expect(b.find((x) => x.label === '47.0 - 47.2 kg')!.total).toMatchObject({ passed: 1, rejected: 2, total: 3 });
    expect(b.every((x) => x.kind !== 'band' || Math.round((x.toKg! - x.fromKg!) * 10) === 2)).toBe(true);
  });

  it('no plan (no plausible sack): only the implausible row, and only when there is a sack for it; no sacks: no rows', () => {
    expect(buildBands([], null)).toEqual([]);
    expect(buildBands([], plan)).toEqual([]);
    const only = buildBands([implausibleBin('morning', false, 4)], null);
    expect(only.map((x) => x.kind)).toEqual(['implausible']);
    expect(only[0]!.sharePct).toBe(100);
  });
});

/* ----------------------------------------------------------- the report */

describe('getSackWeightRangeReport — table A', () => {
  it('anchors on the range the scale PASSED, states it, and splits every row by verdict and shift', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.passedRange).toEqual({ minKg: 47, maxKg: 47.6 });
    expect(d.bandKg).toBe(0.1);
    const first = d.bands.find((b) => b.kind === 'band')!;
    expect(first.label).toBe('46.8 - 46.9 kg');
    expect(d.bands.filter((b) => b.kind === 'band')).toHaveLength(10);
    // 47.4 (x3 morning, passed): the exact-edge weight lands in 47.4 - 47.5
    const b474 = d.bands.find((b) => b.label === '47.4 - 47.5 kg')!;
    expect(b474.byShift.morning).toMatchObject({ passed: 3, total: 3 });
    // 47.2, 47.2 morning passed + 47.25 evening passed
    const b472 = d.bands.find((b) => b.label === '47.2 - 47.3 kg')!;
    expect(b472.total.passed).toBe(3);
    expect(b472.byShift.evening.passed).toBe(1);
  });

  it('the rejected sacks outside the passed range fill the tails; the 0 kg fault is on the implausible row; the sack with no verdict is noFlag', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    const by = (k: string) => d.bands.find((b) => b.kind === k)!;
    expect(by('below').total).toEqual({ passed: 0, rejected: 2, noFlag: 0, total: 2 }); // 46.2, 46.75
    expect(by('above').total).toEqual({ passed: 0, rejected: 3, noFlag: 0, total: 3 }); // 47.8, 48.9, 55.48
    expect(by('implausible').total).toEqual({ passed: 0, rejected: 1, noFlag: 0, total: 1 });
    expect(d.implausibleSacks).toBe(1);
    const noFlag = d.bands.reduce((a, b) => a + b.total.noFlag, 0);
    expect(noFlag).toBe(1);
  });

  it('every sack is counted exactly once: the bands add up to the cells and to the raw sacks', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    const total = d.bands.reduce((a, b) => a + b.total.total, 0);
    expect(total).toBe(SACKS.length);
    expect(d.bands.reduce((a, b) => a + b.total.passed, 0)).toBe(SACKS.filter((s) => s.ir === true).length);
    expect(d.bands.reduce((a, b) => a + b.total.rejected, 0)).toBe(SACKS.filter((s) => s.ir === false).length);
    for (const s of ['morning', 'evening', 'night'] as const) {
      expect(d.bands.reduce((a, b) => a + b.byShift[s].total, 0)).toBe(SACKS.filter((x) => x.shift === s).length);
    }
    expect(d.bands.every((b) => b.total.total === b.byShift.morning.total + b.byShift.evening.total + b.byShift.night.total)).toBe(true);
  });

  it('with the scale passing nothing the bands anchor on the plausible range and the report says so (passedRange null)', async () => {
    const rej = SACKS.filter((s) => s.ir === false);
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell(rej.map((s) => s.w), { inRange: false })]));
    vi.mocked(getSackBins).mockResolvedValue(binsResult(rej.map((s) => (s.w >= 40 && s.w <= 60 ? bin(s.w, s.shift, false, 1) : implausibleBin(s.shift, false, 1)))));
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.passedRange).toBeNull();
    // plausible 46.2 .. 55.48 spans far more than 30 bands at 0.1: widened
    expect(d.bandKg).toBe(0.2);
    expect(d.pendingIfl[0]).toContain('0.2 kg wide because 0.1 kg bands would have made more than 30 rows');
    expect(d.bands.reduce((a, b) => a + b.total.total, 0)).toBe(rej.length);
  });

  it('only implausible sacks: no core bands, one row; no sacks at all: nothing', async () => {
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([0, 0], { inRange: false })]));
    vi.mocked(getSackBins).mockResolvedValue(binsResult([implausibleBin('night', false, 2)]));
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.bands.map((b) => b.kind)).toEqual(['implausible']);
    expect(d.passedRange).toBeNull();
    expect(d.spreadTotal).toMatchObject({ n: 0, minKg: null, maxKg: null, rangeKg: null, avgKg: null, sdKg: null });
    expect(d.spreadByDayShift[0]).toMatchObject({ n: 0, avgKg: null });

    vi.mocked(getSackCells).mockResolvedValue(cellsResult([]));
    vi.mocked(getSackBins).mockResolvedValue(binsResult([]));
    const empty = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(empty.bands).toEqual([]);
    expect(empty.spreadByDayShift).toEqual([]);
    expect(empty.spreadByShift).toEqual([]);
    expect(empty.spreadTotal).toEqual({ date: null, shift: null, n: 0, minKg: null, maxKg: null, rangeKg: null, avgKg: null, sdKg: null });
    expect(empty.implausibleSacks).toBe(0);
    expect(empty.note).toMatch(/\S/);
    expect(empty.pendingIfl.length).toBeGreaterThan(0);
    expect(sackWeightRangeCsv(empty).rows).toHaveLength(1); // spread_total, nothing else
  });
});

describe('getSackWeightRangeReport — table B (spread)', () => {
  it('per date and shift: n, min, max, range, mean and SAMPLE SD over the plausible sacks, chronological', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.spreadByDayShift.map((r) => `${r.date} ${r.shift}`)).toEqual([
      '2026-09-01 morning', '2026-09-01 evening', '2026-09-02 evening', '2026-09-02 night',
    ]);
    const m = d.spreadByDayShift[0]!; // 09-01 morning: passed 8 + rejected 2, all plausible
    const ws = SACKS.filter((s) => s.date === '2026-09-01' && s.shift === 'morning').map((s) => s.w);
    expect(m.n).toBe(ws.length);
    expect(m.minKg).toBe(Math.min(...ws));
    expect(m.maxKg).toBe(Math.max(...ws));
    expect(m.rangeKg).toBe(r3(Math.max(...ws) - Math.min(...ws)));
    expect(m.avgKg).toBe(Math.round((100 * ws.reduce((a, b) => a + b, 0)) / ws.length) / 100);
    expect(m.sdKg).toBe(r3(sd2pass(ws)));
  });

  it('a 0 kg fault is left out of n, the mean, the lightest and the SD of its shift, and the shift still has a row', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    const night = d.spreadByDayShift.find((r) => r.date === '2026-09-02' && r.shift === 'night')!;
    const ws = SACKS.filter((s) => s.date === '2026-09-02' && s.shift === 'night' && s.w > 0).map((s) => s.w); // 47.3 x3 (two passed + one with no verdict)
    expect(night.n).toBe(ws.length);
    expect(night.minKg).toBe(47.3); // not 0
    expect(night.avgKg).toBe(47.3);
    expect(night.sdKg).toBe(0);
  });

  it('per shift and for the period: the two-pass figures over the raw sacks, not an average of averages; the SD is within 0.001 kg of a direct STDEV', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.spreadByShift.map((r) => r.shift)).toEqual(['morning', 'evening', 'night']);
    expect(d.spreadByShift.every((r) => r.date === null)).toBe(true);
    const plaus = SACKS.filter((s) => s.w >= 40 && s.w <= 60).map((s) => s.w);
    const t = d.spreadTotal;
    expect(t).toMatchObject({ date: null, shift: null, n: plaus.length, minKg: Math.min(...plaus), maxKg: Math.max(...plaus) });
    expect(Math.abs(t.sdKg! - sd2pass(plaus))).toBeLessThanOrEqual(0.001);
    expect(t.avgKg).toBe(Math.round((100 * plaus.reduce((a, b) => a + b, 0)) / plaus.length) / 100);
    const evening = SACKS.filter((s) => s.shift === 'evening' && s.w >= 40 && s.w <= 60).map((s) => s.w);
    expect(Math.abs(d.spreadByShift.find((r) => r.shift === 'evening')!.sdKg! - sd2pass(evening))).toBeLessThanOrEqual(0.001);
  });

  it('a lone plausible sack has a range of 0 and no standard deviation', async () => {
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.3])]));
    vi.mocked(getSackBins).mockResolvedValue(binsResult([bin(47.3, 'morning', true, 1)]));
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.spreadTotal).toMatchObject({ n: 1, minKg: 47.3, maxKg: 47.3, rangeKg: 0, sdKg: null });
  });
});

describe('getSackWeightRangeReport — what it asks of the shared service', () => {
  it('resolves ONE context and hands that same context to the cells and to the bins, with the period, shift, product and shift range', async () => {
    const shiftRange = { from: '2026-09-01', fromShift: 'evening' as const, to: '2026-09-03', toShift: 'morning' as const };
    await getSackWeightRangeReport(POOL, 7, PERIOD, { shift: 'night', product: 21 }, shiftRange);
    const q = { from: '2026-09-01', to: '2026-09-03', shift: 'night', product: 21, shiftRange };
    expect(resolveSackContext).toHaveBeenCalledTimes(1);
    expect(resolveSackContext).toHaveBeenCalledWith(POOL, 7, q);
    expect(getSackCells).toHaveBeenCalledWith(POOL, 7, q, CTX);
    expect(getSackBins).toHaveBeenCalledWith(POOL, 7, q, 0.1, CTX);
  });

  it('carries the weight basis, the plausibility window and the generation note from the cells', async () => {
    const generationNote = { generation: { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: null, simulator: false }, spansGenerations: true, otherGenerationExcluded: 6199, excludedSimulator: 6199 };
    vi.mocked(getSackCells).mockResolvedValue(cellsResult(fixtureCells(), { weightBasis: 'gross', plausibility: { loKg: 45, hiKg: 55 }, generationNote }));
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, { shift: 'morning' });
    expect(d.weightBasis).toBe('gross');
    expect(d.plausibility).toEqual({ loKg: 45, hiKg: 55 });
    expect(d.generationNote).toEqual(generationNote);
    expect(d.lineId).toBe(1);
    expect(d.period).toEqual(PERIOD);
    expect(d.filters).toEqual({ shift: 'morning' });
  });
});

describe('the note and the assumptions', () => {
  it('says what a band includes, never marks a target, never calls a sack under- or over-weight', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.note).toContain('includes its lower edge and excludes its upper edge');
    expect(d.note).toContain('no band is marked as the target');
    expect(d.note).toContain('insert time');
    expect(d.note).not.toMatch(/\b(underweight|overweight|under-weight|over-weight|out of tolerance|faulty)\b/i);
  });

  it('the assumptions name the band width actually used; a net basis names the tare, gross does not', () => {
    expect(sackWeightRangePendingIfl(0.1, 'as_recorded', 0.5)).toEqual([...SACK_WEIGHT_RANGE_PENDING_IFL]);
    const wide = sackWeightRangePendingIfl(0.2, 'gross', 0.5);
    expect(wide[0]).toContain('0.2 kg wide because 0.1 kg bands would have made more than 30 rows');
    expect(wide[1]).toBe(SACK_WEIGHT_RANGE_PENDING_IFL[1]);
    expect(wide.join(' ')).not.toContain('tare');
    expect(sackWeightRangePendingIfl(0.1, 'net', 0.5)[2]).toContain('net of a 0.5 kg sack tare');
  });

  it('a rule version recorded inside the period is disclosed as a record, not claimed as a change of value', async () => {
    vi.mocked(getSackCells).mockResolvedValue(cellsResult(fixtureCells(), { weightRuleChangedInPeriod: true, plausibilityRuleChangedInPeriod: true }));
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    expect(d.note).toContain('recorded a new weight-basis version');
    expect(d.note).toContain('recorded a new plausible-weight-window version');
    vi.mocked(getSackCells).mockResolvedValue(cellsResult(fixtureCells()));
    expect((await getSackWeightRangeReport(POOL, 1, PERIOD, {})).note).not.toContain('recorded a new');
  });
});

describe('sackWeightRangeCsv', () => {
  it('keeps the frozen headers; every row is exactly as wide; the sections are the contract\'s', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    const t = sackWeightRangeCsv(d);
    expect([...t.headers]).toEqual([...SACK_WEIGHT_RANGE_CSV_HEADERS]);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    expect([...new Set(t.rows.map((r) => r[0]))]).toEqual(['band', 'spread_day_shift', 'spread_shift', 'spread_total']);
    expect(t.rows.filter((r) => r[0] === 'spread_day_shift')).toHaveLength(d.spreadByDayShift.length);
    expect(t.rows.filter((r) => r[0] === 'spread_total')).toHaveLength(1);
  });

  it('a band row carries its edges, the verdict split and its share; the open rows leave the missing edge empty', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    const t = sackWeightRangeCsv(d);
    const col = (n: string) => t.headers.indexOf(n as never);
    const periodRow = (label: string) => t.rows.find((r) => r[0] === 'band' && r[col('band')] === label && r[col('shift')] == null)!;
    const b474 = periodRow('47.4 - 47.5 kg');
    expect([b474[col('from_kg')], b474[col('to_kg')], b474[col('passed')], b474[col('rejected')], b474[col('total')]]).toEqual([47.4, 47.5, 3, 0, 3]);
    expect(b474[col('share_pct')]).toBe(d.bands.find((b) => b.label === '47.4 - 47.5 kg')!.sharePct);
    const below = periodRow('Below 46.8 kg');
    expect([below[col('from_kg')], below[col('to_kg')]]).toEqual([null, 46.8]);
    const above = periodRow('47.8 kg and above');
    expect([above[col('from_kg')], above[col('to_kg')]]).toEqual([47.8, null]);
    // per-shift band rows only where the shift has sacks
    const shiftRows = t.rows.filter((r) => r[0] === 'band' && r[col('band')] === '47.4 - 47.5 kg' && r[col('shift')] != null);
    expect(shiftRows.map((r) => r[col('shift')])).toEqual(['morning']);
  });

  it('a spread row carries n, min, max, range, mean and SD; the period row has no date or shift; a lone-sack SD is empty, not 0', async () => {
    const d = await getSackWeightRangeReport(POOL, 1, PERIOD, {});
    const t = sackWeightRangeCsv(d);
    const col = (n: string) => t.headers.indexOf(n as never);
    const total = t.rows.find((r) => r[0] === 'spread_total')!;
    expect([total[col('date')], total[col('shift')]]).toEqual([null, null]);
    expect([total[col('n')], total[col('min_kg')], total[col('max_kg')]]).toEqual([d.spreadTotal.n, d.spreadTotal.minKg, d.spreadTotal.maxKg]);
    expect(total[col('sd_kg')]).toBe(d.spreadTotal.sdKg);
    vi.mocked(getSackCells).mockResolvedValue(cellsResult([cell([47.3])]));
    vi.mocked(getSackBins).mockResolvedValue(binsResult([bin(47.3, 'morning', true, 1)]));
    const one = sackWeightRangeCsv(await getSackWeightRangeReport(POOL, 1, PERIOD, {}));
    expect(one.rows.find((r) => r[0] === 'spread_total')![col('sd_kg')]).toBeNull();
  });
});
