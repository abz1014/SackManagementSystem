/**
 * H8 (15 Sep 2026): every basis-aware figure must honour `sms.weight_rule
 * .basis` — the row Setup writes — not a hardcoded 'as_recorded'. This file
 * pins the one authoritative accessor the fix routes every report call site
 * through: `getWeights`'s own read of `weight_rule` (now also selecting
 * `basis`, alongside the tube/tare it already read), and the small
 * `getConfiguredBasis` accessor extracted from the same query for callers
 * that need only the basis (sack.ts under a shift filter).
 *
 * Same recording fake-pool idiom as weights.median.test.ts: SQL matched by
 * substring, only the branches a given test cares about are stubbed, and
 * `coneAdj`/`sackAdj` — the ONLY parameters `basis` can move — are read
 * back off the captured statements rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getConfiguredBasis, getWeights } from './weights.js';

interface Captured { sql: string; params: Map<string, unknown> }
const RULE = { cl: 1400, ch: 2200, sl: 40, sh: 60 };
// Same fixed stats fixture for cone and sack (both match `STDEV(weight`), so
// any difference between two calls in this file is attributable ONLY to the
// basis-driven coneAdj/sackAdj parameters, never to different input data.
const STAT_ROW = { n: 10, avg: 1952, mn: 1930, mx: 1975, sd: 8, excluded: 1 };

function fakePool(weightRuleRow: { basis: string; tube: number; tare: number } | null): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params });
          if (sql.includes('FROM sms.weight_rule')) return { recordset: weightRuleRow ? [weightRuleRow] : [] };
          if (sql.includes('FROM sms.plausibility_rule')) return { recordset: [RULE] };
          if (sql.includes('STDEV(weight')) return { recordset: [STAT_ROW] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const coneAdjOf = (calls: Captured[]) => calls.find((c) => c.sql.includes('STDEV(weight_g'))!.params.get('coneAdj');
const sackAdjOf = (calls: Captured[]) => calls.find((c) => c.sql.includes('STDEV(weight_kg'))!.params.get('sackAdj');

describe('getConfiguredBasis — the small accessor for callers that need only the basis', () => {
  it('reads `basis` off the newest weight_rule row', async () => {
    const { pool } = fakePool({ basis: 'net', tube: 70, tare: 0.5 });
    expect(await getConfiguredBasis(pool, 1)).toBe('net');
  });
  it('falls back to as_recorded when the table holds no row (should not happen post-seed, but must not crash)', async () => {
    const { pool } = fakePool(null);
    expect(await getConfiguredBasis(pool, 1)).toBe('as_recorded');
  });
  it('falls back to as_recorded on an unrecognised value rather than trusting an unvalidated column', async () => {
    const { pool } = fakePool({ basis: 'bogus', tube: 70, tare: 0.5 });
    expect(await getConfiguredBasis(pool, 1)).toBe('as_recorded');
  });
});

describe('getWeights — basis resolution (H8, 15 Sep 2026)', () => {
  it('omitting basis (undefined) uses the CONFIGURED basis, not a hardcoded default — this is the defect the report builders had', async () => {
    const { pool, calls } = fakePool({ basis: 'net', tube: 70, tare: 0.5 });
    const w = await getWeights(pool, 1, undefined, '2026-09-01', '2026-09-07');
    expect(w.basis).toBe('net');
    expect(coneAdjOf(calls)).toBe(70);
    expect(sackAdjOf(calls)).toBe(0.5);
  });
  it('an explicit basis argument still overrides the configured one (the /api/weights toggle route)', async () => {
    const { pool, calls } = fakePool({ basis: 'net', tube: 70, tare: 0.5 });
    const w = await getWeights(pool, 1, 'gross', '2026-09-01', '2026-09-07');
    expect(w.basis).toBe('gross');
    expect(coneAdjOf(calls)).toBe(0);
    expect(sackAdjOf(calls)).toBe(0);
  });
  it('sack net-basis arithmetic: sackAdj equals sack_tare_kg exactly — the same `rawKg - tareKg * sacks` rule sackStock.ts’s weighedKg() applies, here at the per-row level (weight_kg - @sackAdj) before aggregation', async () => {
    const { pool, calls } = fakePool({ basis: 'net', tube: 70, tare: 1.234 });
    await getWeights(pool, 1, undefined, '2026-09-01', '2026-09-07');
    expect(sackAdjOf(calls)).toBe(1.234);
  });
  it('cone net-basis arithmetic: coneAdj equals cone_tube_weight_g exactly', async () => {
    const { pool, calls } = fakePool({ basis: 'net', tube: 83, tare: 0.5 });
    await getWeights(pool, 1, undefined, '2026-09-01', '2026-09-07');
    expect(coneAdjOf(calls)).toBe(83);
  });

  it('REGRESSION GUARANTEE: with the configured basis "gross", every figure is byte-identical to the pre-H8 hardcoded "as_recorded" path', async () => {
    // Before H8, every report call site passed the literal 'as_recorded'.
    // Migration 035 configures 'gross', which this proves is arithmetically
    // identical — same coneAdj/sackAdj (both 0), so the SAME query runs and
    // the SAME numbers come back. Two independent pools (each call site's
    // own request objects) so neither run can leak state into the other.
    const before = fakePool({ basis: 'gross', tube: 70, tare: 0.5 });
    const after = fakePool({ basis: 'gross', tube: 70, tare: 0.5 });
    const wBefore = await getWeights(before.pool, 1, 'as_recorded', '2026-09-01', '2026-09-07');
    const wAfter = await getWeights(after.pool, 1, undefined, '2026-09-01', '2026-09-07');
    expect(coneAdjOf(before.calls)).toBe(0);
    expect(coneAdjOf(after.calls)).toBe(0);
    expect(sackAdjOf(before.calls)).toBe(0);
    expect(sackAdjOf(after.calls)).toBe(0);
    // Every FIGURE the two runs produced is identical (count/avg/median/min/
    // max/stdev/histogram/outliers/target/giveaway, both cone and sack).
    // `provisionalReasons` is excluded from the comparison deliberately: its
    // WORDING legitimately differs between 'gross' and 'as_recorded' (it says
    // so explicitly — "identical until IFL confirms otherwise") even though
    // every number it is talking about is unchanged, which is what this test
    // proves. `basis` itself is expected to differ: the whole point of H8 is
    // that the label stops lying about which basis actually ran.
    const fingerprint = (w: typeof wBefore) => {
      const { provisionalReasons: _pr, ...coneRest } = w.cone;
      return { cone: coneRest, sack: w.sack };
    };
    expect(fingerprint(wAfter)).toEqual(fingerprint(wBefore));
    expect(wBefore.basis).toBe('as_recorded');
    expect(wAfter.basis).toBe('gross');
  });
});
