/**
 * C-130 (D-58): the shift-check sentence must cover the same cones as the
 * report beside it — the chosen shift, or the shift-bounded range — not the
 * whole production days.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getShiftCheck } from './shiftCheck.js';
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
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, statements };
}

const RANGE: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' };
const coneQueries = (s: Stmt[]) => s.filter((x) => x.sql.includes('FROM sms.cone_event') && x.sql.includes('shift_code_legacy'));

describe('getShiftCheck — scope', () => {
  it('with a shift: both queries bind @shift and filter on shift_code', async () => {
    const { pool, statements } = fakePool();
    await getShiftCheck(pool, 1, '2026-08-19', '2026-08-19', { shift: 'night' });
    const q = coneQueries(statements);
    expect(q.length).toBe(2);
    for (const s of q) {
      expect(s.sql).toContain('shift_code = @shift');
      expect(s.inputs.get('shift')).toBe('night');
    }
  });

  it('with a shift range: both queries bind the range bounds', async () => {
    const { pool, statements } = fakePool();
    await getShiftCheck(pool, 1, '2026-09-01', '2026-09-02', { shiftRange: RANGE });
    const q = coneQueries(statements);
    expect(q.length).toBe(2);
    for (const s of q) {
      expect(s.sql).toContain('@srFrom');
      expect(s.inputs.get('srFrom')).toBe('2026-09-01');
      expect(s.inputs.get('srFromOrd')).toBe(2);
      expect(s.inputs.get('srTo')).toBe('2026-09-02');
      expect(s.inputs.get('srToOrd')).toBe(1);
    }
  });

  it('with neither: no shift or range predicate (whole production days, as before)', async () => {
    const { pool, statements } = fakePool();
    await getShiftCheck(pool, 1, '2026-08-19', '2026-08-19');
    for (const s of coneQueries(statements)) {
      expect(s.sql).not.toContain('@shift');
      expect(s.sql).not.toContain('@srFrom');
    }
  });
});
