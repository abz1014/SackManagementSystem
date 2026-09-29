/**
 * Chart overhaul wave 2, Task TD (29 Sep 2026) — gap 2.
 *
 * Owner decision (brief for this task): when the management summary's page
 * period is a shift-bounded range, the comparison period is NOT
 * `priorPeriod`'s calendar-day rule (equal CALENDAR days) — it is the same
 * NUMBER OF SHIFTS immediately before the range starts. This file pins the
 * pure arithmetic (`priorShiftRange`, exported from summary.ts) across day
 * and shift boundaries including a night shift crossing midnight, and then
 * drives `getManagementSummary` end to end (mocking only the services it
 * composes, same idiom as summary.comparison.test.ts) to prove the whole
 * threads together: the CURRENT period's services receive the shift range
 * verbatim, the PRIOR period's services receive `priorShiftRange` of it (not
 * `priorPeriod`'s calendar-day range), and `KpiShape`/comparability handling
 * is untouched by any of this.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import type { ShiftRange } from '../../shiftRange.js';

vi.mock('../report.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../report.js')>();
  return { ...actual, getReport: vi.fn() };
});
vi.mock('../register.js', () => ({ listEvents: vi.fn(), countEvents: vi.fn() }));
vi.mock('../production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('../weights.js', () => ({ getWeights: vi.fn() }));
vi.mock('../weightStations.js', () => ({ getWeightStations: vi.fn() }));
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});

import { getReport, type ReportData } from '../report.js';
import { countEvents } from '../register.js';
import { getProduction } from '../production.js';
import { getWeights } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { loadProductCatalogue } from '../productLimits.js';
import { getManagementSummary, priorShiftRange } from './summary.js';

/* -------------------------------------------------------- priorShiftRange */

describe('priorShiftRange — the same shift COUNT immediately before the range, not equal calendar days', () => {
  it('a single-shift range compares against exactly the one shift before it, same day', () => {
    const r = priorShiftRange({ from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' });
    expect(r).toEqual({ from: '2026-09-02', fromShift: 'morning', to: '2026-09-02', toShift: 'morning' });
  });

  it("the brief's own worked example: 3 shifts from 2 Sep evening (evening, night, 3 Sep morning) compares against the 3 shifts before that", () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-03', toShift: 'morning' };
    const r = priorShiftRange(range);
    // The 3 shifts immediately before 2 Sep evening, in order: 1 Sep evening,
    // 1 Sep night, 2 Sep morning.
    expect(r).toEqual({ from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' });
  });

  it('a night shift crossing midnight: a range starting at night rolls the prior end back to the SAME day’s evening, not the next calendar day', () => {
    // Night belongs to the shift_date it STARTS on (shiftRange.ts's own file
    // header), so the shift immediately before a night shift is the SAME
    // day's evening shift, never a shift on the day the night shift's clock
    // time actually crosses into.
    const r = priorShiftRange({ from: '2026-09-02', fromShift: 'night', to: '2026-09-02', toShift: 'night' });
    expect(r).toEqual({ from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' });
  });

  it('a range that itself starts on a night shift and ends the following morning steps back across the day boundary correctly', () => {
    // night(1 Sep) + morning(2 Sep) = 2 shifts. The 2 shifts before night(1
    // Sep) are morning(1 Sep) and evening(1 Sep) — entirely within 1
    // September, never reaching into 31 August.
    const r = priorShiftRange({ from: '2026-09-01', fromShift: 'night', to: '2026-09-02', toShift: 'morning' });
    expect(r).toEqual({ from: '2026-09-01', fromShift: 'morning', to: '2026-09-01', toShift: 'evening' });
  });

  it('stepping back from the first shift of a month rolls over the CALENDAR month boundary correctly (pure Date arithmetic, no custom calendar)', () => {
    const r = priorShiftRange({ from: '2026-09-01', fromShift: 'morning', to: '2026-09-01', toShift: 'morning' });
    expect(r).toEqual({ from: '2026-08-31', fromShift: 'night', to: '2026-08-31', toShift: 'night' });
  });

  it('a full-day range (morning to night, 3 shifts) compares against the 3 shifts of the day before — equivalent to priorPeriod for a whole-day range', () => {
    const r = priorShiftRange({ from: '2026-09-05', fromShift: 'morning', to: '2026-09-05', toShift: 'night' });
    expect(r).toEqual({ from: '2026-09-04', fromShift: 'morning', to: '2026-09-04', toShift: 'night' });
  });
});

/* --------------------------------------------------- getManagementSummary */

const CURRENT_RESOLVED = { period: 'custom' as const, from: '2026-09-02', to: '2026-09-03' };
const SHIFT_RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-03', toShift: 'morning' };
const PRIOR_RANGE = priorShiftRange(SHIFT_RANGE); // { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' }

function fakeReport(cones: number): ReportData {
  return {
    period: CURRENT_RESOLVED,
    shift: null,
    coverage: { daysInPeriod: 2, daysWithData: 2, firstDayWithData: '2026-09-02', lastDayWithData: '2026-09-03', complete: true },
    totals: { group: 'total', cones, rejectedCones: 10, rejectRatePct: 1, conesInRangePct: 99, sacks: 10, sackWeightKg: 470, avgSackKg: 47, conesPerSack: 25 },
    byShift: [], byDay: [],
    downtime: { stoppageCount: 1, stoppedSeconds: 300, thresholdSeconds: 120 },
    readings: { states: { within: 900, low: 10, high: 5, rejected: 3, unknown: 82 }, implausible: 4 },
    shiftCheck: { compared: cones, mismatched: 5, mismatchPct: 0.5, topHour: 13 },
    generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
  };
}

const fakeWeights = () => ({
  basis: 'as_recorded' as const,
  cone: { count: 500, implausible: 2, avg: 1957.1, min: 1802, max: 2050, stdev: 12.3, unit: 'g' as const, bucketSize: 20, histogram: [], outliers: [] },
  sack: { count: 20, implausible: 0, avg: 47, min: 45, max: 49, stdev: 0.8, unit: 'kg' as const, bucketSize: 1, histogram: [], outliers: [] },
  note: '',
});

const fakeStations = () => ({
  from: CURRENT_RESOLVED.from, to: CURRENT_RESOLVED.to, days: 2, lineMeanG: 1957.1, targetG: 1960, productId: 21, productLabel: '205-IL0-SD',
  targetEffectiveFromUtc: '2026-08-20T00:00:00.000Z', limitsChangedInWindow: 0, productChangesInWindow: 0,
  thresholdG: 3, minDaysHeld: 3, lineRejectRatePct: 2, stations: [],
});

beforeEach(() => {
  vi.mocked(getReport).mockReset().mockImplementation(async (_p, _l, resolved) => fakeReport(resolved.from === CURRENT_RESOLVED.from ? 1000 : 800));
  vi.mocked(countEvents).mockReset().mockResolvedValue({
    count: 17,
    note: { generation: { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: null, simulator: false }, spansGenerations: false, otherGenerationExcluded: 0 },
    dataIssues: [],
  });
  vi.mocked(getProduction).mockReset().mockResolvedValue({ groupBy: 'product', rows: [], unattributed: null, states: null, implausible: null } as never);
  vi.mocked(getWeights).mockReset().mockResolvedValue(fakeWeights() as never);
  vi.mocked(getWeightStations).mockReset().mockResolvedValue(fakeStations() as never);
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue({ product: () => null, distinctLabel: (id: number) => `Product ${id}` } as never);
});

describe('getManagementSummary — shift-range wiring (Task TD, 29 Sep 2026)', () => {
  it('with no shiftRange, behaviour is unchanged: priorPeriod’s calendar-day rule, no shiftRange threaded anywhere', async () => {
    const d = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT_RESOLVED, {});
    expect(d.prior).toEqual({ from: '2026-08-31', to: '2026-09-01' }); // priorPeriod: 2 calendar days before
    for (const c of vi.mocked(getReport).mock.calls) expect(c[4]).toBeUndefined();
    for (const c of vi.mocked(getWeights).mock.calls) expect(c[5]).toBeUndefined();
    for (const c of vi.mocked(getProduction).mock.calls) expect(c[2].shiftRange).toBeUndefined();
    for (const c of vi.mocked(countEvents).mock.calls) expect(c[3].shiftRange).toBeUndefined();
  });

  it('with a shiftRange, the CURRENT period’s services receive it verbatim and the PRIOR period’s receive priorShiftRange of it', async () => {
    const d = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT_RESOLVED, {}, SHIFT_RANGE);

    // `prior` (the DayRange on the response) is the shift range's own
    // calendar span — 1 Sep to 2 Sep — never priorPeriod's 2-calendar-day
    // rule (which would have said 2026-08-31 to 2026-09-01, pinned above).
    expect(d.prior).toEqual({ from: PRIOR_RANGE.from, to: PRIOR_RANGE.to });

    const reportCalls = vi.mocked(getReport).mock.calls;
    const curReportCall = reportCalls.find((c) => c[2].from === CURRENT_RESOLVED.from)!;
    const priorReportCall = reportCalls.find((c) => c[2].from === PRIOR_RANGE.from)!;
    expect(curReportCall[4]).toEqual(SHIFT_RANGE);
    expect(priorReportCall[4]).toEqual(PRIOR_RANGE);

    const weightsCalls = vi.mocked(getWeights).mock.calls;
    const curWeightsCall = weightsCalls.find((c) => c[3] === CURRENT_RESOLVED.from)!;
    const priorWeightsCall = weightsCalls.find((c) => c[3] === PRIOR_RANGE.from)!;
    expect(curWeightsCall[5]).toEqual(SHIFT_RANGE);
    expect(priorWeightsCall[5]).toEqual(PRIOR_RANGE);

    const productionCalls = vi.mocked(getProduction).mock.calls;
    const curProdCall = productionCalls.find((c) => c[2].from === CURRENT_RESOLVED.from)!;
    const priorProdCall = productionCalls.find((c) => c[2].from === PRIOR_RANGE.from)!;
    expect(curProdCall[2].shiftRange).toEqual(SHIFT_RANGE);
    expect(priorProdCall[2].shiftRange).toEqual(PRIOR_RANGE);

    const countCalls = vi.mocked(countEvents).mock.calls;
    const curCountCall = countCalls.find((c) => c[3].from === CURRENT_RESOLVED.from)!;
    const priorCountCall = countCalls.find((c) => c[3].from === PRIOR_RANGE.from)!;
    expect(curCountCall[3].shiftRange).toEqual(SHIFT_RANGE);
    expect(priorCountCall[3].shiftRange).toEqual(PRIOR_RANGE);

    // getWeightStations deliberately stays UNNARROWED — the trailing
    // drift-detection window (station.ts/coneWeight.ts's own comments carry
    // the full reasoning: consecutive production days, not shifts).
    for (const c of vi.mocked(getWeightStations).mock.calls) expect(c.length).toBe(4);
  });

  it('KpiShape/comparability handling is untouched: equal coverage on both shift-range sides leaves every KPI comparable', async () => {
    const d = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT_RESOLVED, {}, SHIFT_RANGE);
    for (const k of d.kpis) {
      expect(k.comparable, k.key).toBe(true);
      expect(k.incomparableReason, k.key).toBeNull();
    }
    const cones = d.kpis.find((k) => k.key === 'cones_weighed')!;
    expect(cones).toMatchObject({ current: 1000, prior: 800 });
  });
});
