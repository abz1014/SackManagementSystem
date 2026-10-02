/**
 * C-007 (D-60): /api/weight-stations dropped the single-shift filter for the
 * period reject-rate figures. `getWeightStations`' period window now carries
 * an optional `shift`, and `rejectRatesByStation`'s three queries (combined
 * cone/reject count, line totals, unmatched rejects) all bind it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({ days: 5, stations: [{ station: 1, n: 220, grandMean: 1950, days: [] }] }),
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

function fakePool(...responses: unknown[][]): { pool: ConnectionPool; calls: { sql: string; params: Map<string, unknown> }[] } {
  const { pool, calls } = fakePositionalPool(ONE_REAL_GENERATION, responses);
  return { pool, calls };
}
const resp = () => [
  [{ st: 1, cones: 200, rejects: 10 }],
  [{ cones: 200, rejects: 10 }],
  [{ grp: '1', n: 2 }],
  [],
];

describe('getWeightStations — period single shift (C-007)', () => {
  it('binds @shift on all three reject-rate queries, not on the trailing material counts', async () => {
    const { pool, calls } = fakePool(...resp());
    await getWeightStations(pool, 1, '2026-08-20', '2026-09-02', undefined, { from: '2026-09-02', to: '2026-09-02', shift: 'night' });
    const joinCall = calls.find((c) => c.sql.includes('FULL OUTER JOIN'))!;
    expect(joinCall.sql).toContain('shift_code = @shift');
    expect(joinCall.params.get('shift')).toBe('night');
    const totalsCall = calls.find((c) => c.sql.includes('AS cones') && c.sql.includes('AS rejects'))!;
    expect(totalsCall.sql).toContain('shift_code = @shift');
    expect(totalsCall.params.get('shift')).toBe('night');
    const unmatchedCall = calls.find((c) => c.sql.includes('NOT EXISTS'))!;
    expect(unmatchedCall.sql).toContain('shift_code = @shift');
    expect(unmatchedCall.params.get('shift')).toBe('night');
  });

  it('absent shift: no query carries @shift', async () => {
    const { pool, calls } = fakePool(...resp());
    await getWeightStations(pool, 1, '2026-08-20', '2026-09-02', undefined, { from: '2026-09-02', to: '2026-09-02' });
    for (const c of calls) expect(c.params.has('shift')).toBe(false);
  });
});
