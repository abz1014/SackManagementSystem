/**
 * ONE population rule across the weight services (roadmap Phase 4 item 3,
 * 14 Sep 2026).
 *
 * Before Phase 4, spc.ts filtered both plausibility bounds, weights.ts the
 * lower bound only, and production.ts none — so the same day had three
 * "cone populations" and "the app's average cone weight" was not one number.
 * This test drives the real services over a recording fake pool that answers
 * the plausibility rule with deliberately non-default bounds, then checks
 * that every cone-weight statistic each service issues carries the SAME
 * predicate text with the SAME bounds — and therefore excludes the same
 * readings from one shared dataset. The one permitted exception, the
 * outliers sample, is checked to be the exception it claims to be.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeights } from './weights.js';
import { getWeightSpc } from './spc.js';
import { getProduction } from './production.js';
import { getReconciliation } from './reconcile.js';
import { getPlausibilityRule } from './admin.js';

interface Captured { sql: string; params: Map<string, unknown> }

/** The rule on file for this test: NOT the 1500/2100 fallback, so a service that ignored the rule would show. */
const RULE = { cl: 1400, ch: 2200, sl: 40, sh: 60 };

function fakePool(): { pool: ConnectionPool; calls: Captured[] } {
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
          if (sql.includes('FROM sms.plausibility_rule')) return { recordset: [RULE] };
          // spc's summary must answer with a row; everything else may be empty.
          if (sql.includes('STDEV(CAST(') && sql.includes(') excluded')) return { recordset: [{ n: 0, mean: null, sd: null, excluded: 0 }] };
          if (sql.includes('STDEV(weight')) return { recordset: [{ n: 0, avg: null, mn: null, mx: null, sd: null, excluded: 0 }] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

/** A shared dataset of recorded cone weights, including the real faults (824 g; the 2,200-2,354 g population). */
const DATASET = [824, 1499, 1500, 1930, 1949, 1960, 1990, 2100, 2101, 2200, 2300, 2354];
const excludedBy = (lo: number, hi: number) => DATASET.filter((w) => w < lo || w > hi).length;

/** Every CONE call that binds the population predicate (sack queries bind the sack bounds). */
const populationCalls = (calls: Captured[]) => calls.filter((c) => c.params.has('plausLo') && c.sql.includes('sms.cone_event'));

describe('one population rule — weights, spc, production, reconciliation', () => {
  it('every cone-weight statistic in the three services binds the rule on file, not a constant', async () => {
    const services: { name: string; run: (pool: ConnectionPool) => Promise<unknown> }[] = [
      { name: 'weights', run: (pool) => getWeights(pool, 1, 'as_recorded', '2026-09-01', '2026-09-07') },
      {
        name: 'spc',
        run: async (pool) =>
          getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-07', { usl: null, lsl: null, nominal: null, source: 'none' }, await getPlausibilityRule(pool, 1)),
      },
      { name: 'production', run: (pool) => getProduction(pool, 1, { from: '2026-09-01', to: '2026-09-07', groupBy: 'none', withStates: true }) },
      { name: 'reconciliation', run: (pool) => getReconciliation(pool, 1, '2026-09-01', '2026-09-07') },
    ];
    const excludedCounts = new Map<string, number>();
    for (const svc of services) {
      const { pool, calls } = fakePool();
      await svc.run(pool);
      const pop = populationCalls(calls);
      expect(pop.length, `${svc.name} issued no query with the population predicate`).toBeGreaterThan(0);
      for (const c of pop) {
        expect(c.params.get('plausLo'), `${svc.name}: lower bound`).toBe(RULE.cl);
        expect(c.params.get('plausHi'), `${svc.name}: upper bound`).toBe(RULE.ch);
        expect(c.sql, `${svc.name}: predicate text`).toContain('weight_g BETWEEN @plausLo AND @plausHi');
      }
      excludedCounts.set(svc.name, excludedBy(pop[0]!.params.get('plausLo') as number, pop[0]!.params.get('plausHi') as number));
    }
    // The same dataset, the same bounds: the same excluded count, everywhere.
    const counts = [...excludedCounts.values()];
    expect(counts.every((n) => n === counts[0])).toBe(true);
    expect(counts[0]).toBe(excludedBy(RULE.cl, RULE.ch));
    expect(counts[0]).toBe(3); // 824, 2300 and 2354 — see the next case
  });

  it('the excluded count is what the rule says it is on this dataset', () => {
    // With the test rule 1400-2200: 824 out, 2300 out, 2354 out; 1499/1500/2100/2101/2200 all inside.
    expect(excludedBy(RULE.cl, RULE.ch)).toBe(3);
    // With the fallback rule 1500-2100 the same dataset also loses 1499, 2101 and 2200.
    expect(excludedBy(1500, 2100)).toBe(6);
  });

  it('weights.ts: the statistics use both bounds; the outlier sample is the deliberate exception', async () => {
    const { pool, calls } = fakePool();
    await getWeights(pool, 1, 'as_recorded');
    const stat = calls.find((c) => c.sql.includes('STDEV(weight_g'))!;
    expect(stat.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    // No lower-bound-only filter survives anywhere.
    for (const c of calls) expect(c.sql).not.toMatch(/weight_g >= @coneOut/);
    // The outliers query lists what the population excludes, and says so.
    const out = calls.find((c) => c.sql.includes('TOP 20 weight_g'))!;
    expect(out.sql).toContain('weight_g IS NOT NULL AND NOT (weight_g BETWEEN @plausLo AND @plausHi)');
  });

  it('spc.ts: reports how many readings the population excluded, from the same predicate', async () => {
    const { pool, calls } = fakePool();
    await getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-01', { usl: null, lsl: null, nominal: null, source: 'none' }, { coneLoG: 1400, coneHiG: 2200, sackLoKg: 40, sackHiKg: 60 });
    const summary = calls.find((c) => c.sql.includes('STDEV(CAST('))!;
    expect(summary.sql).toContain('NOT (weight_g BETWEEN @plausLo AND @plausHi)) excluded');
  });
});
