/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): `getReconciliation`'s main
 * query ANDs `shiftRangeClause` in when the `shiftRange` argument is given.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getReconciliation } from './reconcile.js';
import type { ShiftRange } from '../shiftRange.js';
import type { StateContext } from './coneState.js';

interface Captured { sql: string; params: Map<string, unknown> }

const CTX: StateContext = {
  plausibility: { loG: 1500, hiG: 2100 },
  windows: [],
} as unknown as StateContext;

function fakePool(): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { params.set(name, v); return req; },
        query: async (sql: string) => {
          calls.push({ sql, params: new Map(params) });
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('getReconciliation — shiftRange wiring', () => {
  it('with shiftRange: the census query carries the shift-range params', async () => {
    const { pool, calls } = fakePool();
    await getReconciliation(pool, 1, '2026-09-01', '2026-09-05', null, CTX, RANGE);

    const census = calls.find((c) => c.sql.includes('FROM sms.cone_event') && !c.sql.includes('GROUP BY source_epoch'))!;
    expect(census.sql).toContain('@srFrom');
    expect(census.params.get('srFromOrd')).toBe(1);
    expect(census.params.get('srToOrd')).toBe(3);
  });

  it('without shiftRange: the census query carries no shift-range params', async () => {
    const { pool, calls } = fakePool();
    await getReconciliation(pool, 1, '2026-09-01', '2026-09-05', null, CTX);

    const census = calls.find((c) => c.sql.includes('FROM sms.cone_event') && !c.sql.includes('GROUP BY source_epoch'))!;
    expect(census.sql).not.toContain('@srFrom');
  });
});
