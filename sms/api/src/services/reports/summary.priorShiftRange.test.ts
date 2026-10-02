/**
 * C-167 (D-102, 2 Oct 2026): for a shift-bounded range the management summary's
 * prior period is a SHIFT range, but `prior` carried only its calendar days, so
 * the caption named two dates for what is "31 Aug evening to 1 Sep morning".
 * `prior` now also carries `fromShift`/`toShift` (`YYYY-MM-DD.shift`, the URL
 * encoding) when the report is shift-bounded, and only then.
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

const NOTE = { generation: null, spansGenerations: false, otherGenerationExcluded: 0 };
const report = (): ReportData => ({
  period: { period: 'custom', from: '2026-09-01', to: '2026-09-02' }, shift: null,
  coverage: { daysInPeriod: 2, daysWithData: 2, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-02', complete: true },
  totals: { group: 'total', cones: 100, rejectedCones: 1, rejectRatePct: 1, conesInRangePct: 99, sacks: 4, sackWeightKg: 190, avgSackKg: 47.5, conesPerSack: 25 },
  byShift: [], byDay: [], downtime: null, readings: null, shiftCheck: null, generationNote: NOTE,
});

beforeEach(() => {
  vi.mocked(getReport).mockReset().mockResolvedValue(report());
  vi.mocked(countEvents).mockReset().mockResolvedValue({ count: 1, note: NOTE, dataIssues: [] } as never);
  vi.mocked(getProduction).mockReset().mockResolvedValue({ groupBy: 'product', rows: [], unattributed: null, states: null, implausible: null } as never);
  vi.mocked(getWeights).mockReset().mockResolvedValue({ cone: { avg: 1957, stdev: 10, implausible: 0 } } as never);
  vi.mocked(getWeightStations).mockReset().mockResolvedValue({ stations: [] } as never);
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue({ product: () => null, distinctLabel: (id: number) => `Product ${id}` } as never);
});

describe('getManagementSummary — the prior period names its shifts', () => {
  const pool = {} as unknown as ConnectionPool;
  const resolved = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-02' };
  // P09-shaped: 1 Sep evening to 2 Sep morning (3 shifts); the 3 shifts before are 31 Aug evening to 1 Sep morning.
  const range: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' };

  it('a shift-bounded range gives prior.fromShift / prior.toShift from priorShiftRange', async () => {
    const p = priorShiftRange(range);
    const d = await getManagementSummary(pool, 1, resolved, {}, range);
    expect(d.prior.fromShift).toBe(`${p.from}.${p.fromShift}`);
    expect(d.prior.toShift).toBe(`${p.to}.${p.toShift}`);
    expect(d.prior.fromShift).toBe('2026-08-31.evening');
    expect(d.prior.toShift).toBe('2026-09-01.morning');
    expect(d.prior.from).toBe('2026-08-31');
    expect(d.prior.to).toBe('2026-09-01');
  });

  it('a plain-day report carries no shift refs on prior', async () => {
    const d = await getManagementSummary(pool, 1, resolved, {});
    expect(d.prior).toEqual({ from: '2026-08-30', to: '2026-08-31' });
  });
});
