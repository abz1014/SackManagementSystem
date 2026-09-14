/**
 * "Days held" must count CALENDAR-consecutive days (SEPT-2026-EPOCH-DECISION §4.5).
 *
 * The station table walks the days-with-data array backwards. The record has a
 * hole (10 Jul → 5 Aug 2026, IFL's table rebuild), so array neighbours are not
 * calendar neighbours: a station heavy on 10 Jul and again on 26 Aug used to
 * report "heavier for 2 days". It has held that side for one day it can vouch
 * for, and the screen must say so.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const heavy = (date: string) => ({ date, n: 200, mean: 1968, nelson: [2] as number[] });
vi.mock('./calibration.js', () => ({
  getStationDrift: async () => ({
    days: 2,
    stations: [
      // Heavy on both days with data — 47 days apart.
      { station: 1, n: 400, grandMean: 1968, days: [heavy('2026-07-10'), heavy('2026-08-26')] },
      // The rest of the line, so the line mean sits well below station 1.
      { station: 2, n: 4000, grandMean: 1950, days: [] },
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

describe('getWeightStations — daysHeld across the record’s hole', () => {
  it('reports 1, not 2, for a station heavy on 2026-07-10 and on 2026-08-26', async () => {
    const data = await getWeightStations(fakePool([], [{ cones: 4400, rejects: 0 }]), 1, '2026-07-01', '2026-08-31');
    const s1 = data.stations.find((s) => s.station === 1)!;
    expect(s1.daysHeld).toBe(1);
  });
});
