/**
 * C-158 (D-59): a period with zero sacks makes SQL SUM() return NULL for the
 * scale-verdict counts; that is not missing data and must not raise a data issue.
 * A group that DID weigh sacks but lacks the verdict counts still must.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool(sackRow: Record<string, unknown>): { pool: ConnectionPool; statements: Stmt[] } {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          inputs.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          statements.push({ sql, inputs: new Map(inputs) });
          if (sql.includes('UNION ALL') && sql.includes('GROUP BY source_epoch')) return { recordset: [] };
          if (sql.includes('FROM sms.cone_event') && sql.includes('SUM(CASE WHEN in_range=1')) {
            return { recordset: [{ grp: 'total', n: 0, inr: 0 }] };
          }
          if (sql.includes('FROM sms.reject_event re') && sql.includes('NOT EXISTS')) return { recordset: [] };
          if (sql.includes('FROM sms.reject_event WHERE')) return { recordset: [{ grp: 'total', n: 0 }] };
          if (sql.includes('FROM sms.sack_event')) return { recordset: [sackRow] };
          if (sql.includes('FROM sms.weight_rule')) return { recordset: [] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, statements };
}


describe('getProduction — zero sacks', () => {
  it('n = 0 with NULL verdict sums: no data issue, sacks 0, verdict not stated', async () => {
    const { pool } = fakePool({ grp: 'total', n: 0, kg: 0, judged: null, passed: null });
    const r = await getProduction(pool, 1, { groupBy: 'none', from: '2026-07-20', to: '2026-07-25' });
    expect(r.dataIssues.filter((i) => i.field === 'sacksPassedScalePct')).toEqual([]);
    expect(r.dataIssues).toEqual([]);
    expect(r.rows.find((x) => x.group === 'total')?.sacks ?? 0).toBe(0);
  });

  it('n = 3 with NULL judged: the issue is still raised', async () => {
    const { pool } = fakePool({ grp: 'total', n: 3, kg: 150, judged: null, passed: null });
    const r = await getProduction(pool, 1, { groupBy: 'none', from: '2026-07-20', to: '2026-07-25' });
    expect(r.dataIssues.some((i) => i.field === 'sacksPassedScalePct')).toBe(true);
  });
});
