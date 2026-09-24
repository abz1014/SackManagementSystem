/**
 * RT24-04, DB-backed half: `getPlausibilityRuleAsOf`/`getWeightRuleAsOf`
 * against a two-version history, proving the defect the pure ruleAsOf.test.ts
 * cannot reach — the SQL loader's own `effective_from` → plant-ms conversion
 * (toPlantMs) and the five-hour TWO CLOCKS gap it exists to close.
 *
 * Scenario named in the brief: plausibility v1 (1500-2100g) effective from
 * the epoch, v2 (1900-2100g) effective 2026-08-19T10:00:00Z. A 1600g reading
 * taken at PLANT 2026-08-18 must be judged by v1 (not an outlier); the same
 * reading at PLANT 2026-08-20 must be judged by v2 (an outlier).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getPlausibilityRuleAsOf, getWeightRuleAsOf, plantDayEndMs, plantDayStartMs } from './ruleAsOf.js';
import { toPlantMs } from './plantClock.js';

/** Minimal fake: one `.request().input(...).input(...).query(rows)` per call, serving `rows` verbatim. */
function fakePool(recordset: Record<string, unknown>[]): ConnectionPool {
  const request = () => {
    const req = {
      input: () => req,
      query: async () => ({ recordset }),
    };
    return req;
  };
  return { request } as unknown as ConnectionPool;
}

const isOutlier = (weightG: number, loG: number, hiG: number) => weightG < loG || weightG > hiG;

describe('getPlausibilityRuleAsOf — two-version history, five-hour boundary', () => {
  const rows = [
    // ORDER BY effective_from DESC — newest first, as the real SQL returns.
    { cl: 1900, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2026-08-19T10:00:00.000Z') },
    { cl: 1500, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2026-08-05T00:00:00.000Z') },
  ];

  it('a 1600g reading at PLANT 2026-08-18 is judged by v1 (1500-2100) — not an outlier', async () => {
    const pool = fakePool(rows);
    const atPlant = plantDayEndMs('2026-08-18'); // end of the plant production day
    const { rule } = await getPlausibilityRuleAsOf(pool, 1, atPlant);
    expect(rule).toEqual({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
    expect(isOutlier(1600, rule.coneLoG, rule.coneHiG)).toBe(false);
  });

  it('the SAME 1600g reading at PLANT 2026-08-20 is judged by v2 (1900-2100) — an outlier', async () => {
    const pool = fakePool(rows);
    const atPlant = plantDayEndMs('2026-08-20');
    const { rule } = await getPlausibilityRuleAsOf(pool, 1, atPlant);
    expect(rule).toEqual({ coneLoG: 1900, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
    expect(isOutlier(1600, rule.coneLoG, rule.coneHiG)).toBe(true);
  });

  it('the boundary is exact: five hours before v2’s (converted) effective instant is still v1, and AT it is v2', async () => {
    // effective_from = 2026-08-19T10:00:00Z is genuine UTC (app-written);
    // toPlantMs converts it onto the plant-labelled convention this loader
    // compares against — the TWO CLOCKS rule. Deriving both instants through
    // the same toPlantMs call keeps this assertion valid on any host offset.
    const pool = fakePool(rows);
    const v2EffectivePlantMs = toPlantMs('2026-08-19T10:00:00.000Z');
    const justBeforePlantMs = v2EffectivePlantMs - 5 * 3_600_000;
    const { rule } = await getPlausibilityRuleAsOf(pool, 1, justBeforePlantMs);
    expect(rule.coneLoG).toBe(1500);
    const justAfterPlantMs = v2EffectivePlantMs;
    const { rule: rule2 } = await getPlausibilityRuleAsOf(pool, 1, justAfterPlantMs);
    expect(rule2.coneLoG).toBe(1900);
  });

  it('discloses ruleChangedInPeriod when the window straddles the change', async () => {
    const pool = fakePool(rows);
    const { ruleChangedInPeriod } = await getPlausibilityRuleAsOf(
      pool, 1, plantDayEndMs('2026-08-20'), plantDayStartMs('2026-08-18'),
    );
    expect(ruleChangedInPeriod).toBe(true);
    // A window entirely between the two versions' own effective instants —
    // v1 started 2026-08-05, v2 starts 2026-08-19 — sees no change.
    const pool2 = fakePool(rows);
    const { ruleChangedInPeriod: unchanged } = await getPlausibilityRuleAsOf(
      pool2, 1, plantDayEndMs('2026-08-15'), plantDayStartMs('2026-08-10'),
    );
    expect(unchanged).toBe(false);
  });

  it('an empty history falls back to the documented default, not a crash', async () => {
    const pool = fakePool([]);
    const { rule, versionCount } = await getPlausibilityRuleAsOf(pool, 1, Date.now());
    expect(versionCount).toBe(0);
    expect(rule).toEqual({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
  });
});

describe('getWeightRuleAsOf — same pattern for weight_rule', () => {
  const rows = [
    { basis: 'net', tube: 72, tare: 0.6, effective_from: new Date('2026-08-19T10:00:00.000Z') },
    { basis: 'as_recorded', tube: 70, tare: 0.5, effective_from: new Date('2026-08-05T00:00:00.000Z') },
  ];

  it('resolves the basis in force at the period end, not the newest basis ever recorded', async () => {
    const pool = fakePool(rows);
    const before = await getWeightRuleAsOf(pool, 1, plantDayEndMs('2026-08-18'));
    expect(before.rule?.basis).toBe('as_recorded');
    const pool2 = fakePool(rows);
    const after = await getWeightRuleAsOf(pool2, 1, plantDayEndMs('2026-08-20'));
    expect(after.rule?.basis).toBe('net');
  });

  it('an empty table returns null, not a fabricated default — the caller states its own fallback', async () => {
    const pool = fakePool([]);
    const { rule, versionCount } = await getWeightRuleAsOf(pool, 1, Date.now());
    expect(rule).toBeNull();
    expect(versionCount).toBe(0);
  });
});
