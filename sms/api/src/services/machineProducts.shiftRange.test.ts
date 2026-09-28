/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): `getMachineProductShifts`
 * ANDs `shiftRangeClause` into both the cell query and the no-station count
 * when `p.shiftRange` is given.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getMachineProductShifts } from './machineProducts.js';
import type { ShiftRange } from '../shiftRange.js';

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { params.set(name, v); return req; },
        query: async (sql: string) => { calls.push({ sql, params: new Map(params) }); return { recordset: [] }; },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('getMachineProductShifts — shiftRange wiring', () => {
  it('with shiftRange: the cell query and the no-station count both carry the shift-range params', async () => {
    const { pool, calls } = fakePool();
    await getMachineProductShifts(pool, 1, { from: '2026-09-01', to: '2026-09-05', shiftRange: RANGE });

    const cellQuery = calls.find((c) => c.sql.includes('FROM sms.cone_event c'))!;
    expect(cellQuery.sql).toContain('@srFrom');
    expect(cellQuery.params.get('srFromOrd')).toBe(1);

    const noStationQuery = calls.find((c) => c.sql.includes('source_station IS NULL'))!;
    expect(noStationQuery.sql).toContain('@srFrom');
    expect(noStationQuery.params.get('srToOrd')).toBe(3);
  });

  it('without shiftRange: neither query carries the shift-range params', async () => {
    const { pool, calls } = fakePool();
    await getMachineProductShifts(pool, 1, { from: '2026-09-01', to: '2026-09-05' });
    for (const c of calls) expect(c.sql).not.toContain('@srFrom');
  });
});
