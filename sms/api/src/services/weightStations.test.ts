/**
 * Regression test for finding H2 (Sep 2026 audit): the LINE-level reject rate
 * used to average the stations' own percentages (mean of ratios) rather than
 * volume-weight them, which treats a station handling 200 cones/day the same
 * as one handling 20,000. Real-data magnitude at the time: 2.03% shown vs
 * 2.16% correct.
 *
 * This drives the real `getWeightStations` and asserts on the real
 * `lineRejectRatePct` it returns, because the first version of this test only
 * recomputed the arithmetic in the test body — which passed just as happily
 * against the mean-of-ratios code it was supposed to be pinning.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

// The dependencies getWeightStations pulls in are all DB-backed; stub them so
// the test exercises the rate arithmetic and nothing else.
vi.mock('./calibration.js', () => ({
  getStationDrift: async () => ({
    days: 5,
    stations: [
      { station: 1, n: 220, grandMean: 1950, days: [] },
      { station: 2, n: 1818, grandMean: 1952, days: [] },
    ],
  }),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({ entries: [], at: () => null, isEmpty: true }),
  limitsOf: () => null,
}));
// The versioned-limits catalogue is DB-backed too; an empty one keeps the
// target null, exactly as the empty timeline above does.
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: () => null,
    versionAt: () => null,
    limitsAt: () => null,
    latest: () => null,
    productIds: () => [],
    versionsAscending: () => [],
    isEmpty: true,
  }),
  limitsFromVersion: () => null,
}));

const { getWeightStations } = await import('./weightStations.js');

/**
 * Serves getWeightStations' own queries in order: first the per-station
 * reject counts, then the LINE totals. Two result sets, because the line
 * total is deliberately counted without the `source_station IS NOT NULL`
 * filter the per-station query needs.
 */
function fakePool(...responses: unknown[][]): ConnectionPool {
  let i = 0;
  const req = {
    input: () => req,
    query: async () => ({ recordset: responses[i++] ?? [] }),
  };
  return { request: () => req } as unknown as ConnectionPool;
}

describe('getWeightStations — line reject rate (finding H2)', () => {
  it('volume-weights the line rate instead of averaging the stations’ percentages', async () => {
    // Station 1: small volume, high rate (20/220 ≈ 9.09%).
    // Station 2: large volume, low rate (18/1818 ≈ 0.99%).
    // Volume-weighted truth: 38 / 2038 ≈ 1.86%.
    // Mean of ratios (the bug): (9.09 + 0.99) / 2 ≈ 5.04% — nearly 3x too high.
    // The line totals deliberately exceed the per-station sums: 50 cones and
    // 2 rejects carry no station id. Those exist in reality — the transform
    // raises a `no_station` DQ finding for them — and the Rejects screen
    // counts them, so this screen must too or the two disagree.
    const pool = fakePool(
      [
        { st: 1, cones: 200, rejects: 20 },
        { st: 2, cones: 1800, rejects: 18 },
      ],
      [{ cones: 2050, rejects: 40 }],
    );

    const data = await getWeightStations(pool, 1, '2026-07-01', '2026-07-19');

    // 40 / (2050 + 40) — the whole line, station or not.
    expect(data.lineRejectRatePct).toBeCloseTo((100 * 40) / 2090, 2);
    // Summing only the stations would give 38/2038 and silently drop the
    // station-less rows.
    expect(data.lineRejectRatePct).not.toBeCloseTo((100 * 38) / 2038, 3);
    // And a mean of the per-station rates would land near 5.04.
    expect(data.lineRejectRatePct!).toBeLessThan(3);

    // The per-station rates themselves were always right; keep them pinned so
    // a future "fix" to the line rate cannot quietly change these instead.
    const s1 = data.stations.find((s) => s.station === 1)!;
    const s2 = data.stations.find((s) => s.station === 2)!;
    expect(s1.rejectRatePct).toBeCloseTo((100 * 20) / 220, 2);
    expect(s2.rejectRatePct).toBeCloseTo((100 * 18) / 1818, 2);
  });
});
