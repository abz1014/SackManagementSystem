/**
 * Chart overhaul wave 2 (Task TB1, 28 Sep 2026): getWeights' optional
 * `shiftRange` parameter. This is a fully period-scoped distribution — no
 * fixed trailing/detector window lives in this file — so the range is ANDed
 * into `dateWhere` alongside `from`/`to`, for BOTH the cone and the sack
 * population, on every statement (stat, median, histogram, outliers).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeights } from './weights.js';
import type { ShiftRange } from '../shiftRange.js';

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
          calls.push({ sql, params: new Map(params) });
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

const RANGE: ShiftRange = { from: '2026-09-01', fromShift: 'night', to: '2026-09-07', toShift: 'evening' };

describe('getWeights — shift range (Task TB1)', () => {
  it('absent: no query carries srFrom', async () => {
    const { pool, calls } = fakePool();
    await getWeights(pool, 1, 'as_recorded', '2026-09-01', '2026-09-07');
    for (const c of calls) expect(c.params.has('srFrom')).toBe(false);
  });

  it('given: cone_event AND sack_event statements both carry the clause and its four params', async () => {
    const { pool, calls } = fakePool();
    await getWeights(pool, 1, 'as_recorded', '2026-09-01', '2026-09-07', RANGE);

    const coneStat = calls.find((c) => c.sql.includes('STDEV(weight') && c.sql.includes('sms.cone_event'))!;
    expect(coneStat.sql).toContain('shift_date');
    expect(coneStat.sql).toContain('@srFrom');
    expect(coneStat.params.get('srFrom')).toBe('2026-09-01');
    expect(coneStat.params.get('srTo')).toBe('2026-09-07');
    expect(coneStat.params.get('srFromOrd')).toBe(3); // night
    expect(coneStat.params.get('srToOrd')).toBe(2); // evening

    const sackStat = calls.find((c) => c.sql.includes('STDEV(weight') && c.sql.includes('sms.sack_event'))!;
    expect(sackStat.sql).toContain('@srFrom');
    expect(sackStat.params.get('srFrom')).toBe('2026-09-01');

    const coneMed = calls.find((c) => c.sql.includes('PERCENTILE_CONT') && c.sql.includes('sms.cone_event'))!;
    expect(coneMed.sql).toContain('@srFrom');
  });
});
