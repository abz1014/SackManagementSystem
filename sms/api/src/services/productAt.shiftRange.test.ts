/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): `productDisagreement`'s
 * final aggregate query ANDs `shiftRangeClause` in when `range.shiftRange`
 * is given.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { ProductTimeline, productDisagreement } from './productAt.js';
import type { ShiftRange } from '../shiftRange.js';

interface Captured { sql: string; params: Map<string, unknown> }

const RULE = { cl: 1500, ch: 2100, sl: 40, sh: 60 };

function fakePool(): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { params.set(name, v); return req; },
        query: async (sql: string) => {
          calls.push({ sql, params: new Map(params) });
          if (sql.includes('FROM sms.plausibility_rule')) return { recordset: [RULE] };
          if (sql.includes('AS passedOut')) return { recordset: [{ total: 0, judged: 0, passedOut: 0, rejectedIn: 0 }] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('productDisagreement — shiftRange wiring', () => {
  it('with shiftRange: the final aggregate query carries the shift-range params', async () => {
    const { pool, calls } = fakePool();
    const timeline = new ProductTimeline([]);
    await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-05', shiftRange: RANGE });

    const agg = calls.find((c) => c.sql.includes('AS passedOut'))!;
    expect(agg.sql).toContain('@srFrom');
    expect(agg.params.get('srFromOrd')).toBe(1);
    expect(agg.params.get('srToOrd')).toBe(3);
  });

  it('without shiftRange: the aggregate query carries no shift-range params', async () => {
    const { pool, calls } = fakePool();
    const timeline = new ProductTimeline([]);
    await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-05' });

    const agg = calls.find((c) => c.sql.includes('AS passedOut'))!;
    expect(agg.sql).not.toContain('@srFrom');
  });
});
