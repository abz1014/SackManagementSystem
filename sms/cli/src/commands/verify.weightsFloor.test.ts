/**
 * C-026 (D-69): `verify --weights` ignored the archived floor (migration 037).
 * The count/checksum path scopes an open generation to `id >= floor` once the
 * source has pruned its oldest rows; the weight queries compared the source's
 * (pruned) table against the WHOLE raw epoch, so every weight check on a
 * pruned generation would read MISMATCH.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { verifyWeights, type WeightStats } from './verify.js';

interface Captured { sql: string; params: Map<string, unknown> }

const SLICE: WeightStats = { n: 3, sum: 5850, avg: 1950, min: 1940, max: 1960 };
const WHOLE: WeightStats = { n: 6, sum: 11700, avg: 1950, min: 1940, max: 1960 };

function pool(answer: (sql: string) => WeightStats): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const p = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params: new Map(params) });
          const w = answer(sql);
          return { recordset: [{ n: w.n, s: String(w.sum), a: String(w.avg), lo: w.min, hi: w.max }] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool: p, calls };
}

const CONE = {
  key: 'cone' as const,
  sourceTable: 'pack1_TP1U2',
  rawTable: 'sms_raw.cone_raw',
  systemCode: 'ifl_sql',
  columns: [
    { src: 'id', raw: 'src_id', type: 'int' as const },
    { src: 'Weight', raw: 'src_Weight', type: 'decimal' as const },
  ],
};

beforeEach(() => void vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('verifyWeights — the archived floor (C-026)', () => {
  it('scopes the source and raw weight queries to id >= floor, and still compares raw to canonical over the whole epoch', async () => {
    // Source holds only ids >= 4 (3 rows). Raw holds 1..6 whole; its id >= 4 slice equals the source.
    const ifl = pool(() => SLICE);
    const app = pool((sql) => {
      if (sql.includes('sms.cone_event')) return WHOLE;
      return sql.includes('@floor') ? SLICE : WHOLE;
    });
    const mismatches = await verifyWeights(
      { app: app.pool, ifl: ifl.pool },
      CONE,
      [{ epoch_id: 9, closed_utc: null, archived_below_id: 4 }],
      1,
      true,
    );
    expect(ifl.calls[0]!.sql).toMatch(/\[id\] >= @floor/);
    expect(ifl.calls[0]!.params.get('floor')).toBe(4);
    const rawCalls = app.calls.filter((c) => c.sql.includes('sms_raw.cone_raw'));
    expect(rawCalls.some((c) => /src_id >= @floor/.test(c.sql) && c.params.get('floor') === 4)).toBe(true);
    expect(mismatches).toBe(0);
  });

  it('without a floor nothing changes: no floor predicate anywhere', async () => {
    const ifl = pool(() => WHOLE);
    const app = pool(() => WHOLE);
    expect(await verifyWeights({ app: app.pool, ifl: ifl.pool }, CONE, [{ epoch_id: 9, closed_utc: null }], 1, true)).toBe(0);
    for (const c of [...ifl.calls, ...app.calls]) expect(c.sql).not.toMatch(/@floor/);
  });
});
