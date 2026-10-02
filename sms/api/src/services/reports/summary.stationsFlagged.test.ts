/**
 * C-128 (D-77): `stations_flagged` was a measured-looking 0 for a period shorter
 * than the drift rule's minimum run (MIN_DAYS_HELD), which cannot flag anything.
 * It is now null for such a period (current and prior judged separately).
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
import { getManagementSummary } from './summary.js';

function fakeReport(cones: number, days: number): ReportData {
  return {
    period: { period: 'custom', from: '2026-09-01', to: '2026-09-02' },
    shift: null,
    coverage: { daysInPeriod: days, daysWithData: days, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-02', complete: true },
    totals: { group: 'total', cones, rejectedCones: 10, rejectRatePct: 1, conesInRangePct: 99, sacks: 10, sackWeightKg: 470, avgSackKg: 47, conesPerSack: 25 },
    byShift: [], byDay: [],
    downtime: { stoppageCount: 1, stoppedSeconds: 300, thresholdSeconds: 120 },
    readings: { states: { within: 900, low: 10, high: 5, rejected: 3, unknown: 82 }, implausible: 4 },
    shiftCheck: { compared: cones, mismatched: 5, mismatchPct: 0.5, topHour: 13 },
    generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
  };
}

beforeEach(() => {
  vi.mocked(getReport).mockReset().mockImplementation(async () => fakeReport(3098, 2));
  vi.mocked(countEvents).mockReset().mockResolvedValue({
    count: 17,
    note: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
    dataIssues: [],
  } as never);
  vi.mocked(getProduction).mockReset().mockResolvedValue({ groupBy: 'product', rows: [], unattributed: null, states: null, implausible: null } as never);
  vi.mocked(getWeights).mockReset().mockResolvedValue({
    basis: 'as_recorded',
    cone: { count: 500, implausible: 2, avg: 1957.1, min: 1802, max: 2050, stdev: 12.3, unit: 'g', bucketSize: 20, histogram: [], outliers: [] },
    sack: { count: 20, implausible: 0, avg: 47, min: 45, max: 49, stdev: 0.8, unit: 'kg', bucketSize: 1, histogram: [], outliers: [] },
    note: '',
  } as never);
  vi.mocked(getWeightStations).mockReset().mockResolvedValue({ days: 2, minDaysHeld: 3, stations: [{ station: 1, flagged: true }] } as never);
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue({ product: () => null, distinctLabel: (id: number) => `Product ${id}` } as never);
});

const pool = {} as unknown as ConnectionPool;
const flagged = (d: Awaited<ReturnType<typeof getManagementSummary>>) => d.kpis.find((k) => k.key === 'stations_flagged')!;

describe('stations_flagged on short periods (C-128)', () => {
  it('a 1-day period cannot flag a station: current and prior are null, not 0', async () => {
    const d = await getManagementSummary(pool, 1, { period: 'custom', from: '2026-08-19', to: '2026-08-19' }, {});
    expect(flagged(d).current).toBeNull();
    expect(flagged(d).prior).toBeNull();
  });

  it('a 2-day period is still too short', async () => {
    const d = await getManagementSummary(pool, 1, { period: 'custom', from: '2026-08-19', to: '2026-08-20' }, {});
    expect(flagged(d).current).toBeNull();
  });

  it('a 3-day period reports the real count', async () => {
    const d = await getManagementSummary(pool, 1, { period: 'custom', from: '2026-08-19', to: '2026-08-21' }, {});
    expect(flagged(d).current).toBe(1);
    expect(flagged(d).prior).toBe(1);
  });
});
