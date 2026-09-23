/**
 * FRICTION AUDIT F4 — THE TWO SIGNED COLUMNS MUST SHARE THE `Mean` COLUMN'S
 * POPULATION. 23 Sep 2026.
 *
 * The defect this pins, in the words of the audit: the station table printed
 * a station's period `Mean` and its `vs line` side by side, and they
 * contradicted each other. `vsLineG` was `runMean − lineMeanG`, the mean over
 * the station's most recent consecutive-drift run (1–15 days in the periods
 * measured); `meanG` was `grandMean`, the mean over the whole window. Two
 * populations, adjacent columns, nothing on the page saying so.
 *
 * Measured on the dev copy against REAL generations only (the sidecar also
 * holds simulator rows under epoch 13, 21 Aug – 22 Sep, which overlap the
 * real September generation and must never be used to validate a figure):
 *   - epoch 1, `DATA_TP1U2`, 2026-06-22 → 2026-07-10: SEVEN of fourteen
 *     stations carried a `vs line` whose sign contradicted their own `Mean`.
 *     Station 9: mean 1949.08 g against a line mean of 1951.05 g — below the
 *     line — printed `vs line +5.69 g`.
 *   - epoch 9, `DATA_TP1U2_SEP07`, 2026-08-05 → 2026-08-20 (the part of that
 *     generation with no simulator overlap): SIX of fourteen. Station 11:
 *     mean 1947.60 g against a line mean of 1950.93 g, printed `+2.73 g`.
 * After the fix: zero, in both windows.
 *
 * This is the calibration requirement's core table, and it reaches IFL as a
 * CSV and an XLSX. A reader comparing two adjacent numbers must not be able
 * to derive a contradiction from them. That is the bar this file enforces.
 *
 * WHAT IT DOES NOT ASSERT: that the run basis is wrong. It is a real and
 * useful quantity — it is what `flagged` and `projection` are computed over,
 * and it survives in the payload as `runMeanG` / `runVsLineG`, beside
 * `daysHeld`, which states its length. The rule is that it may not be printed
 * as if it were the period figure. The final case below deliberately fails if
 * the run basis is ever quietly dropped altogether, so a future author cannot
 * satisfy this file by deleting the distinction instead of naming it.
 *
 * Fixture idiom (partial mocks of calibration.ts / admin.ts / productAt.ts /
 * productLimits.ts, positional fakePool) is the sibling
 * weightStations.target.test.ts's, unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const FROM = '2026-08-01';
const TO = '2026-08-14';
const WINDOW_END_MS = Date.parse('2026-08-14T23:59:59Z');

/**
 * Three stations, each with 100 cones so the line mean is the plain average
 * of their grand means: (1940 + 1960 + 1950) / 3 = 1950 g.
 *
 * Stations 1 and 2 each carry a three-day run whose mean sits 50 g the OTHER
 * side of the line from where their period mean sits. That is the F4 shape in
 * its starkest form: under the old basis station 1 printed `Mean 1940` (ten
 * grams BELOW the line) beside `vs line +40.0`, and station 2 printed
 * `Mean 1960` beside `vs line −50.0`. Station 3 has no daily rows at all, so
 * it has no run — the case where the two bases coincide and the row must
 * still be internally consistent.
 */
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
const P30 = { productId: 30, label: 'Product 30', effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z' };
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({
    entries: [{ ...P30, setpointG: null, weightOffsetMinusG: null, weightOffsetPlusG: null }],
    at: (ms: number) => (ms >= P30.effectiveFromMs ? P30 : null),
    isEmpty: false,
  }),
  limitsOf: () => null,
}));

/**
 * Material 21 is dated inside the window's past. Material 23 is the F6 shape:
 * its ONLY limits version begins 2026-09-11, four days after the real period
 * the audit measured and nearly a month after this window's end — exactly
 * product 12's situation on the dev copy. `versionAt` below reproduces
 * `ProductCatalogue.versionAt`'s documented fallback (nearest version,
 * marked `effectiveIsLowerBound`), because that fallback is the thing under
 * test: the service used to read the instant off it and drop the flag.
 */
const VERSIONS: Record<number, { setpointG: number; offsetMinusG: number; offsetPlusG: number; effectiveFromMs: number; effectiveFromUtc: string; effectiveIsLowerBound: boolean }[]> = {
  21: [{ setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-07-15T00:00:00Z'), effectiveFromUtc: '2026-07-15T00:00:00.000Z', effectiveIsLowerBound: false }],
  23: [{ setpointG: 1970, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-09-11T15:03:15.957Z'), effectiveFromUtc: '2026-09-11T15:03:15.957Z', effectiveIsLowerBound: false }],
  30: [{ setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z', effectiveIsLowerBound: false }],
};
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

/** Positional fakePool — the sibling files' idiom. */
function fakePool(...responses: unknown[][]): ConnectionPool {
  let i = 0;
  const req = { input: () => req, query: async () => ({ recordset: responses[i++] ?? [] }) };
  return { request: () => req } as unknown as ConnectionPool;
}
// rejectRatesByStation's per-station query, its totals query, its unmatched-
// reject query, then stationMaterialCounts'. Stations 1 and 2 ran material 21
// only; station 3 ran material 23 only (the F6 case).
const pool = () =>
  fakePool([], [{ cones: 300, rejects: 0 }], [], [
    { st: 1, mat: 21, n: 100 },
    { st: 2, mat: 21, n: 100 },
    { st: 3, mat: 23, n: 100 },
  ]);

const round2 = (n: number) => Math.round(n * 100) / 100;

describe('F4 — the station row is internally consistent', () => {
  it('vsLineG is the row’s OWN meanG against the line mean, for every station', async () => {
    const d = await getWeightStations(pool(), 1, FROM, TO);
    expect(d.lineMeanG).toBe(1950);
    expect(d.stations).toHaveLength(3);
    for (const s of d.stations) {
      expect(round2(s.meanG - d.lineMeanG!)).toBe(s.vsLineG);
    }
  });

  it('no station’s vsLineG can contradict the sign of its own Mean column', async () => {
    const d = await getWeightStations(pool(), 1, FROM, TO);
    const contradictions = d.stations.filter((s) => {
      const implied = Math.sign(round2(s.meanG - d.lineMeanG!));
      return implied !== 0 && Math.sign(s.vsLineG) !== 0 && implied !== Math.sign(s.vsLineG);
    });
    expect(contradictions.map((s) => s.station)).toEqual([]);
    // Not vacuous: the fixture is built so the OLD run basis produced two of
    // them. If this ever fails, the fixture — not the rule — has drifted.
    const s1 = d.stations.find((s) => s.station === 1)!;
    const s2 = d.stations.find((s) => s.station === 2)!;
    expect(Math.sign(s1.runVsLineG!)).not.toBe(Math.sign(s1.vsLineG));
    expect(Math.sign(s2.runVsLineG!)).not.toBe(Math.sign(s2.vsLineG));
  });

  it('vsTargetG is the row’s OWN meanG against the target, never the run mean', async () => {
    const d = await getWeightStations(pool(), 1, FROM, TO);
    const s1 = d.stations.find((s) => s.station === 1)!;
    // Material 21's target is 1,960 g; station 1's period mean is 1,940 g.
    // The old run basis would have printed +30 here (1990 − 1960).
    expect(s1.targetBasis).toBe('station_material');
    expect(s1.vsTargetG).toBe(-20);
    const s2 = d.stations.find((s) => s.station === 2)!;
    expect(s2.vsTargetG).toBe(0); // 1960 − 1960; the old basis gave −60.
  });

  it('the Weight screen’s implied-target derivation (meanG − vsTargetG) reconciles', async () => {
    // web/src/screens/Weight.tsx:629 derives each station's implied target
    // exactly this way and refuses to speak when the stations disagree. Under
    // the run basis that derivation was silently wrong for every flagged or
    // drifting station, which is why this is pinned here and not only there.
    const d = await getWeightStations(pool(), 1, FROM, TO);
    for (const s of d.stations.filter((x) => x.vsTargetG != null)) {
      const implied = round2(s.meanG - s.vsTargetG!);
      const version = versionAt(s.station === 3 ? 23 : 21, WINDOW_END_MS)!;
      expect(implied).toBe(version.setpointG);
    }
  });

  it('the run basis is still reported, under its own name and beside its length', async () => {
    const d = await getWeightStations(pool(), 1, FROM, TO);
    const s1 = d.stations.find((s) => s.station === 1)!;
    expect(s1.runMeanG).toBe(1990);
    expect(s1.runVsLineG).toBe(40);
    expect(s1.daysHeld).toBe(3);
    // Station 3 has no daily rows, so there is no run to report — null, not
    // the period mean wearing the run's name.
    const s3 = d.stations.find((s) => s.station === 3)!;
    expect(s3.runMeanG).toBeNull();
    expect(s3.runVsLineG).toBeNull();
    expect(s3.daysHeld).toBe(0);
  });
});

describe('F6 — the limits version’s qualifier is carried, not dropped', () => {
  it('a version dated after the window end is flagged on the row that used it', async () => {
    const d = await getWeightStations(pool(), 1, FROM, TO);
    const s3 = d.stations.find((s) => s.station === 3)!;
    // Material 23's only version begins 2026-09-11, after this window ends on
    // 2026-08-14.
    //
    // REVISED 23 Sep 2026: when this case was first pinned the number was
    // still computed and the flags merely travelled with it, leaving each
    // consumer to decide. That produced Report › Cone weight refusing to
    // state a target at the top of the page while seven stations' `vs target`
    // numbers sat in the table beneath it, judged against the very limits the
    // caption had just refused. The number is now WITHHELD at the service —
    // see WeightStationRow.vsTargetG for the three reasons — and the flags
    // remain, no longer gated on the number, because they are the REASON the
    // column is blank. The assertion below pins both halves of that: absent
    // number, present explanation.
    expect(s3.targetBasis).toBe('station_material');
    expect(s3.vsTargetG).toBeNull();
    expect(s3.targetIsLowerBound).toBe(true);
    expect(s3.targetAfterWindowEnd).toBe(true);
    // Stations 1 and 2 used a version genuinely in force during the window.
    for (const s of d.stations.filter((x) => x.station !== 3)) {
      expect(s.targetIsLowerBound).toBe(false);
      expect(s.targetAfterWindowEnd).toBe(false);
    }
  });

  it('the line-wide target reports its own qualifier alongside its instant', async () => {
    const d = await getWeightStations(pool(), 1, FROM, TO);
    // Product 30's version begins 2026-07-01, before the window: a dated
    // version, in force, no qualifier.
    expect(d.targetEffectiveFromUtc).toBe('2026-07-01T00:00:00.000Z');
    expect(d.targetEffectiveIsLowerBound).toBe(false);
    expect(d.targetEffectiveAfterWindowEnd).toBe(false);
  });
});
