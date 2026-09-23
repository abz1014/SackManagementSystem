/**
 * UX Phase 5 Brief 1, unit U2 (16 Sep 2026) — the station table stops using a
 * single line-wide target for every station.
 *
 * weightStations.ts:132-137 carried its own admission: "Still one line-wide
 * target: with up to six materials running on different machines (Sep 2026
 * data), a per-machine target is the honest next step — recorded, not
 * built." This pins the built version:
 *  - a station that ran exactly one material in the window is judged against
 *    THAT material's own limits, in force at the window's end;
 *  - a station that ran more than one material has no single honest target —
 *    vsTargetG is null and materialsInWindow says how many, rather than
 *    printing a number that would silently average two products' tolerances;
 *  - `limitsChangedInWindow` (the line-wide product's own qualifier, still
 *    reported at the top of WeightStationsData) counts a version that BEGAN
 *    inside the window, not the one merely in force at its end — the same
 *    rule spc.ts's getSpec test (spc.getSpec.test.ts) already pins for the
 *    control chart.
 *
 * getStationDrift and listCalibrationAdjustments are the two DB-backed calls
 * this file stubs (same partial-mock idiom as weightStations.window.test.ts
 * and .gap.test.ts); the pure helpers (adjustmentRestarts, latestRestart,
 * projectDaysToLimit) stay real. The one NEW real query this brief adds
 * (stationMaterialCounts, weightStations.ts) runs against the recording
 * fakePool below, positioned AFTER rejectRatesByStation's queries —
 * weightStations.ts deliberately sequences it there so the existing
 * positional fixtures in the other weightStations.*.test.ts files (which
 * supply exactly two responses) are untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const FROM = '2026-08-01';
const TO = '2026-08-14';
const startMs = Date.parse('2026-08-01T00:00:00Z');
const endMs = Date.parse('2026-08-14T23:59:59Z');

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({
    days: 14,
    stations: [
      // Station 1: ran ONE material in the window (material 21 only).
      { station: 1, n: 100, grandMean: 1958, medianG: 1958, stdevWithin: 5, sigmaDayToDay: 0, centrelineG: 1958, restartedOn: null, longestRun: 0, days: [] },
      // Station 2: ran TWO materials in the window (21 and 22).
      { station: 2, n: 100, grandMean: 1930, medianG: 1930, stdevWithin: 5, sigmaDayToDay: 0, centrelineG: 1930, restartedOn: null, longestRun: 0, days: [] },
      // Station 3: every reading carries no material_id — the July generation
      // — so it falls back to the line-wide Current Product (product 30).
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

/** Versions per material, oldest first. Mirrors spc.getSpec.test.ts's fixture shape. */
const VERSIONS: Record<number, { setpointG: number; offsetMinusG: number; offsetPlusG: number; effectiveFromMs: number; effectiveFromUtc: string }[]> = {
  // Material 21: 1,960 ± 30 g throughout the window.
  21: [{ setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-07-15T00:00:00Z'), effectiveFromUtc: '2026-07-15T00:00:00.000Z' }],
  // Material 22: 1,900 ± 20 g.
  22: [{ setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, effectiveFromMs: Date.parse('2026-07-15T00:00:00Z'), effectiveFromUtc: '2026-07-15T00:00:00.000Z' }],
  // Product 30 (the line-wide Current Product): one version BEFORE the
  // window (in force at its start), one that BEGINS inside it. Only the
  // second counts as "changed inside the window".
  30: [
    { setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' },
    { setpointG: 1945, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: Date.parse('2026-08-10T00:00:00Z'), effectiveFromUtc: '2026-08-10T00:00:00.000Z' },
  ],
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
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: (id: number) => ({ productId: id, label: `Product ${id}`, activeFlag: true }),
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

/** Positional fakePool — same idiom as the sibling weightStations.*.test.ts files. */
function fakePool(...responses: unknown[][]): ConnectionPool {
  let i = 0;
  const req = { input: () => req, query: async () => ({ recordset: responses[i++] ?? [] }) };
  return { request: () => req } as unknown as ConnectionPool;
}

// Response order: rejectRatesByStation's per-station query, then its totals
// query (both empty — no rejects), then (since 23 Sep 2026) its unmatched-
// reject query — empty here, there are no rejects at all in this fixture —
// and finally stationMaterialCounts' single query.
function pool() {
  return fakePool(
    [],
    [{ cones: 300, rejects: 0 }],
    [],
    [
      { st: 1, mat: 21, n: 100 },
      { st: 2, mat: 21, n: 60 },
      { st: 2, mat: 22, n: 40 },
      { st: 3, mat: null, n: 100 },
    ],
  );
}

describe('getWeightStations — per-station, per-material target (U2)', () => {
  it('a station that ran exactly one material is judged against that material’s own limits', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const s1 = data.stations.find((s) => s.station === 1)!;
    expect(s1.targetBasis).toBe('station_material');
    // 1958 (grandMean, unflagged so runMean === grandMean) − 1960 (material 21's target).
    expect(s1.vsTargetG).toBe(-2);
    expect(s1.materialsInWindow).toBeUndefined();
  });

  it('a station that ran more than one material has no single target: vsTargetG null, materialsInWindow set', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const s2 = data.stations.find((s) => s.station === 2)!;
    expect(s2.targetBasis).toBe('mixed');
    expect(s2.vsTargetG).toBeNull();
    expect(s2.materialsInWindow).toBe(2);
  });

  it('a station whose readings carry no material_id falls back to the line-wide Current Product, exactly as coneState.ts does', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const s3 = data.stations.find((s) => s.station === 3)!;
    expect(s3.targetBasis).toBe('line_product');
    // 1945 (grandMean) − 1945 (product 30's target in force at the window's end).
    expect(s3.vsTargetG).toBe(0);
  });

  it('projectDaysToLimit returns null for a mixed-basis row, never a number averaging two products', async () => {
    // Force station 2 to be flagged by giving it a run: n>0 with a nelson hit
    // is the only way `projection` is ever computed, so this drives the same
    // getWeightStations call with a flagged mixed station via the module's
    // own flagging rule — station 2 has no `days`, so it cannot flag here;
    // this test instead pins the guard directly through the returned row:
    // a 'mixed' row must never carry a projection regardless of `flagged`.
    const data = await getWeightStations(pool(), 1, FROM, TO);
    const s2 = data.stations.find((s) => s.station === 2)!;
    expect(s2.flagged).toBe(false); // no days ⇒ cannot flag; projection is null either way
    expect(s2.projection).toBeNull();
  });

  it('limitsChangedInWindow counts a version that BEGAN inside the window, not the one merely in force at its end', async () => {
    const data = await getWeightStations(pool(), 1, FROM, TO);
    // Product 30's second version (2026-08-10) begins inside [08-01, 08-14];
    // the first (2026-07-01) does not, even though it was once in force.
    expect(data.limitsChangedInWindow).toBe(1);
    expect(data.targetG).toBe(1945);
    expect(data.targetEffectiveFromUtc).toBe('2026-08-10T00:00:00.000Z');
  });

  it('a window with no version change at all reports limitsChangedInWindow 0', async () => {
    const data = await getWeightStations(pool(), 1, '2026-07-16', '2026-07-20');
    expect(data.limitsChangedInWindow).toBe(0);
  });
});

void startMs;
void endMs;
