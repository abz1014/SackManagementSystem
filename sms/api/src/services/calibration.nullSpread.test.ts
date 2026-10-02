/**
 * C-157 / D-87 (2 Oct 2026): a spread that cannot be computed was stored and
 * printed as 0. The sample standard deviation of ONE value is undefined, and
 * so is a day-to-day sigma over fewer than two days; "SD 0.0 g" says the
 * readings were identical, which is a claim the data cannot support (Weight,
 * P13 2026-07-20..25: "Station 7 1,950 g, SD 0.0 g", from the one stray
 * 12 Jul cone).
 *
 * `getStationDrift` now returns null for `stdevWithin` when no day holds two
 * or more readings, and for `sigmaDayToDay` when the newest epoch has fewer
 * than two days; `getWeightStations` carries both through as null.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';

vi.mock('./productAt.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./productAt.js')>()),
  loadProductTimeline: async () => ({ entries: [], at: () => null, isEmpty: true }),
}));
vi.mock('./productLimits.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./productLimits.js')>()),
  loadProductCatalogue: async () => ({
    product: () => null,
    versionAt: () => null,
    limitsAt: () => null,
    latest: () => null,
    productIds: () => [],
    versionsAscending: () => [],
    isEmpty: true,
  }),
}));

const { getStationDrift } = await import('./calibration.js');
const { getWeightStations } = await import('./weightStations.js');

const RULE = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };
const day = (d: string) => new Date(`${d}T00:00:00Z`);

// Station 7: ONE day, ONE reading. Station 8: two days, one reading each.
// Station 9: two days of 30 readings with a real within-day sd.
const ROWS = [
  { st: 7, d: day('2026-07-20'), n: 1, mean: 1950, sd: null },
  { st: 8, d: day('2026-07-20'), n: 1, mean: 1950, sd: null },
  { st: 8, d: day('2026-07-21'), n: 1, mean: 1954, sd: null },
  { st: 9, d: day('2026-07-20'), n: 30, mean: 1950, sd: 5 },
  { st: 9, d: day('2026-07-21'), n: 30, mean: 1954, sd: 5 },
];

function pool(): ConnectionPool {
  const inner = fakePositionalPool(ONE_REAL_GENERATION, []).pool;
  return {
    request: () => {
      const innerReq = inner.request();
      const req = {
        input: (n: string, t: unknown, v: unknown) => {
          (innerReq as unknown as { input: (...a: unknown[]) => unknown }).input(n, t, v);
          return req;
        },
        query: async (sql: string) => {
          if (sql.includes('PERCENTILE_CONT')) return { recordset: [{ st: 7, med: 1950 }, { st: 8, med: 1952 }, { st: 9, med: 1952 }] };
          if (sql.includes('GROUP BY source_station, shift_date')) return { recordset: ROWS };
          return innerReq.query(sql);
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('getStationDrift — an undefined spread is null, not 0', () => {
  it('one reading on one day: no within-day sd and no day-to-day sigma', async () => {
    const cal = await getStationDrift(pool(), 1, '2026-07-12', '2026-07-25', RULE);
    const st = cal.stations.find((s) => s.station === 7)!;
    expect(st.stdevWithin).toBeNull();
    expect(st.sigmaDayToDay).toBeNull();
  });

  it('two days of one reading each: day-to-day sigma exists, within-day sd still does not', async () => {
    const cal = await getStationDrift(pool(), 1, '2026-07-12', '2026-07-25', RULE);
    const st = cal.stations.find((s) => s.station === 8)!;
    expect(st.stdevWithin).toBeNull();
    expect(st.sigmaDayToDay).toBeCloseTo(3.546, 2); // |1954-1950| / 1.128
  });

  it('a station with real replicates keeps both numbers', async () => {
    const cal = await getStationDrift(pool(), 1, '2026-07-12', '2026-07-25', RULE);
    const st = cal.stations.find((s) => s.station === 9)!;
    expect(st.stdevWithin).toBe(5);
    expect(st.sigmaDayToDay).toBeGreaterThan(0);
  });
});

describe('getWeightStations — the station table carries the null through', () => {
  it('sdG and sigmaDayToDay are null for the one-reading station, never 0', async () => {
    const data = await getWeightStations(pool(), 1, '2026-07-12', '2026-07-25');
    const s7 = data.stations.find((s) => s.station === 7)!;
    expect(s7.sdG).toBeNull();
    expect(s7.sigmaDayToDay).toBeNull();
    expect(data.stations.find((s) => s.station === 9)!.sdG).toBe(5);
  });
});
