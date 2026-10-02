/**
 * C-110 (D-89): a small by-day-code rate must not round to zero. One reject in
 * 2,437 inspected is 0.041 %; one-decimal rounding on the server printed 0.
 * Two decimals (the precision the report's daily figure already uses) keeps a
 * non-zero rate non-zero.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getRejectsByDayCode } from './rejects.js';

function pool(): ConnectionPool {
  const p = {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          if (sql.includes('FROM sms.source_epoch')) return { recordset: [{ epoch_id: 9, generation_ordinal: 3 }] };
          if (sql.includes('FROM sms.weight_rule') || sql.includes('FROM sms.sack_event')) return { recordset: [] };
          if (sql.includes('rc.reject_code_id') && sql.includes('AS day')) {
            return { recordset: [{ day: '2026-08-15', reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null, reject_code_id: null, label: null, is_pass: null, n: 1 }] };
          }
          if (sql.includes('AS grp')) return { recordset: [] };
          if (sql.includes('FROM sms.cone_event')) return { recordset: [{ day: '2026-08-15', n: 2437 }] };
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return req;
    },
  };
  return p as unknown as ConnectionPool;
}

describe('getRejectsByDayCode ratePct precision', () => {
  it('1 reject in 2,437 inspected is 0.04 %, not 0', async () => {
    const out = await getRejectsByDayCode(pool(), 1, { from: '2026-08-15', to: '2026-08-15' });
    expect(out.rows[0]!.inspected).toBe(2437);
    expect(out.rows[0]!.ratePct).toBe(0.04);
  });
});
