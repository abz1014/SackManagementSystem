/**
 * C-127 (D-76): the summary CSV/XLSX `period` and `prior_period` columns used to
 * state calendar days even for a shift-bounded report, so a prior of "31 Aug
 * evening shift – 1 Sep morning shift" read as "2026-08-31 to 2026-09-01" (two
 * whole days). They now carry the same plain-words shift range the trailing
 * `period` attribution row uses; a plain-day report keeps its calendar text.
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
import { getManagementSummary, summaryCsv } from './summary.js';

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
  vi.mocked(getWeightStations).mockReset().mockResolvedValue({ days: 2, minDaysHeld: 3, stations: [] } as never);
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue({ product: () => null, distinctLabel: (id: number) => `Product ${id}` } as never);
});

const pool = {} as unknown as ConnectionPool;

describe('summaryCsv — period columns (C-127)', () => {
  it('a shift-range report names the shifts in both period columns', async () => {
    const range: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' };
    const d = await getManagementSummary(pool, 1, { period: 'custom', from: '2026-09-01', to: '2026-09-02' }, {}, range);
    const t = summaryCsv(d);
    const iP = t.headers.indexOf('period');
    const iPP = t.headers.indexOf('prior_period');
    const row = t.rows.find((r) => r[0] === 'cones_weighed')!;
    expect(String(row[iP])).toContain('1 Sep evening shift');
    expect(String(row[iPP])).toContain('31 Aug evening shift');
  });

  it('a plain-day report keeps the calendar-day text', async () => {
    const d = await getManagementSummary(pool, 1, { period: 'custom', from: '2026-08-19', to: '2026-08-19' }, {});
    const t = summaryCsv(d);
    const row = t.rows.find((r) => r[0] === 'cones_weighed')!;
    expect(row[t.headers.indexOf('period')]).toBe('2026-08-19 to 2026-08-19');
    expect(row[t.headers.indexOf('prior_period')]).toBe('2026-08-18 to 2026-08-18');
  });
});
