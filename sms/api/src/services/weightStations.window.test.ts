/**
 * T3 (15 Sep 2026) — an adjustment logged AFTER the reporting window used to
 * erase that window's drift history.
 *
 * weightStations.ts:116 called listCalibrationAdjustments(pool, lineId) with
 * NO window filter, so `TOP (500) ORDER BY adjusted_at_utc DESC` returned the
 * newest 500 adjustments on the LINE, whatever period was being reported.
 * `latestRestart` then took the newest of those as every relevant station's
 * restart marker, and the days filter a few lines below it (weightStations.ts
 * ~156) dropped every day of the window that fell before it. A September
 * adjustment made an August report read "0 days held" for all fourteen
 * stations — the exact case this file pins.
 *
 * The fix bounds the ledger fetch to `{ to }` and never `from`: an adjustment
 * before the window is still the correct restart marker (that is the ledger's
 * whole purpose), only one logged after `to` must not exist as far as this
 * window is concerned.
 *
 * calibration.phase9.test.ts already pins listCalibrationAdjustments' own
 * SQL WHERE clause on the plant-clock day boundary; this file does not
 * re-test that. It mocks listCalibrationAdjustments directly (as a `vi.fn`
 * that also records its call, so the `to` bound reaching it can be asserted)
 * and pins that weightStations.ts trusts whatever the (correctly filtered)
 * ledger returns rather than filtering client-side.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const FROM = '2026-08-01';
const TO = '2026-08-14';

// Fourteen consecutive August days, all on the same (heavy) side of the line
// mean and all pattern-flagged, so an unfiltered run is exactly 14 days held.
const day = (date: string) => ({ date, n: 100, mean: 1970, nelson: [2] as number[] });
const augustDays = Array.from({ length: 14 }, (_, i) => day(`2026-08-${String(i + 1).padStart(2, '0')}`));

const listCalibrationAdjustments = vi.fn();

// Partial mock (roadmap Phase 9, 15 Sep 2026): the pure helpers the table
// calls (adjustmentRestarts, latestRestart, projectDaysToLimit) are the real
// ones — the restart truncation this file is pinning happens through them —
// only the two DB-backed functions are stubbed.
vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({
    days: 14,
    stations: [
      { station: 1, n: 1400, grandMean: 1970, days: augustDays },
      // The rest of the line, unaffected, so the line mean sits below station 1.
      { station: 2, n: 4000, grandMean: 1950, days: [] },
    ],
  }),
  listCalibrationAdjustments,
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({ entries: [], at: () => null, isEmpty: true }),
  limitsOf: () => null,
}));
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: () => null, versionAt: () => null, limitsAt: () => null, latest: () => null,
    productIds: () => [], versionsAscending: () => [], isEmpty: true,
  }),
  limitsFromVersion: () => null,
}));

const { getWeightStations } = await import('./weightStations.js');

function fakePool(...responses: unknown[][]): ConnectionPool {
  let i = 0;
  const req = { input: () => req, query: async () => ({ recordset: responses[i++] ?? [] }) };
  return { request: () => req } as unknown as ConnectionPool;
}

const noRejects = () => fakePool([], [{ cones: 1400, rejects: 0 }]);

describe('getWeightStations — the ledger fetch is bounded by `to` (T3)', () => {
  it('passes { to } — the window end, never `from` — to listCalibrationAdjustments', async () => {
    listCalibrationAdjustments.mockReset().mockResolvedValueOnce([]);

    await getWeightStations(noRejects(), 1, FROM, TO);

    expect(listCalibrationAdjustments).toHaveBeenCalledTimes(1);
    const [, lineId, filter] = listCalibrationAdjustments.mock.calls[0]!;
    expect(lineId).toBe(1);
    expect(filter).toEqual({ to: TO });
    expect(filter).not.toHaveProperty('from');
  });

  it('keeps all fourteen August days when the only logged adjustment is a September one the (correctly filtered) ledger excludes', async () => {
    // A real listCalibrationAdjustments call bound to { to: '2026-08-14' }
    // would never hand back a September row — this fixture is what that
    // correct filtering returns for this window.
    listCalibrationAdjustments.mockReset().mockResolvedValueOnce([]);

    const data = await getWeightStations(noRejects(), 1, FROM, TO);

    const s1 = data.stations.find((s) => s.station === 1)!;
    expect(s1.daysHeld).toBe(14);
    expect(s1.flagged).toBe(true);
  });

  it('truncates the run at an adjustment logged INSIDE the window', async () => {
    listCalibrationAdjustments.mockReset().mockResolvedValueOnce([
      {
        adjustmentId: 1,
        stationId: 1,
        // Midday UTC so the ±5h plant offset (CLAUDE.md, "two clocks") can
        // never push this across a day boundary either direction.
        adjustedAtUtc: '2026-08-10T12:00:00.000Z',
        adjustedAtPlant: '2026-08-10T17:00:00.000Z',
        recordedAtUtc: '2026-08-10T12:00:00.000Z',
        recordedBy: null,
        reason: 'recalibrated',
        note: null,
        amountG: 5,
        beforeG: null,
        afterG: null,
        referenceG: null,
        productId: null,
        productLabel: null,
      },
    ]);

    const data = await getWeightStations(noRejects(), 1, FROM, TO);

    const s1 = data.stations.find((s) => s.station === 1)!;
    // Restarted on 2026-08-10: only 08-10..08-14 (5 days) belong to the new
    // scale; 08-01..08-09 belong to the one before the adjustment.
    expect(s1.daysHeld).toBe(5);
    expect(s1.flagged).toBe(true);
  });
});
