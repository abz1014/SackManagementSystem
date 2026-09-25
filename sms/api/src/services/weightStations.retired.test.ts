/**
 * RT-018 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): a product PDAS has
 * retired (`MaterialActive = 0`) could still be shown, unmarked, as the live
 * weight target — real data confirms this happens (MaterialId 17 is retired
 * in PDAS yet still carries a production row on the dev copy;
 * `PDAS_TP1U2_SEP07.Materials.MaterialActive = 0`, mirrored to
 * `sms.product.active_flag = 0`). This pins that `getWeightStations` now
 * carries the flag through both the per-station target (`targetProductActive`)
 * and the line-wide one (`productActive`), for all three `targetBasis`
 * outcomes, using the SAME harness weightStations.target.test.ts already
 * built for the per-material target itself — only the catalogue's
 * `activeFlag` differs here.
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
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({
    entries: [{ productId: 30, label: 'Product 30', setpointG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' }],
    at: (ms: number) => (ms >= Date.parse('2026-07-01T00:00:00Z') ? { productId: 30, label: 'Product 30', effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' } : null),
    isEmpty: false,
  }),
  limitsOf: () => null,
}));

const VERSIONS: Record<number, { setpointG: number; offsetMinusG: number; offsetPlusG: number; effectiveFromMs: number; effectiveFromUtc: string }[]> = {
  21: [{ setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-07-15T00:00:00Z'), effectiveFromUtc: '2026-07-15T00:00:00.000Z' }],
  30: [{ setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' }],
};
function versionAt(id: number, ms: number) {
  const list = (VERSIONS[id] ?? []).filter((v) => v.effectiveFromMs <= ms).sort((a, b) => b.effectiveFromMs - a.effectiveFromMs);
  return list[0] ?? null;
}
function limitsAt(id: number, ms: number) {
  const v = versionAt(id, ms);
  if (!v) return null;
  const target = v.setpointG;
  return { targetG: target, loG: target - v.offsetMinusG, hiG: target + v.offsetPlusG, label: `${target} ± ${v.offsetPlusG} g` };
}
// The one thing this file changes versus weightStations.target.test.ts's own
// catalogue mock: BOTH materials here are retired (activeFlag: false) — real
// data shows a retired material's readings keep arriving (MaterialId 17), so
// both the per-material path and the line-wide fallback need to carry it.
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: (id: number) => ({ productId: id, label: `Product ${id}`, activeFlag: false }),
    versionAt,
    limitsAt,
    versionsAscending: (id: number) => [...(VERSIONS[id] ?? [])].sort((a, b) => a.effectiveFromMs - b.effectiveFromMs),
    productIds: () => Object.keys(VERSIONS).map(Number),
    latest: () => null,
    isEmpty: false,
  }),
  limitsFromVersion: (v: { setpointG: number | null; offsetMinusG: number | null; offsetPlusG: number | null }) =>
    v.setpointG == null || v.offsetMinusG == null || v.offsetPlusG == null ? null : { targetG: v.setpointG, loG: v.setpointG - v.offsetMinusG, hiG: v.setpointG + v.offsetPlusG, label: '' },
}));

const { getWeightStations } = await import('./weightStations.js');

function fakePool(...responses: unknown[][]): ConnectionPool {
  return fakePositionalPool(ONE_REAL_GENERATION, responses).pool;
}

function pool() {
  return fakePool(
    [],
    [{ cones: 200, rejects: 0 }],
    [],
    [
      { st: 1, mat: 21, n: 100 },
      { st: 3, mat: null, n: 100 },
    ],
  );
}

describe('getWeightStations — RT-018, a retired material as the target carries the flag', () => {
  it('station_material basis: targetProductActive is false for a retired material', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const s1 = data.stations.find((s) => s.station === 1)!;
    expect(s1.targetBasis).toBe('station_material');
    expect(s1.targetProductActive).toBe(false);
    // The figure itself is unaffected by retirement — only its flag changes.
    expect(s1.vsTargetG).toBe(-2);
  });

  it('line_product basis: the line-wide fallback target also carries its own retired flag', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const s3 = data.stations.find((s) => s.station === 3)!;
    expect(s3.targetBasis).toBe('line_product');
    expect(s3.targetProductActive).toBe(false);
  });

  it('the line-wide target (WeightStationsData.productActive) is false when the current product is retired', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    expect(data.productId).toBe(30);
    expect(data.productActive).toBe(false);
  });
});
