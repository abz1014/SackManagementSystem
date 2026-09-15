/**
 * The two sack checks added by roadmap Phase 7 (15 Sep 2026): `sack_num_reset`
 * and `sack_blackout`. Pure functions with hand-made rows; the SQL helpers
 * over a recording fake pool. Kept out of dq.test.ts, which Phase 4 owns
 * this wave.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  CHECK_NAMES, PER_SUBJECT_CHECKS, countConesInGaps, detectSackBlackouts, loadPriorSackNums, sackBlackoutFindings,
  sackGaps, sackNumResetFindings, type SackAnchor,
} from './dq.js';

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 7, 6, 0, 0); // 7 Sep 2026 06:00 plant time

const sack = (sourceRowId: number, sackNum: number | null, epoch = 10, ms = T0 + sourceRowId * 60_000) => ({
  sack_num: sackNum,
  source_row_id: sourceRowId,
  source_epoch: epoch,
  production_ts_utc: new Date(ms),
  production_ts_utc_ms: ms,
  raw_id: 1000 + sourceRowId,
});

describe('sack_num_reset', () => {
  it('is registered as a check name and as a per-subject check, like station_not_in_roster', () => {
    expect(CHECK_NAMES).toContain('sack_num_reset');
    expect(CHECK_NAMES).toContain('sack_blackout');
    expect(PER_SUBJECT_CHECKS.has('sack_num_reset')).toBe(true);
    expect(PER_SUBJECT_CHECKS.has('sack_blackout')).toBe(true);
  });

  it('raises one INFO per reset within a generation, naming both rows and the time, with the offending raw_id', () => {
    const rows = [sack(1, 9650), sack(2, 9651), sack(3, 0), sack(4, 1), sack(5, 2)];
    const f = sackNumResetFindings(rows, new Map());
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ check_name: 'sack_num_reset', severity: 'INFO', subject_table: 'sack_event', count: 1, subject_ref: 1003 });
    expect(f[0]!.detail).toMatch(/from 9651 \(source row id 2\) to 0 at source row id 3, 2026-09-07 06:03:00 plant time \(generation 10\)/);
  });

  it('a new generation restarting at 1 is not a reset — the counter is compared within a generation only', () => {
    const rows = [sack(5461, 9651, 9), sack(5462, 9652, 9), sack(1, 1, 10), sack(2, 2, 10)];
    expect(sackNumResetFindings(rows, new Map())).toHaveLength(0);
  });

  it('a reset on the FIRST row of a batch is seen against the generation\'s newest canonical row', () => {
    const prior = new Map([[10, { sackNum: 4000, sourceRowId: 700 }]]);
    const f = sackNumResetFindings([sack(701, 3)], prior);
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toMatch(/from 4000 \(source row id 700\) to 3 at source row id 701/);
  });

  it('compares in source-id order whatever order the rows arrive in, and skips null SackNums without resetting the tracker', () => {
    const rows = [sack(3, 5), sack(1, 3), sack(2, null), sack(4, 1)];
    const f = sackNumResetFindings(rows, new Map());
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toMatch(/from 5 \(source row id 3\) to 1 at source row id 4/);
  });

  it('a clean, increasing stream raises nothing', () => {
    expect(sackNumResetFindings([sack(1, 10), sack(2, 11), sack(3, 11), sack(4, 12)], new Map())).toHaveLength(0);
  });
});

describe('sack_blackout', () => {
  const anchor = (ms: number, id: number): SackAnchor => ({ ms, rawId: 1000 + id, sourceRowId: id });

  it('finds the gaps longer than the threshold between consecutive sacks, and the open gap to the newest cone', () => {
    const gaps = sackGaps(
      [anchor(T0 + 1 * H, 2), anchor(T0 + 1.5 * H, 3), anchor(T0 + 7 * H, 4)],
      anchor(T0, 1),
      T0 + 12 * H,
      4 * H,
    );
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({ fromMs: T0 + 1.5 * H, toMs: T0 + 7 * H, fromSourceRowId: 3, fromRawId: 1003, open: false });
    expect(gaps[1]).toMatchObject({ fromMs: T0 + 7 * H, toMs: T0 + 12 * H, fromSourceRowId: 4, open: true });
  });

  it('an empty batch still yields the open gap from the newest canonical sack — a total blackout needs no new sack row', () => {
    const gaps = sackGaps([], anchor(T0, 9), T0 + 5 * H, 4 * H);
    expect(gaps).toEqual([{ fromMs: T0, toMs: T0 + 5 * H, fromRawId: 1009, fromSourceRowId: 9, open: true }]);
    // and no gap when the cones are not that far ahead, or there are no cones
    expect(sackGaps([], anchor(T0, 9), T0 + 3 * H, 4 * H)).toHaveLength(0);
    expect(sackGaps([], anchor(T0, 9), null, 4 * H)).toHaveLength(0);
    expect(sackGaps([], null, T0 + 30 * H, 4 * H)).toHaveLength(0);
  });

  it('skips clock-fault anchors before 2000 so the first real sack does not open a 56-year gap', () => {
    const gaps = sackGaps([anchor(Date.UTC(1970, 0, 1), 1), anchor(T0, 2)], null, T0 + H, 4 * H);
    expect(gaps).toHaveLength(0);
  });

  it('only a gap with cones inside it is a finding; the detail names where the gap starts and nothing that changes as it lasts', () => {
    const gaps = sackGaps([], anchor(T0, 9), T0 + 5 * H, 4 * H);
    expect(sackBlackoutFindings(gaps, [0], 4)).toHaveLength(0);
    const f = sackBlackoutFindings(gaps, [312], 4);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ check_name: 'sack_blackout', severity: 'WARNING', subject_table: 'sack_event', count: 312, subject_ref: 1009 });
    expect(f[0]!.detail).toBe(
      'no sack row after 2026-09-07 06:00:00 plant time (source row id 9) for more than 4 h while cones were being weighed — ' +
      'the sack acquisition trigger needs all four sack tags, so one missing tag stops every sack row, not one',
    );
    // the same gap, seen later and longer, produces the same detail — so persistFindings dedupes it
    const later = sackGaps([], anchor(T0, 9), T0 + 9 * H, 4 * H);
    expect(sackBlackoutFindings(later, [900], 4)[0]!.detail).toBe(f[0]!.detail);
    // and the same gap once closed by a later sack, too
    const closed = sackGaps([anchor(T0 + 9 * H, 10)], anchor(T0, 9), T0 + 9 * H, 4 * H);
    expect(sackBlackoutFindings(closed, [900], 4)[0]!.detail).toBe(f[0]!.detail);
  });
});

/* -------------------------------------------------------------- the SQL side */

interface Stmt { sql: string; inputs: Map<string, unknown> }
function recordingPool(answer: (sql: string, inputs: Map<string, unknown>) => unknown[]) {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          statements.push({ sql, inputs: new Map(inputs) });
          return { recordset: answer(sql, inputs) };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

describe('the sack checks over the database', () => {
  it('loadPriorSackNums asks once per generation for its newest row by source id', async () => {
    const { pool, statements } = recordingPool((sql, inputs) =>
      sql.includes('ORDER BY source_row_id DESC') ? [{ sack_num: inputs.get('epoch') === 10 ? 812 : null, source_row_id: 5435 }] : [],
    );
    const prior = await loadPriorSackNums(pool, 1, [10, 10, 9]);
    expect(statements).toHaveLength(2);
    expect(statements.map((s) => s.inputs.get('epoch'))).toEqual([10, 9]);
    expect(prior.get(10)).toEqual({ sackNum: 812, sourceRowId: 5435 });
    expect(prior.get(9)).toEqual({ sackNum: null, sourceRowId: 5435 });
  });

  it('countConesInGaps binds each gap as parameters, after its start and up to its end', async () => {
    const { pool, statements } = recordingPool(() => [{ n: 7 }]);
    const n = await countConesInGaps(pool, 1, [{ fromMs: 10, toMs: 20, fromRawId: null, fromSourceRowId: null, open: true }]);
    expect(n).toEqual([7]);
    expect(statements[0]!.sql).toMatch(/production_ts_utc_ms > @a AND production_ts_utc_ms <= @b/);
    expect(statements[0]!.inputs.get('a')).toBe(10);
    expect(statements[0]!.inputs.get('b')).toBe(20);
    expect(statements[0]!.inputs.get('line')).toBe(1);
  });

  it('detectSackBlackouts: newest cone from the database, gaps from the batch and the prior sack, one finding per gap with cones', async () => {
    const { pool } = recordingPool((sql) => {
      if (sql.includes('MAX(production_ts_utc_ms)')) return [{ m: T0 + 10 * H }];
      if (sql.includes('SELECT COUNT(*) n FROM sms.cone_event')) return [{ n: 40 }];
      return [];
    });
    const f = await detectSackBlackouts(pool, 1, [sack(2, 5, 10, T0 + 5 * H)], { ms: T0, rawId: 1001, sourceRowId: 1 }, 4);
    // T0 → T0+5h (closed, 40 cones) and T0+5h → T0+10h (open, 40 cones)
    expect(f).toHaveLength(2);
    expect(f[0]!.subject_ref).toBe(1001);
    expect(f[1]!.subject_ref).toBe(1002);
    expect(f.every((x) => x.check_name === 'sack_blackout' && x.count === 40)).toBe(true);
  });
});
