/**
 * Roadmap Phase 9 (15 Sep 2026): the station table renders the per-station
 * SD (computed all along, dropped on the way out) and the median, carries the
 * rule table, and projects a FLAGGED station's run to the product's limit.
 * Same partial-mock shape as weightStations.test.ts: the drift and the
 * ledger are stubbed, the pure helpers are real.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';

const day = (date: string, mean: number, nelson: number[] = []) => ({ date, n: 600, mean, nelson });

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({
    days: 6,
    rules: (await import('./nelson.js')).nelsonRuleTable(),
    stations: [
      // Station 7 climbs 2 g/day, 12 g above the line, the pattern test having fired.
      {
        station: 7, n: 3600, grandMean: 1972, medianG: 1971.5, stdevWithin: 7.25, sigmaDayToDay: 1.1,
        centrelineG: 1972, restartedOn: null, longestRun: 6,
        days: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'].map((d, i) => day(d, 1967 + 2 * i, i >= 3 ? [3] : [])),
        flagged: true,
      },
      // The rest of the line, flat at 1960.
      { station: 1, n: 36000, grandMean: 1960, medianG: 1960, stdevWithin: 8.5, sigmaDayToDay: 0.9, centrelineG: 1960, restartedOn: null, longestRun: 6, days: [], flagged: false },
    ],
  }),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
// A product in force with 1960 ± 40 g, from the versioned catalogue.
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({ entries: [{ productId: 21 }], at: () => ({ productId: 21, label: 'PES 150/48' }), isEmpty: false }),
  limitsOf: () => ({ targetG: 1960, loG: 1920, hiG: 2000 }),
}));
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: () => null,
    versionAt: () => null,
    limitsAt: () => ({ targetG: 1960, loG: 1920, hiG: 2000 }),
    latest: () => null,
    productIds: () => [21],
    versionsAscending: () => [],
    isEmpty: false,
  }),
  limitsFromVersion: () => null,
}));

const { getWeightStations } = await import('./weightStations.js');
const { nelsonRuleTable } = await import('./nelson.js');

// WS-A1 (23 Sep 2026): wraps testkit's fakePositionalPool so every existing
// varargs call site (`fakePool([], [...], ...)`) is untouched — the two
// scope queries `resolveGenerationScope` now issues inside
// rejectRatesByStation/stationMaterialCounts are answered transparently from
// ONE_REAL_GENERATION and consume no response slot. See
// testkit/generations.ts's own header for why this beats a rewrite.
function fakePool(...responses: unknown[][]): ConnectionPool {
  return fakePositionalPool(ONE_REAL_GENERATION, responses).pool;
}

describe('getWeightStations — Phase 9 columns and the projection', () => {
  it('renders SD and median per station, and serves the rule table', async () => {
    const data = await getWeightStations(fakePool([], [{ cones: 39600, rejects: 0 }]), 1, '2026-09-01', '2026-09-06');
    const s7 = data.stations.find((s) => s.station === 7)!;
    expect(s7.sdG).toBe(7.25);
    expect(s7.medianG).toBe(1971.5);
    expect(s7.longestRun).toBe(6);
    expect(data.rules).toEqual(nelsonRuleTable());
    expect(data.rules.length).toBe(8);
    expect(data.limits).toEqual({ loG: 1920, hiG: 2000 });
  });

  it('projects a flagged station’s run to the limit in its direction, with the target for the sentence', async () => {
    const data = await getWeightStations(fakePool([], [{ cones: 39600, rejects: 0 }]), 1, '2026-09-01', '2026-09-06');
    const s7 = data.stations.find((s) => s.station === 7)!;
    expect(s7.flagged).toBe(true);
    expect(s7.projection).not.toBeNull();
    // 2 g/day over the six-day run; last mean 1977, limit 2000 -> 23 g -> about 12 days.
    expect(s7.projection).toMatchObject({ slopeGPerDay: 2, overDays: 6, towards: 'upper', limitG: 2000, targetG: 1960, daysToLimit: 12, assumption: 'linear_over_run' });
  });

  it('does not project a station that is not flagged', async () => {
    const data = await getWeightStations(fakePool([], [{ cones: 39600, rejects: 0 }]), 1, '2026-09-01', '2026-09-06');
    expect(data.stations.find((s) => s.station === 1)!.projection).toBeNull();
  });
});
