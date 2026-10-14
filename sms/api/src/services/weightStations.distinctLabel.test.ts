/**
 * Station tiles name each winder's product with the DISTINCT label the Products Board prints: materials that
 * share one PDAS description (six on this line share "205-IL0-SD") must not all read the same.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';

const FROM = '2026-08-01';
const TO = '2026-08-14';

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({
    days: 14,
    stations: [
      // Station 1: ran ONE material (21, RETIRED) in the window.
      { station: 2, n: 100, grandMean: 1958, medianG: 1958, stdevWithin: 5, sigmaDayToDay: 0, centrelineG: 1958, restartedOn: null, longestRun: 0, days: [] },
      { station: 4, n: 100, grandMean: 1958, medianG: 1958, stdevWithin: 5, sigmaDayToDay: 0, centrelineG: 1958, restartedOn: null, longestRun: 0, days: [] },
      { station: 1, n: 100, grandMean: 1958, medianG: 1958, stdevWithin: 5, sigmaDayToDay: 0, centrelineG: 1958, restartedOn: null, longestRun: 0, days: [] },
      // Station 3: no material_id at all — falls back to the line-wide
      // Current Product, which is ALSO retired here (product 30).
      { station: 3, n: 100, grandMean: 1945, medianG: 1945, stdevWithin: 5, sigmaDayToDay: 0, centrelineG: 1945, restartedOn: null, longestRun: 0, days: [] },
    ],
  }),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
// C-018 (2 Oct 2026): the service now reads the rule as of the window's end
// through ruleAsOf.js; stubbed to the same fixed rule so this positional
// fake pool is not asked an extra (slot-consuming) plausibility query.
vi.mock('./ruleAsOf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ruleAsOf.js')>()),
  getPlausibilityRuleAsOf: async () => ({
    rule: { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 },
    ruleChangedInPeriod: false,
    versionCount: 1,
  }),
}));
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({
    entries: [{ productId: 30, label: 'Product 30', setpointG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' }],
    at: (ms: number) => (ms >= Date.parse('2026-07-01T00:00:00Z') ? { productId: 30, label: 'Product 30', effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' } : null),
    isEmpty: false,
  }),
  limitsOf: () => null,
}));


const MK = (id: number, color: string, desc = '205-IL0-SD') => ({ productId: id, label: desc, description: desc, color, activeFlag: true });
vi.mock('./productLimits.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./productLimits.js')>();
  return {
    ...real,
    loadProductCatalogue: async () => new real.ProductCatalogue([MK(20, 'Star Green'), MK(21, 'Blue'), MK(30, 'Red', 'OTHER-LINE')], []),
  };
});

const { getWeightStations } = await import('./weightStations.js');

function pool() {
  return fakePositionalPool(ONE_REAL_GENERATION, [
    [],
    [{ cones: 400, rejects: 0 }],
    [],
    [
      { st: 1, mat: 20, n: 100 },
      { st: 2, mat: 21, n: 100 },
      { st: 3, mat: null, n: 100 },
      { st: 4, mat: 20, n: 50 },
      { st: 4, mat: 21, n: 50 },
    ],
  ]).pool as ConnectionPool;
}

describe('getWeightStations - distinct product labels per station', () => {
  it('two stations on materials sharing a description get different labels; mixed has none; July rows use the line product', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const by = (n: number) => data.stations.find((s) => s.station === n)!;
    expect(by(1).targetProductLabel).toBe('205-IL0-SD · Star Green');
    expect(by(2).targetProductLabel).toBe('205-IL0-SD · Blue');
    expect(by(1).targetProductLabel).not.toBe(by(2).targetProductLabel);
    expect(by(4).targetBasis).toBe('mixed');
    expect(by(4).targetProductLabel).toBeNull();
    expect(by(3).targetBasis).toBe('line_product');
    expect(by(3).targetProductLabel).toBe('OTHER-LINE');
  });
});
