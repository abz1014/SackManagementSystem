/**
 * C-133 (D-83): `excludedClockFault` was structurally 0 on the rejected-cones, rejected-sacks and rejected-hangers reports.
 * A zeroed-clock record (production time at or before the epoch) carries shift_date 1969-12-31, which no period can
 * reach, so a count restricted by `shift_date BETWEEN @from AND @to` can never see it. The count now covers the
 * generation(s) the report reads, not the date window: a zeroed row cannot be placed in any period, so it belongs to
 * its generation's disclosure.
 *
 * A fake pool cannot execute a WHERE, so it behaves like the database for the one property under test: a query that
 * counts zeroed-clock rows (`production_ts_utc_ms <= 0`) sees the one zeroed row only when it has NO shift_date
 * predicate. Every other query answers as an empty period.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'IFL' }, unit: { name: 'Unit 2' } })) }));

import { getRejectedConesReport } from './rejectedCones.js';
import { getRejectedHangersReport } from './rejectedHangers.js';
import { listSacks } from '../sackCells.js';

/** A zeroed-clock row exists in the scope; shift_date-bounded queries cannot see it. */
const sees = (sql: string): boolean => !sql.includes('shift_date') && /production_ts_utc_ms\s*<=\s*0/.test(sql);

function pool(): ConnectionPool {
  return {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          if (sql.includes('GROUP BY source_epoch') || sql.includes('FROM sms.source_epoch')) return { recordset: [], rowsAffected: [0] };
          if (sees(sql)) return { recordset: [{ clock_fault: 1, clock: 1, n: 1, fault: 1 }], rowsAffected: [1] };
          if (sql.includes('sms.plausibility_rule')) return { recordset: [{ cl: 1500, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2000-01-01T00:00:00Z') }], rowsAffected: [1] };
          if (sql.includes('sms.weight_rule')) return { recordset: [{ basis: 'as_recorded', tube: 70, tare: 0, effective_from: new Date('2000-01-01T00:00:00Z') }], rowsAffected: [1] };
          if (sql.includes('AS listed')) return { recordset: [{ listed: 0, clock: 0 }], rowsAffected: [1] };
          if (sql.includes('COUNT(*) AS n')) return { recordset: [{ n: 0, fault: 0 }], rowsAffected: [1] };
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

const PERIOD = { period: 'custom' as const, from: '2026-06-22', to: '2026-07-10' };

describe('excludedClockFault counts the zeroed-clock rows of the generation, not of the date window (C-133)', () => {
  it('rejected-cones', async () => {
    const r = await getRejectedConesReport(pool(), 1, PERIOD, {});
    expect(r.excludedClockFault).toBe(1);
    expect(r.list).toEqual([]);
  });

  it('rejected-hangers', async () => {
    const r = await getRejectedHangersReport(pool(), 1, PERIOD, {});
    expect(r.excludedClockFault).toBe(1);
    expect(r.list).toEqual([]);
  });

  it('rejected-sacks (listSacks, which the report reads)', async () => {
    const r = await listSacks(pool(), 1, { from: '2026-06-22', to: '2026-07-10' }, { cap: 10, inRange: false });
    expect(r.excludedClockFault).toBe(1);
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
  });
});
