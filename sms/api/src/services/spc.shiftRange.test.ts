/**
 * Chart overhaul wave 2 (Task TB1, 28 Sep 2026): getWeightSpc's optional
 * `shiftRange` parameter. This is a fully period-scoped chart — no fixed
 * trailing/detector window lives in this file — so a shift range is ANDed
 * into every query's population filter alongside `from`/`to`, on the
 * `shift_date`/`shift_code` columns, and never applied when absent (byte-
 * identical to the pre-task behaviour).
 *
 * Also pins the new per-subgroup `firstShiftDate`/`firstShiftCode`/
 * `lastShiftDate`/`lastShiftCode` fields, decoded from the SQL-side
 * MIN/MAX composite shift key.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeightSpc, type SpecLimits } from './spc.js';
import type { ShiftRange } from '../shiftRange.js';

interface Captured { sql: string; params: Map<string, unknown> }

const SPEC: SpecLimits = { usl: null, lsl: null, nominal: null, source: 'none' };
const PLAUS = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

/** SQL-side encode of the composite shift key spc.ts's shiftKeyExpr computes,
 *  for building fixture subgroup rows and for checking the decode. */
function shiftKey(date: string, code: 'morning' | 'evening' | 'night'): number {
  const days = Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse('2000-01-01T00:00:00.000Z')) / 86_400_000);
  const ord = code === 'morning' ? 1 : code === 'evening' ? 2 : 3;
  return days * 10 + ord;
}

function fakePool(subgroups: { b: Date; n: number; mean: number; s: number | null; minShiftKey: number; maxShiftKey: number }[]): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
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
          if (sql.includes('LEFT JOIN sms.source_epoch')) return { recordset: [] };
          if (sql.includes('STDEV(CAST(') && sql.includes(') excluded')) {
            return {
              recordset: [
                {
                  n: 200, mean: 1975, sd: 8, excluded: 0,
                  minTs: new Date('2026-08-01T00:00:00Z'), maxTs: new Date('2026-08-10T00:00:00Z'), occDays: 10,
                },
              ],
            };
          }
          if (sql.includes('PERCENTILE_CONT')) return { recordset: [{ med: 1975 }] };
          if (sql.endsWith('ORDER BY b')) return { recordset: subgroups };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const RANGE: ShiftRange = { from: '2026-08-01', fromShift: 'evening', to: '2026-08-10', toShift: 'morning' };

describe('getWeightSpc — shift range (Task TB1)', () => {
  it('absent: no srFrom/srTo param and no shift-range clause on any query', async () => {
    const { pool, calls } = fakePool([
      { b: new Date('2026-08-01'), n: 200, mean: 1975, s: 8, minShiftKey: shiftKey('2026-08-01', 'morning'), maxShiftKey: shiftKey('2026-08-01', 'night') },
    ]);
    await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-10', SPEC, PLAUS);
    for (const c of calls) {
      expect(c.sql).not.toContain('srFrom');
      expect(c.params.has('srFrom')).toBe(false);
    }
  });

  it('given: the shift-range clause and its four params are on the summary, median and subgroup queries', async () => {
    const { pool, calls } = fakePool([
      { b: new Date('2026-08-01'), n: 200, mean: 1975, s: 8, minShiftKey: shiftKey('2026-08-01', 'evening'), maxShiftKey: shiftKey('2026-08-01', 'night') },
    ]);
    await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-10', SPEC, PLAUS, null, null, RANGE);

    const summaryCall = calls.find((c) => c.sql.includes('STDEV(CAST(') && c.sql.includes(') excluded'))!;
    expect(summaryCall.sql).toContain('shift_date');
    expect(summaryCall.sql).toContain('@srFrom');
    expect(summaryCall.sql).toContain('@srTo');
    expect(summaryCall.params.get('srFrom')).toBe('2026-08-01');
    expect(summaryCall.params.get('srTo')).toBe('2026-08-10');
    expect(summaryCall.params.get('srFromOrd')).toBe(2); // evening
    expect(summaryCall.params.get('srToOrd')).toBe(1); // morning

    const medianCall = calls.find((c) => c.sql.includes('PERCENTILE_CONT'))!;
    expect(medianCall.sql).toContain('@srFrom');
    expect(medianCall.params.get('srFrom')).toBe('2026-08-01');

    const subgroupCall = calls.find((c) => c.sql.endsWith('ORDER BY b'))!;
    expect(subgroupCall.sql).toContain('@srFrom');
    expect(subgroupCall.params.get('srToOrd')).toBe(1);
  });

  it('subgroups carry firstShiftDate/firstShiftCode/lastShiftDate/lastShiftCode decoded from the MIN/MAX shift key', async () => {
    const { pool } = fakePool([
      {
        b: new Date('2026-08-01'),
        n: 200,
        mean: 1975,
        s: 8,
        minShiftKey: shiftKey('2026-08-01', 'evening'),
        maxShiftKey: shiftKey('2026-08-02', 'night'),
      },
    ]);
    const data = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-10', SPEC, PLAUS, null, null, RANGE);
    expect(data.subgroups).toHaveLength(1);
    const g = data.subgroups[0]!;
    expect(g.firstShiftDate).toBe('2026-08-01');
    expect(g.firstShiftCode).toBe('evening');
    expect(g.lastShiftDate).toBe('2026-08-02');
    expect(g.lastShiftCode).toBe('night');
  });

  it('bucket sizing uses the effective (shift-narrowed) span: occDays/minTs/maxTs come from the shift-scoped summary query', async () => {
    // Summary response is fixed at occDays=10 regardless of shiftRange in this
    // fixture (the fake pool cannot itself narrow rows) — this test pins that
    // the summary query IS the one carrying the shift-range clause, so a real
    // database narrowing minTs/maxTs/occDays for that clause flows straight
    // into pickBucketMinutes with no separate, unscoped span query anywhere.
    const { pool, calls } = fakePool([
      { b: new Date('2026-08-01'), n: 200, mean: 1975, s: 8, minShiftKey: shiftKey('2026-08-01', 'morning'), maxShiftKey: shiftKey('2026-08-01', 'night') },
    ]);
    await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-10', SPEC, PLAUS, null, null, RANGE);
    const summaryCall = calls.find((c) => c.sql.includes('occDays'))!;
    expect(summaryCall.sql).toContain('@srFrom');
  });
});
