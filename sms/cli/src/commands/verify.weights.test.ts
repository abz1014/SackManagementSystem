/**
 * `sms verify --weights` (roadmap Phase 4 item 3, 14 Sep 2026): the weight
 * aggregates reconciled source ⇄ raw ⇄ canonical per generation.
 *
 * The id checksum verify already runs proves the ROWS are the same; it says
 * nothing about a weight altered between the source and canonical. These
 * tests drive verifyWeights over fake pools that answer by which table the
 * aggregate is asked of, and pin: the three sides are asked for the same five
 * aggregates in the same units; a source-side difference on an OPEN epoch
 * is a MISMATCH; a closed epoch is compared raw ⇄ canonical only; a table
 * with no weight column is skipped, not failed; and the exact-vs-tolerant
 * comparison treats AVG as the one computed figure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { parseVerifyArgs, sameWeights, verifyWeights, type WeightStats } from './verify.js';

interface Captured { sql: string; params: Map<string, unknown> }

/** Answers by the FROM clause; records every query. */
function pool(answers: Record<string, WeightStats>): { pool: ConnectionPool; calls: Captured[] } {
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
          calls.push({ sql, params });
          const key = Object.keys(answers).find((k) => sql.includes(`FROM ${k}`));
          if (!key) throw new Error(`unexpected query: ${sql}`);
          const w = answers[key]!;
          // BIGINT/DECIMAL arrive from the driver as strings.
          return { recordset: [{ n: w.n, s: w.sum == null ? null : String(w.sum), a: w.avg == null ? null : String(w.avg), lo: w.min, hi: w.max }] };
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
const QCS = { ...CONE, key: 'reject_qcs' as const, sourceTable: 'rejectQCS1_TP1U2', rawTable: 'sms_raw.reject_qcs_raw', columns: [CONE.columns[0]!] };

const W: WeightStats = { n: 3, sum: 5850, avg: 1950, min: 1940, max: 1960 };
const W_ALTERED: WeightStats = { n: 3, sum: 5851, avg: 1950.333, min: 1940, max: 1961 };

let log: string[] = [];
beforeEach(() => {
  log = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    log.push(a.map(String).join(' '));
  });
});
afterEach(() => vi.restoreAllMocks());

describe('verifyWeights', () => {
  it('asks all three sides for COUNT, SUM, AVG, MIN, MAX of the weight in the same units, and passes when they agree', async () => {
    const ifl = pool({ '[pack1_TP1U2]': W });
    const app = pool({ 'sms_raw.cone_raw': W, 'sms.cone_event': W });
    const mismatches = await verifyWeights({ app: app.pool, ifl: ifl.pool }, CONE, [{ epoch_id: 9, closed_utc: null }], 1, true);
    expect(mismatches).toBe(0);
    expect(ifl.calls[0]!.sql).toMatch(/COUNT\(\[Weight\]\) n, SUM\(CAST\(\[Weight\] AS DECIMAL\(18,3\)\)\) s, AVG\(.*\) a, MIN\(\[Weight\]\) lo, MAX\(\[Weight\]\) hi/);
    expect(app.calls[0]!.sql).toContain('COUNT(src_Weight) n');
    expect(app.calls[0]!.params.get('e')).toBe(9);
    expect(app.calls[1]!.sql).toContain('COUNT(c.weight_g) n');
    expect(app.calls[1]!.sql).toContain('source_epoch = @e');
    expect(log.some((l) => l.includes('MISMATCH'))).toBe(false);
  });

  it('reports a MISMATCH when the source and raw differ on an open generation, even with the same count', async () => {
    const ifl = pool({ '[pack1_TP1U2]': W_ALTERED });
    const app = pool({ 'sms_raw.cone_raw': W, 'sms.cone_event': W });
    const mismatches = await verifyWeights({ app: app.pool, ifl: ifl.pool }, CONE, [{ epoch_id: 9, closed_utc: null }], 1, true);
    expect(mismatches).toBe(1);
    expect(log.some((l) => l.includes('raw') && l.includes('MISMATCH'))).toBe(true);
  });

  it('reports a MISMATCH when canonical differs from raw', async () => {
    const ifl = pool({ '[pack1_TP1U2]': W });
    const app = pool({ 'sms_raw.cone_raw': W, 'sms.cone_event': W_ALTERED });
    expect(await verifyWeights({ app: app.pool, ifl: ifl.pool }, CONE, [{ epoch_id: 9, closed_utc: null }], 1, true)).toBe(1);
  });

  it('never asks the source about a closed generation', async () => {
    const ifl = pool({ '[pack1_TP1U2]': W_ALTERED });
    const app = pool({ 'sms_raw.cone_raw': W, 'sms.cone_event': W });
    expect(await verifyWeights({ app: app.pool, ifl: ifl.pool }, CONE, [{ epoch_id: 1, closed_utc: new Date() }], 1, true)).toBe(0);
    expect(ifl.calls).toHaveLength(0);
  });

  it('uses weight_kg for sacks', async () => {
    const SACK = { ...CONE, key: 'sack' as const, sourceTable: 'sack1_TP1U2', rawTable: 'sms_raw.sack_raw' };
    const ifl = pool({ '[sack1_TP1U2]': W });
    const app = pool({ 'sms_raw.sack_raw': W, 'sms.sack_event': W });
    await verifyWeights({ app: app.pool, ifl: ifl.pool }, SACK, [{ epoch_id: 2, closed_utc: null }], 1, true);
    expect(app.calls[1]!.sql).toContain('c.weight_kg');
  });

  it('skips a table with no weight column rather than failing it', async () => {
    const ifl = pool({});
    const app = pool({});
    expect(await verifyWeights({ app: app.pool, ifl: ifl.pool }, QCS, [{ epoch_id: 3, closed_utc: null }], 1, true)).toBe(0);
    expect(app.calls).toHaveLength(0);
    expect(log.some((l) => l.includes('no weight column'))).toBe(true);
  });
});

describe('sameWeights', () => {
  it('is exact on count, sum, min and max, and tolerant to a thousandth on avg', () => {
    expect(sameWeights(W, { ...W, avg: 1950.0004 })).toBe(true);
    expect(sameWeights(W, { ...W, avg: 1950.001 })).toBe(false);
    expect(sameWeights(W, { ...W, sum: 5850.001 })).toBe(false);
    expect(sameWeights(W, { ...W, n: 4 })).toBe(false);
    expect(sameWeights({ n: 0, sum: null, avg: null, min: null, max: null }, { n: 0, sum: null, avg: null, min: null, max: null })).toBe(true);
  });
});

describe('parseVerifyArgs', () => {
  it('recognises --weights', () => {
    expect(parseVerifyArgs(['--weights'])).toEqual({ weights: true });
    expect(parseVerifyArgs([])).toEqual({ weights: false });
  });
});
