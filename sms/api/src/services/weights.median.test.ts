/**
 * Roadmap Phase 9 item 1 (15 Sep 2026): the median beside the mean, from
 * the SAME population predicate, on /api/weights (cones and sacks) and on
 * /api/spc (what the Weight screen prints). A recording fake pool answers
 * the median statements and the rule; the assertions are on the predicate
 * text, the bound bounds and the figure that comes back.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeights } from './weights.js';
import { getWeightSpc } from './spc.js';

interface Captured { sql: string; params: Map<string, unknown> }
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
          if (sql.includes('PERCENTILE_CONT') && sql.includes('sms.cone_event')) return { recordset: [{ med: 1951.25 }] };
          if (sql.includes('PERCENTILE_CONT') && sql.includes('sms.sack_event')) return { recordset: [{ med: 47.3 }] };
          if (sql.includes('STDEV(CAST(') && sql.includes(') excluded')) return { recordset: [{ n: 10, mean: 1952, sd: 8, excluded: 1 }] };
          if (sql.includes('STDEV(weight')) return { recordset: [{ n: 10, avg: 1952, mn: 1930, mx: 1975, sd: 8, excluded: 1 }] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

describe('median — the same population as the mean', () => {
  it('/api/weights: cones and sacks each carry a median from a PERCENTILE_CONT statement under the rule on file', async () => {
    const { pool, calls } = fakePool();
    const w = await getWeights(pool, 1, 'as_recorded', '2026-09-01', '2026-09-07');
    expect(w.cone.median).toBe(1951.25);
    expect(w.sack.median).toBe(47.3);
    const cone = calls.find((c) => c.sql.includes('PERCENTILE_CONT') && c.sql.includes('sms.cone_event'))!;
    expect(cone.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(cone.params.get('plausLo')).toBe(RULE.cl);
    expect(cone.params.get('plausHi')).toBe(RULE.ch);
    const sack = calls.find((c) => c.sql.includes('PERCENTILE_CONT') && c.sql.includes('sms.sack_event'))!;
    expect(sack.sql).toContain('weight_kg BETWEEN @plausLo AND @plausHi');
    expect(sack.params.get('plausLo')).toBe(RULE.sl);
  });

  it('/api/weights: the median is on the chosen basis, like the mean (net subtracts the tube inside ORDER BY)', async () => {
    const { pool, calls } = fakePool();
    await getWeights(pool, 1, 'net', '2026-09-01', '2026-09-07');
    const cone = calls.find((c) => c.sql.includes('PERCENTILE_CONT') && c.sql.includes('sms.cone_event'))!;
    expect(cone.sql).toContain('ORDER BY weight_g - @coneAdj');
    expect(cone.params.get('coneAdj')).toBe(70);
  });

  it('/api/spc: the median comes from its own statement over the SAME where-clause as the summary', async () => {
    const { pool, calls } = fakePool();
    const s = await getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-07', { usl: null, lsl: null, nominal: null, source: 'none' }, { coneLoG: 1400, coneHiG: 2200, sackLoKg: 40, sackHiKg: 60 });
    expect(s.median).toBe(1951.25);
    const med = calls.find((c) => c.sql.includes('PERCENTILE_CONT'))!;
    expect(med.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(med.params.get('plausLo')).toBe(1400);
  });

  it('/api/spc: null, not 0, for an empty period', async () => {
    const pool = {
      request: () => {
        const req = {
          input: () => req,
          query: async (sql: string) =>
            sql.includes('STDEV(CAST(') && sql.includes(') excluded') ? { recordset: [{ n: 0, mean: null, sd: null, excluded: 0 }] } : { recordset: [] },
        };
        return req;
      },
    } as unknown as ConnectionPool;
    const s = await getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-01', { usl: null, lsl: null, nominal: null, source: 'none' }, { coneLoG: 1400, coneHiG: 2200, sackLoKg: 40, sackHiKg: 60 });
    expect(s.median).toBeNull();
  });
});
