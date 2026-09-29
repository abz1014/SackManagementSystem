/**
 * Chart overhaul wave 2 (Task TB1, 28 Sep 2026; follow-up after coordinator
 * review). `getWeightStations` takes TWO windows: `from`/`to` (the TRAILING
 * drift window the station pattern rules need whole, consecutive production
 * days for — unchanged, no `shiftRange`) and the new optional `period`
 * parameter (the reject-rate figures behind the Weight screen's station
 * table and the station report — `rejectRatesByStation`'s own window, which
 * carries no cross-column population contract and IS safe to narrow).
 *
 * Three cases, exactly as asked:
 *  1. `period` absent — every query is byte-identical to before this task
 *     (no `srFrom` anywhere).
 *  2. `period` present with a `shiftRange` that differs from the trailing
 *     window — `rejectRatesByStation`'s three queries (the combined cone/
 *     reject count, the line totals, and the unmatched-rejects count) all
 *     carry the clause and its four params, bound to the PERIOD's dates.
 *  3. Even with that same `period.shiftRange` given, `stationMaterialCounts`
 *     — which stays on the TRAILING window because `vsTargetG`/`targetBasis`
 *     must share `meanG`'s own population (F4/F6) — carries NO `srFrom` at
 *     all. This is the "absent on the trailing part" case.
 *
 * `getStationDrift` (the drift/pattern half) is stubbed exactly as
 * `weightStations.test.ts` and its siblings already do, since it never
 * touches the real pool in any of these tests and its own file
 * (`calibration.ts`) is asserted separately to take no `shiftRange` at all.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';
import type { ShiftRange } from '../shiftRange.js';

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({
    days: 5,
    stations: [{ station: 1, n: 220, grandMean: 1950, days: [] }],
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

// Query order (scope-resolve queries are absorbed and excluded from `calls`
// by `fakePositionalPool` — see its own doc comment): [0] rejectRatesByStation's
// combined cone/reject FULL OUTER JOIN, [1] its line totals, [2] its
// unmatched-rejects count (getUnmatchedRejects), [3] stationMaterialCounts.
function fakePool(...responses: unknown[][]): { pool: ConnectionPool; calls: { sql: string; params: Map<string, unknown> }[] } {
  const { pool, calls } = fakePositionalPool(ONE_REAL_GENERATION, responses);
  return { pool, calls };
}

const TRAILING = { from: '2026-08-25', to: '2026-09-07' };
const RANGE: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-05', toShift: 'morning' };

describe('getWeightStations — period shiftRange (Task TB1, coordinator follow-up)', () => {
  it('absent (no `period` argument at all): no query carries srFrom', async () => {
    const { pool, calls } = fakePool(
      [{ st: 1, cones: 200, rejects: 10 }],
      [{ cones: 200, rejects: 10 }],
      [{ grp: '1', n: 2 }],
      [],
    );
    await getWeightStations(pool, 1, TRAILING.from, TRAILING.to);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.sql).not.toContain('srFrom');
      expect(c.params.has('srFrom')).toBe(false);
    }
  });

  it('present on the PERIOD part: rejectRatesByStation\'s three queries all carry the clause, bound to the period\'s own dates', async () => {
    const { pool, calls } = fakePool(
      [{ st: 1, cones: 200, rejects: 10 }],
      [{ cones: 200, rejects: 10 }],
      [{ grp: '1', n: 2 }],
      [],
    );
    await getWeightStations(pool, 1, TRAILING.from, TRAILING.to, undefined, {
      from: '2026-09-01',
      to: '2026-09-07',
      shiftRange: RANGE,
    });

    const joinCall = calls.find((c) => c.sql.includes('FULL OUTER JOIN'))!;
    expect(joinCall.sql).toContain('shift_date');
    expect(joinCall.sql).toContain('@srFrom');
    expect(joinCall.params.get('srFrom')).toBe('2026-09-01');
    expect(joinCall.params.get('srTo')).toBe('2026-09-05');
    expect(joinCall.params.get('srFromOrd')).toBe(2); // evening
    expect(joinCall.params.get('srToOrd')).toBe(1); // morning

    const totalsCall = calls.find((c) => c.sql.includes('AS cones') && c.sql.includes('AS rejects'))!;
    expect(totalsCall.sql).toContain('@srFrom');
    expect(totalsCall.params.get('srFrom')).toBe('2026-09-01');

    const unmatchedCall = calls.find((c) => c.sql.includes('NOT EXISTS'))!;
    expect(unmatchedCall.sql).toContain('re.shift_date');
    expect(unmatchedCall.sql).toContain('@srFrom');
  });

  it('absent on the TRAILING part: stationMaterialCounts never carries srFrom, even with a period.shiftRange given', async () => {
    const { pool, calls } = fakePool(
      [{ st: 1, cones: 200, rejects: 10 }],
      [{ cones: 200, rejects: 10 }],
      [{ grp: '1', n: 2 }],
      [{ st: 1, mat: 21, n: 200 }],
    );
    await getWeightStations(pool, 1, TRAILING.from, TRAILING.to, undefined, {
      from: '2026-09-01',
      to: '2026-09-07',
      shiftRange: RANGE,
    });

    const materialCall = calls.find((c) => c.sql.includes('material_id mat'))!;
    expect(materialCall.sql).not.toContain('srFrom');
    expect(materialCall.params.has('srFrom')).toBe(false);
    // And it is bound to the TRAILING dates, not the period's.
    expect(materialCall.params.get('from')).toBe(TRAILING.from);
    expect(materialCall.params.get('to')).toBe(TRAILING.to);
  });

  it('period.from/to equal to the trailing window, no shiftRange: periodIsTrailing holds and behaviour matches the no-period case', async () => {
    const { pool: poolA, calls: callsA } = fakePool(
      [{ st: 1, cones: 200, rejects: 10 }],
      [{ cones: 200, rejects: 10 }],
      [{ grp: '1', n: 2 }],
      [],
    );
    await getWeightStations(poolA, 1, TRAILING.from, TRAILING.to, undefined, { from: TRAILING.from, to: TRAILING.to });
    for (const c of callsA) expect(c.params.has('srFrom')).toBe(false);
  });
});
