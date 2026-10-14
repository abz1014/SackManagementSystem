/**
 * /api/station-status under a shift (14 Oct 2026): `vsTargetG` used to be the
 * station's mean over the WHOLE production day while `cones` / `failedPct`
 * already respected the shift. `period.narrowPopulation` moves the mean, the
 * median and the material mix to the period's shift / shift range together.
 * The real getStationDrift runs here, against a SQL-dispatching fake whose
 * rows depend on the bound shift: morning 1950 g, evening 1962 g.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakeGenerationPool, ONE_REAL_GENERATION } from '../testkit/generations.js';

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
vi.mock('./ruleAsOf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ruleAsOf.js')>()),
  getPlausibilityRuleAsOf: async () => ({
    rule: { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 },
    ruleChangedInPeriod: false,
    versionCount: 1,
  }),
}));
const P7 = { productId: 7, label: 'P7', effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' };
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({
    entries: [{ ...P7, setpointG: null, weightOffsetMinusG: null, weightOffsetPlusG: null }],
    at: (ms: number) => (ms >= P7.effectiveFromMs ? P7 : null),
    isEmpty: false,
  }),
  limitsOf: () => null,
}));
const V7 = { setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: P7.effectiveFromMs, effectiveFromUtc: P7.effectiveFromUtc, effectiveIsLowerBound: false };
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    distinctLabel: () => 'P7',
    product: () => ({ productId: 7, label: 'P7', activeFlag: true }),
    versionAt: () => V7,
    limitsAt: () => ({ targetG: 1950, loG: 1910, hiG: 1990, label: '1950 g' }),
    versionsAscending: () => [V7],
    productIds: () => [7],
    latest: () => null,
    isEmpty: false,
  }),
  limitsFromVersion: () => null,
}));

const { getWeightStations } = await import('./weightStations.js');

const MEAN: Record<string, number> = { morning: 1950, evening: 1962 };
/** Whole day = 100 morning cones + 50 evening cones. */
const DAY_MEAN = (100 * 1950 + 50 * 1962) / 150;

function pool(): { pool: ConnectionPool; sql: { text: string; params: Map<string, unknown> }[] } {
  const g = fakeGenerationPool(ONE_REAL_GENERATION);
  const sql: { text: string; params: Map<string, unknown> }[] = [];
  const inner = g.pool;
  const wrapped = {
    request: () => {
      const req = inner.request();
      const params = new Map<string, unknown>();
      const input = req.input.bind(req);
      (req as unknown as { input: unknown }).input = (n: string, t: unknown, v: unknown) => {
        params.set(n, v);
        return input(n, t as never, v);
      };
      const query = req.query.bind(req);
      (req as unknown as { query: unknown }).query = async (text: string) => {
        sql.push({ text, params });
        const shift = params.get('popShift') as string | undefined;
        const n = shift ? (shift === 'morning' ? 100 : 50) : 150;
        const mean = shift ? MEAN[shift]! : DAY_MEAN;
        if (text.includes('GROUP BY source_station, shift_date')) {
          return { recordset: [{ st: 1, d: new Date('2026-09-01T00:00:00Z'), n, mean, sd: 3 }] };
        }
        if (text.includes('PERCENTILE_CONT')) return { recordset: [{ st: 1, med: mean }] };
        if (text.includes('GROUP BY source_station, material_id')) return { recordset: [{ st: 1, mat: 7, n }] };
        if (text.includes('AS cones') && text.includes('AS rejects')) return { recordset: [{ cones: n, rejects: 0 }] };
        return query(text as never);
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool: wrapped, sql };
}

const POP = ['GROUP BY source_station, shift_date', 'PERCENTILE_CONT', 'GROUP BY source_station, material_id'];
const run = (period: Parameters<typeof getWeightStations>[5]) => {
  const p = pool();
  return getWeightStations(p.pool, 1, '2026-09-01', '2026-09-01', undefined, period).then((d) => ({ d, sql: p.sql }));
};

describe('getWeightStations narrowPopulation', () => {
  it('evening request returns the EVENING offset, not the whole-day one', async () => {
    const { d, sql } = await run({ from: '2026-09-01', to: '2026-09-01', shift: 'evening', narrowPopulation: true });
    const s = d.stations[0]!;
    expect(s.meanG).toBe(1962);
    expect(s.vsTargetG).toBe(12);
    expect(s.targetBasis).toBe('station_material');
    for (const q of sql.filter((x) => POP.some((m) => x.text.includes(m)))) {
      expect(q.params.get('popShift')).toBe('evening');
    }
  });

  it('morning request returns the morning offset', async () => {
    const { d } = await run({ from: '2026-09-01', to: '2026-09-01', shift: 'morning', narrowPopulation: true });
    expect(d.stations[0]!.vsTargetG).toBe(0);
  });

  it('a shift range binds the range clause on the mean and the material mix', async () => {
    const { sql } = await run({
      from: '2026-09-01', to: '2026-09-01', narrowPopulation: true,
      shiftRange: { from: '2026-09-01', fromShift: 'morning', to: '2026-09-01', toShift: 'evening' },
    });
    for (const q of sql.filter((x) => POP.some((m) => x.text.includes(m)))) {
      expect(q.text).toContain('@srFrom');
    }
  });

  it('without the opt-in nothing changes: whole-day mean even when a shift is given', async () => {
    const { d, sql } = await run({ from: '2026-09-01', to: '2026-09-01', shift: 'evening' });
    expect(d.stations[0]!.meanG).toBe(Math.round(DAY_MEAN * 100) / 100);
    expect(sql.some((q) => q.params.has('popShift'))).toBe(false);
  });
});
