/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): `getProduction` ANDs
 * `shiftRangeClause` into every table's WHERE when `p.shiftRange` is given,
 * and leaves every query exactly as before when it is absent — this file
 * pins both halves of that contract with a fake pool that records the SQL
 * text and bound parameters of every query issued, rather than asserting on
 * the response shape alone (already covered by production.presence.test.ts
 * and the other production.*.test.ts files).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';
import type { ShiftRange } from '../shiftRange.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool(): { pool: ConnectionPool; statements: Stmt[] } {
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
          if (sql.includes('FROM sms.sack_event')) return { recordset: [{ grp: 'total', n: 0, kg: 0, judged: 0, passed: 0 }] };
          if (sql.includes('FROM sms.weight_rule')) return { recordset: [] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, statements };
}

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('getProduction — shiftRange wiring', () => {
  it('with shiftRange: every table query carries the srFrom/srFromOrd/srTo/srToOrd params', async () => {
    const { pool, statements } = fakePool();
    await getProduction(pool, 1, { groupBy: 'none', shiftRange: RANGE });

    const tableQueries = statements.filter((s) =>
      /FROM sms\.(cone_event|reject_event|sack_event)/.test(s.sql) &&
      !s.sql.includes('NOT EXISTS') &&
      !s.sql.includes('GROUP BY source_epoch'),
    );
    expect(tableQueries.length).toBeGreaterThan(0);
    for (const s of tableQueries) {
      expect(s.sql).toContain('@srFrom');
      expect(s.sql).toContain('@srFromOrd');
      expect(s.sql).toContain('@srTo');
      expect(s.sql).toContain('@srToOrd');
      expect(s.inputs.get('srFrom')).toBe('2026-09-02');
      expect(s.inputs.get('srFromOrd')).toBe(1);
      expect(s.inputs.get('srTo')).toBe('2026-09-03');
      expect(s.inputs.get('srToOrd')).toBe(3);
    }
  });

  it('without shiftRange: no query carries the shift-range params — unchanged behaviour', async () => {
    const { pool, statements } = fakePool();
    await getProduction(pool, 1, { groupBy: 'none' });

    for (const s of statements) {
      expect(s.sql).not.toContain('@srFrom');
      expect(s.inputs.has('srFrom')).toBe(false);
    }
  });
});
