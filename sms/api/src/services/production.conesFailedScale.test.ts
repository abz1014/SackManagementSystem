/**
 * conesFailedScale: every cone whose scale in-range bit is 0, a plain
 * non-exclusive count. It is NOT states.rejected, which sends a scale-flagged
 * cone with an implausible weight to 'unknown'. It must equal the summary's
 * cones_rejected_by_scale (register.ts countEvents with inRange:false).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction, type ProductionParams } from './production.js';
import { countEvents } from './register.js';
import type { StateContext } from './coneState.js';

interface Cone { inRange: 0 | 1; weightG: number }
// 2 plausible scale-flagged, 1 scale-flagged with an implausible weight, 5 passed.
const FIXTURE: Cone[] = [
  { inRange: 0, weightG: 2040 }, { inRange: 0, weightG: 1850 }, { inRange: 0, weightG: 9999 },
  ...Array.from({ length: 5 }, () => ({ inRange: 1 as const, weightG: 1950 })),
];
const CTX: StateContext = {
  plausibility: { loG: 1500, hiG: 2100 },
  windows: [{ materialId: 14, fromMs: null, toMs: null, loG: 1930, hiG: 1990, assumedStart: false }],
};
const plausible = (c: Cone) => c.weightG >= 1500 && c.weightG <= 2100;

function fakePool(cones: Cone[]): ConnectionPool {
  return {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (k: string, a: unknown, b?: unknown) => { params.set(k, b === undefined ? a : b); return req; },
        query: async (sql: string) => {
          if (sql.includes('AS tbl, source_epoch AS epoch_id') || (sql.includes('UNION ALL') && sql.includes('GROUP BY source_epoch'))) {
            return { recordset: [] };
          }
          if (params.has('inRange') && sql.includes('COUNT(*) n')) {
            const want = params.get('inRange') ? 1 : 0;
            return { recordset: [{ n: cones.filter((c) => c.inRange === want).length }] };
          }
          if (sql.includes('SUM(CASE WHEN in_range=1')) {
            return { recordset: [{
              grp: 'total', n: cones.length,
              inr: cones.filter((c) => c.inRange === 1).length,
              failed: cones.filter((c) => c.inRange === 0).length,
            }] };
          }
          if (sql.includes('GROUP BY CASE')) {
            const rejected = cones.filter((c) => c.inRange === 0 && plausible(c)).length;
            const implausible = cones.filter((c) => !plausible(c)).length;
            return { recordset: [
              { state: 'within', n: cones.filter((c) => c.inRange === 1).length, implausible: 0 },
              { state: 'rejected', n: rejected, implausible: 0 },
              { state: 'unknown', n: implausible, implausible },
            ] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

const P: ProductionParams = { groupBy: 'none', withStates: true, stateContext: CTX };

describe('getProduction conesFailedScale', () => {
  it('counts the scale-flagged cone with an implausible weight that states.rejected leaves out', async () => {
    const r = await getProduction(fakePool(FIXTURE), 1, P);
    expect(r.rows[0]!.cones).toBe(8);
    expect(r.rows[0]!.conesFailedScale).toBe(3);
    expect(r.states!.rejected).toBe(2);
    expect(r.states!.unknown).toBe(1);
  });

  it('equals the summary count of cones the scale marked out of range (countEvents inRange:false)', async () => {
    const pool = fakePool(FIXTURE);
    const r = await getProduction(pool, 1, P);
    const summary = await countEvents(pool, 1, 'cone', { inRange: false });
    expect(r.rows[0]!.conesFailedScale).toBe(summary.count);
  });

  it('is 0 (not absent) for a group with no cones', async () => {
    const r = await getProduction(fakePool([]), 1, { groupBy: 'none' });
    expect(r.rows[0]!.conesFailedScale).toBe(0);
  });

  it('is sent as parameter-free SQL over the same cone query', async () => {
    const sqls: string[] = [];
    const base = fakePool(FIXTURE);
    const spy = { request: () => { const q = base.request(); const orig = q.query.bind(q); (q as any).query = (s: string) => { sqls.push(s); return orig(s); }; return q; } } as unknown as ConnectionPool;
    await getProduction(spy, 1, { groupBy: 'none' });
    expect(sqls.some((s) => s.includes('SUM(CASE WHEN in_range = 0 THEN 1 ELSE 0 END) failed'))).toBe(true);
  });
});
