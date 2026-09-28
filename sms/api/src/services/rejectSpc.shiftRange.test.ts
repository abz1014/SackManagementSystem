/**
 * Chart overhaul wave 2 (Task TB1, 28 Sep 2026): getRejectSpc's
 * `RejectSpcFilters.shiftRange`. This trend is period-scoped throughout — no
 * fixed trailing/detector window lives in this file — so the range must
 * reach all four population queries (produced, rejects, allRejects,
 * unmatched). It is threaded through by putting `shiftRange` on the `base`
 * `RejectFilters` object and letting `bindConeFilters`/`bindRejectFilters`
 * (rejects.ts, Task TB2) apply it themselves — this file adds no second,
 * locally-duplicated AND clause, so these tests pin that the shape rejects.ts
 * already binds (`shiftRangeClause` on `shift_date`/`shift_code`, aliased
 * `re.` on the unmatched query) reaches every query this file issues.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getRejectSpc } from './rejectSpc.js';
import type { ShiftRange } from '../shiftRange.js';

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const bucketTs = new Date('2026-07-07T00:00:00.000Z');
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
          if (sql.includes('FROM sms.source_epoch')) return { recordset: [] };
          if (sql.includes('FROM sms.cone_event')) return { recordset: [{ bucket_ts: bucketTs, n: 100 }] };
          if (sql.includes('FROM sms.reject_event re')) return { recordset: [{ bucket_ts: bucketTs, n: 2 }] }; // unmatched
          if (sql.includes('FROM sms.reject_event')) return { recordset: [{ bucket_ts: bucketTs, n: 10 }] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const RANGE: ShiftRange = { from: '2026-07-07', fromShift: 'morning', to: '2026-07-07', toShift: 'evening' };

describe('getRejectSpc — shift range (Task TB1, via rejects.ts RejectFilters.shiftRange)', () => {
  it('absent: no query carries srFrom', async () => {
    const { pool, calls } = fakePool();
    await getRejectSpc(pool, 1, '2026-07-07', '2026-07-07', 'day', 'all');
    for (const c of calls) expect(c.params.has('srFrom')).toBe(false);
  });

  it('given: produced (cone_event), rejects (reject_event) and unmatched (reject_event re.) queries all carry the clause', async () => {
    const { pool, calls } = fakePool();
    await getRejectSpc(pool, 1, '2026-07-07', '2026-07-07', 'day', 'all', { shiftRange: RANGE });

    const coneCall = calls.find((c) => c.sql.includes('FROM sms.cone_event'))!;
    expect(coneCall.sql).toContain('shift_date');
    expect(coneCall.sql).toContain('@srFrom');
    expect(coneCall.params.get('srFrom')).toBe('2026-07-07');
    expect(coneCall.params.get('srFromOrd')).toBe(1); // morning
    expect(coneCall.params.get('srToOrd')).toBe(2); // evening

    const unmatchedCall = calls.find((c) => c.sql.includes('FROM sms.reject_event re'))!;
    expect(unmatchedCall.sql).toContain('re.shift_date');
    expect(unmatchedCall.sql).toContain('@srFrom');
  });

  it('given a narrowed numerator (a code filter), the separate all-rejects query also carries the clause', async () => {
    const { pool, calls } = fakePool();
    await getRejectSpc(pool, 1, '2026-07-07', '2026-07-07', 'day', 'weight', { shiftRange: RANGE });
    const rejectCalls = calls.filter((c) => c.sql.includes('FROM sms.reject_event') && !c.sql.includes('re.'));
    expect(rejectCalls.length).toBeGreaterThanOrEqual(1);
    for (const c of rejectCalls) expect(c.sql).toContain('@srFrom');
  });
});
