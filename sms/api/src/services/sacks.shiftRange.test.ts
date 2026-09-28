/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): `getSackSummary`'s
 * `bindFilters` ANDs `shiftRangeClause` in when `q.shiftRange` is given.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getSackSummary } from './sacks.js';
import type { ShiftRange } from '../shiftRange.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function datasetPool(): { pool: ConnectionPool; statements: Stmt[] } {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) return { recordset: [] };
          statements.push({ sql, inputs: new Map(inputs) });
          if (sql.includes('sms.plausibility_rule')) return { recordset: [{ cl: 1500, ch: 2100, sl: 40, sh: 60 }] };
          if (sql.includes('sms.weight_rule')) return { recordset: [{ basis: 'as_recorded', tare: 0.5 }] };
          if (sql.includes('FROM sms.cone_event')) return { recordset: [{ n: 0 }] };
          if (sql.includes('no_attr')) return { recordset: [{ n: 0, no_attr: 0 }] };
          return { recordset: [{ grp: 'total', n: 0, kg: 0, inr: 0, noflag: 0, implausible: 0, plaus_kg: 0, plaus_n: 0 }] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool: pool as unknown as ConnectionPool, statements };
}

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('getSackSummary — shiftRange wiring', () => {
  it('with shiftRange: the sack/cone/unattributed queries all carry the shift-range params', async () => {
    const { pool, statements } = datasetPool();
    await getSackSummary(pool, 1, { from: '2026-09-01', to: '2026-09-05', shiftRange: RANGE });
    const sackQueries = statements.filter((s) => /FROM sms\.(sack_event|cone_event)/.test(s.sql));
    expect(sackQueries.length).toBeGreaterThan(0);
    for (const s of sackQueries) {
      expect(s.sql).toContain('@srFrom');
      expect(s.inputs.get('srFromOrd')).toBe(1);
      expect(s.inputs.get('srToOrd')).toBe(3);
    }
  });

  it('without shiftRange: no query carries the shift-range params', async () => {
    const { pool, statements } = datasetPool();
    await getSackSummary(pool, 1, { from: '2026-09-01', to: '2026-09-05' });
    for (const s of statements) expect(s.sql).not.toContain('@srFrom');
  });
});
