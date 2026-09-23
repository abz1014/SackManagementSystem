/**
 * FRICTION AUDIT F6, CLOSED AT THE SERVICE — "a reading is judged by the
 * limits in force at its own time, never by today's mirror" (CLAUDE.md §8).
 * 23 Sep 2026.
 *
 * WHAT WAS WRONG, MEASURED ON REAL DATA BEFORE THIS FILE EXISTED. Every row
 * in `sms.product_limit_version` on the dev copy is a migration-027 bootstrap
 * stamped `2026-09-11T10:03:15.957Z` with `effective_is_lower_bound = 1` and
 * the reason "true start unknown" — fourteen rows, products 11-18, 20, 21 and
 * 1021-1024, verified by query. SMS therefore holds NO record of what limits
 * were actually in force in August.
 *
 * `71ac170` taught the reports to refuse a target on that basis, through
 * `reports/common.ts`'s `resolvePeriodTarget`. `29f4e70` taught this service
 * to FLAG it and keep the number. Run against epoch 9 (2026-08-05 → 08-20,
 * real IFL data, the part of that generation the simulator does not overlap),
 * the two choices contradicted each other on ONE PAGE — Report › Cone weight:
 *
 *   top of page   target.source = 'none', setpointG = null, and the sentence
 *                 "No target is stated: the earliest limits this system holds
 *                 for that product were first recorded on 2026-09-11, after
 *                 this period ended on 2026-08-20."
 *   same page     byStation vs_target: st9 −14.2, st8 −12.52, st11 −12.4,
 *                 st10 −11.66 … seven of fourteen stations judged against
 *                 those exact refused limits.
 *
 * THE DECISION THIS FILE PINS: the service withholds, it does not flag-and-
 * hope. `vsTargetG` and the line-wide `targetG` are null when the resolved
 * version begins after the window ends; `targetOmittedReason` carries the
 * reason in words; and `targetIsLowerBound` / `targetAfterWindowEnd` survive
 * on the row, NO LONGER gated on the number's presence, because they are the
 * explanation for its absence. Full argument: `WeightStationRow.vsTargetG`.
 *
 * AND THE OTHER HALF, equally important and easy to lose in a later tidy-up:
 * a version merely OBSERVED already in place at or before the window's end is
 * NOT refused. Those limits did apply; only their start is unproven. Its
 * number is kept and qualified. That is `resolvePeriodTarget`'s own two-case
 * split, and this service must not invent a third — which is why the
 * resolution is routed through that one function rather than re-decided here.
 *
 * Fixture idiom (partial mocks, positional fakePool) is the sibling
 * weightStations.basis.test.ts's, deliberately unchanged so the two files
 * describe the same three stations.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const FROM = '2026-08-01';
const TO = '2026-08-14';

const day = (date: string, mean: number) => ({ date, n: 10, mean, nelson: [] });
vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({
    days: 14,
    stations: [
      {
        station: 1, n: 100, grandMean: 1940, medianG: 1940, stdevWithin: 5, sigmaDayToDay: 0,
        centrelineG: 1940, restartedOn: null, longestRun: 3,
        days: [day('2026-08-12', 1990), day('2026-08-13', 1990), day('2026-08-14', 1990)],
      },
      {
        station: 2, n: 100, grandMean: 1960, medianG: 1960, stdevWithin: 5, sigmaDayToDay: 0,
        centrelineG: 1960, restartedOn: null, longestRun: 3,
        days: [day('2026-08-12', 1900), day('2026-08-13', 1900), day('2026-08-14', 1900)],
      },
      {
        station: 3, n: 100, grandMean: 1950, medianG: 1950, stdevWithin: 5, sigmaDayToDay: 0,
        centrelineG: 1950, restartedOn: null, longestRun: 0, days: [],
      },
    ],
  }),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));

/**
 * THE LINE-WIDE PRODUCT IS SWITCHABLE, because the two cases this file
 * separates differ ONLY in the line product's version date:
 *  - product 30's version begins 2026-07-01, before the window: usable.
 *  - product 31 has its ONLY version on 2026-09-11, after the window's end —
 *    product 12's exact situation on the dev copy for the August period.
 */
let LINE_PRODUCT = 30;
const lineEntry = () => ({
  productId: LINE_PRODUCT, label: `Product ${LINE_PRODUCT}`,
  effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z',
});
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({
    entries: [{ ...lineEntry(), setpointG: null, weightOffsetMinusG: null, weightOffsetPlusG: null }],
    at: (ms: number) => (ms >= lineEntry().effectiveFromMs ? lineEntry() : null),
    isEmpty: false,
  }),
  limitsOf: () => null,
}));

type V = { setpointG: number; offsetMinusG: number; offsetPlusG: number; effectiveFromMs: number; effectiveFromUtc: string; effectiveIsLowerBound: boolean };
const BOOTSTRAP_UTC = '2026-09-11T15:03:15.957Z'; // the real migration-027 instant
const VERSIONS: Record<number, V[]> = {
  // Dated inside the window's past — usable, no qualifier.
  21: [{ setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-07-15T00:00:00Z'), effectiveFromUtc: '2026-07-15T00:00:00.000Z', effectiveIsLowerBound: false }],
  // Observed already in place BEFORE the window ended: a lower bound, but in
  // force during the period. Usable, qualified — must KEEP its number.
  22: [{ setpointG: 1955, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-07-20T00:00:00Z'), effectiveFromUtc: '2026-07-20T00:00:00.000Z', effectiveIsLowerBound: true }],
  // The F6 case: recorded a month AFTER these readings were taken.
  23: [{ setpointG: 1970, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse(BOOTSTRAP_UTC), effectiveFromUtc: BOOTSTRAP_UTC, effectiveIsLowerBound: false }],
  30: [{ setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z', effectiveIsLowerBound: false }],
  31: [{ setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: Date.parse(BOOTSTRAP_UTC), effectiveFromUtc: BOOTSTRAP_UTC, effectiveIsLowerBound: false }],
};
/** Reproduces ProductCatalogue.versionAt's documented fallback exactly. */
function versionAt(id: number, ms: number) {
  const list = [...(VERSIONS[id] ?? [])].sort((a, b) => b.effectiveFromMs - a.effectiveFromMs);
  const inForce = list.find((v) => v.effectiveFromMs <= ms);
  if (inForce) return inForce;
  const oldest = list[list.length - 1];
  return oldest ? { ...oldest, effectiveIsLowerBound: true } : null;
}
function limitsAt(id: number, ms: number) {
  const v = versionAt(id, ms);
  if (!v) return null;
  return { targetG: v.setpointG, loG: v.setpointG - v.offsetMinusG, hiG: v.setpointG + v.offsetPlusG, label: `${v.setpointG} g` };
}
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: (id: number) => ({ productId: id, label: `Product ${id}`, activeFlag: true }),
    distinctLabel: (id: number) => `Product ${id}`,
    versionAt,
    limitsAt,
    versionsAscending: (id: number) => [...(VERSIONS[id] ?? [])].sort((a, b) => a.effectiveFromMs - b.effectiveFromMs),
    productIds: () => Object.keys(VERSIONS).map(Number),
    latest: () => null,
    isEmpty: false,
  }),
  limitsFromVersion: () => null,
}));

const { getWeightStations } = await import('./weightStations.js');

function fakePool(...responses: unknown[][]): ConnectionPool {
  let i = 0;
  const req = { input: () => req, query: async () => ({ recordset: responses[i++] ?? [] }) };
  return { request: () => req } as unknown as ConnectionPool;
}
/** rejectRatesByStation's two queries, its unmatched-reject query, then stationMaterialCounts'. */
const pool = (materials: { st: number; mat: number | null; n: number }[]) =>
  fakePool([], [{ cones: 300, rejects: 0 }], [], materials);

const MIXED_MATERIALS = [
  { st: 1, mat: 21, n: 100 }, // dated version — usable
  { st: 2, mat: 22, n: 100 }, // lower-bound but in force — usable, qualified
  { st: 3, mat: 23, n: 100 }, // begins after the window — refused
];

describe('F6 — a target the app cannot justify is WITHHELD, not merely flagged', () => {
  it('a station whose limits version begins after the window gets no vs-target number, and the reason is stated', async () => {
    LINE_PRODUCT = 30;
    const d = await getWeightStations(pool(MIXED_MATERIALS), 1, FROM, TO);
    const s3 = d.stations.find((s) => s.station === 3)!;
    expect(s3.targetBasis).toBe('station_material');
    expect(s3.vsTargetG).toBeNull();
    // The flags are the EXPLANATION for the null and must survive it. Before
    // 23 Sep 2026 they were gated on `vsTargetG != null`, which erased them
    // at exactly the moment they became the only thing left to say.
    expect(s3.targetAfterWindowEnd).toBe(true);
    expect(s3.targetIsLowerBound).toBe(true);
    expect(d.stationsWithTargetWithheld).toBe(1);
  });

  it('a version merely OBSERVED in place before the window ends KEEPS its number, qualified', async () => {
    LINE_PRODUCT = 30;
    const d = await getWeightStations(pool(MIXED_MATERIALS), 1, FROM, TO);
    const s2 = d.stations.find((s) => s.station === 2)!;
    // Material 22: setpoint 1955 g, station 2's period mean 1960 g.
    expect(s2.vsTargetG).toBe(5);
    expect(s2.targetIsLowerBound).toBe(true); // "no later than 2026-07-20"
    expect(s2.targetAfterWindowEnd).toBe(false);
    // And a plainly dated version carries no qualifier at all.
    const s1 = d.stations.find((s) => s.station === 1)!;
    expect(s1.vsTargetG).toBe(-20); // 1940 − 1960
    expect(s1.targetIsLowerBound).toBe(false);
    expect(s1.targetAfterWindowEnd).toBe(false);
  });

  it('withholding is confined to the rows that earn it — the other stations are untouched', async () => {
    LINE_PRODUCT = 30;
    const d = await getWeightStations(pool(MIXED_MATERIALS), 1, FROM, TO);
    expect(d.stations.filter((s) => s.vsTargetG == null).map((s) => s.station)).toEqual([3]);
    // Not vacuous: the line-wide target is usable here, so nothing but the
    // per-row resolution can be responsible for station 3's blank.
    expect(d.targetG).toBe(1950);
    expect(d.targetOmittedReason).toBeNull();
  });

  it('when the LINE-WIDE version begins after the window, targetG is withheld and the reason names both dates', async () => {
    LINE_PRODUCT = 31;
    const d = await getWeightStations(pool(MIXED_MATERIALS), 1, FROM, TO);
    expect(d.targetG).toBeNull();
    expect(d.targetEffectiveAfterWindowEnd).toBe(true);
    expect(d.targetEffectiveFromUtc).toBe(BOOTSTRAP_UTC);
    // The sentence is the shared resolver's, not one composed here — that is
    // the whole point of routing through it, so every surface that blanks a
    // target for this reason gives the SAME reason.
    expect(d.targetOmittedReason).toContain('2026-09-11');
    expect(d.targetOmittedReason).toContain(TO);
    expect(d.targetOmittedReason).toContain('never by a later record applied backwards');
  });

  it('`limits` is deliberately NOT withheld with the target, so the drift threshold and projection are unaffected', async () => {
    LINE_PRODUCT = 31;
    const d = await getWeightStations(pool(MIXED_MATERIALS), 1, FROM, TO);
    // `targetG` answers "what should these readings have weighed" — a claim
    // about the period, refused. `limits` answers "where is this station's
    // drift heading" — a claim about the future, for which the limits now on
    // record are the right ones. Collapsing the two would move `thresholdG`
    // and therefore `flagged`, the attention list and every guard on them.
    expect(d.targetG).toBeNull();
    expect(d.limits).toEqual({ loG: 1910, hiG: 1990 });
    expect(d.thresholdG).toBeGreaterThan(0);
  });

  it('a station that ran more than one material still reports no target, and claims no F6 qualifier', async () => {
    LINE_PRODUCT = 30;
    const d = await getWeightStations(
      pool([{ st: 1, mat: 21, n: 50 }, { st: 1, mat: 23, n: 50 }, { st: 2, mat: 22, n: 100 }, { st: 3, mat: 23, n: 100 }]),
      1, FROM, TO,
    );
    const s1 = d.stations.find((s) => s.station === 1)!;
    expect(s1.targetBasis).toBe('mixed');
    expect(s1.vsTargetG).toBeNull();
    expect(s1.materialsInWindow).toBe(2);
    // 'mixed' is a DIFFERENT reason for a blank column (no single target)
    // and must not borrow F6's explanation for it.
    expect(s1.targetIsLowerBound).toBe(false);
    expect(s1.targetAfterWindowEnd).toBe(false);
  });
});
