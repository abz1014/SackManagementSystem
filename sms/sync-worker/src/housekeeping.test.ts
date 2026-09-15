/**
 * housekeeping.ts (roadmap Phase 11, 14 Sep 2026): orphan reconciliation's
 * statement and its bounds, the persistent-failure streak's decisions, the
 * finding it raises and clears, and the size check — over a recording fake
 * pool, the way the other worker suites do.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  checkDatabaseSize,
  clearPersistentFailure,
  DATABASE_SIZE,
  FailureStreak,
  ORPHAN_REASON,
  PERSISTENT_SYNC_FAILURE,
  raisePersistentFailure,
  reconcileOrphanedRuns,
  sizeCheckDue,
  sizeWarning,
} from './housekeeping.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool(answers: { sizeMb?: number | null; orphans?: number } = {}) {
  const statements: Stmt[] = [];
  const pool = {
    statements,
    request() {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          statements.push({ sql, inputs: new Map(inputs) });
          if (/UPDATE sms\.sync_run/.test(sql)) return { recordset: [], rowsAffected: [answers.orphans ?? 0] };
          if (/sys\.database_files/.test(sql)) return { recordset: [{ size_mb: answers.sizeMb ?? null }], rowsAffected: [1] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

let pool: ReturnType<typeof fakePool>;
beforeEach(() => {
  pool = fakePool();
});

describe('reconcileOrphanedRuns', () => {
  it('closes only running rows older than the bound, as failed, with the orphan reason', async () => {
    pool = fakePool({ orphans: 3 });
    const n = await reconcileOrphanedRuns(pool, 1, 120);
    expect(n).toBe(3);
    const u = pool.statements[0]!;
    expect(u.sql).toMatch(/SET outcome = 'failed', error_text = @reason, finished_at_utc = SYSUTCDATETIME\(\)/);
    expect(u.sql).toMatch(/WHERE line_id = @line AND outcome = 'running' AND finished_at_utc IS NULL/);
    expect(u.sql).toMatch(/started_at_utc < DATEADD\(SECOND, -@age, SYSUTCDATETIME\(\)\)/);
    expect(u.inputs.get('line')).toBe(1);
    expect(u.inputs.get('age')).toBe(120);
    expect(u.inputs.get('reason')).toBe(ORPHAN_REASON);
    expect(ORPHAN_REASON).toBe('orphaned: the worker was restarted mid-pass');
  });
});

describe('FailureStreak — when to raise and when to clear', () => {
  it('raises exactly once, at the threshold, and not again while the streak continues', () => {
    const s = new FailureStreak(5);
    expect([s.fail(), s.fail(), s.fail(), s.fail()]).toEqual([false, false, false, false]);
    expect(s.fail()).toBe(true); // the fifth
    expect(s.fail()).toBe(false); // the sixth: already raised
    expect(s.length).toBe(6);
  });

  it('clears on the first success after a raised streak, and only once', () => {
    const s = new FailureStreak(2);
    s.succeed(); // first success after start: a previous process may have left one — clear
    s.fail();
    s.fail();
    expect(s.succeed()).toBe(true);
    expect(s.succeed()).toBe(false);
    expect(s.length).toBe(0);
  });

  it('the first success after start always clears (a finding may be standing from a previous process)', () => {
    const s = new FailureStreak(5);
    expect(s.succeed()).toBe(true);
    expect(s.succeed()).toBe(false);
  });

  it('a streak that never reached the threshold clears nothing', () => {
    const s = new FailureStreak(5);
    s.succeed();
    s.fail();
    s.fail();
    expect(s.succeed()).toBe(false);
  });

  it('refuses a nonsense threshold', () => {
    expect(() => new FailureStreak(0)).toThrow(/whole number/);
  });
});

describe('the persistent_sync_failure finding', () => {
  it('is CRITICAL, pass-level, deduplicated by a stable detail, and carries the streak as count', async () => {
    await raisePersistentFailure(pool, 5, 5, '[transient] source probe failed: ETIMEDOUT');
    const ins = pool.statements.find((s) => /INSERT INTO sms\.dq_finding/.test(s.sql))!;
    expect(ins).toBeDefined();
    expect(ins.inputs.get('check')).toBe(PERSISTENT_SYNC_FAILURE);
    expect(ins.inputs.get('sev')).toBe('CRITICAL');
    expect(ins.inputs.get('tbl')).toBeNull();
    expect(ins.sql).toMatch(/WHERE NOT EXISTS/); // persistFindings' dedupe
    expect(String(ins.inputs.get('detail'))).toMatch(/^5 or more sync passes in a row have failed or halted/);
    expect(String(ins.inputs.get('detail'))).toContain('ETIMEDOUT');
  });

  it('clearing deletes by check name only', async () => {
    await clearPersistentFailure(pool);
    const d = pool.statements[0]!;
    expect(d.sql).toMatch(/DELETE FROM sms\.dq_finding WHERE check_name = @check/);
    expect(d.inputs.get('check')).toBe(PERSISTENT_SYNC_FAILURE);
  });
});

describe('database size', () => {
  it('sizeWarning: null under 80 %, a sentence with MB and % at or over', () => {
    expect(sizeWarning(8100)).toBeNull();
    expect(sizeWarning(null)).toBeNull();
    const w = sizeWarning(8192)!;
    expect(w.pct).toBe(80);
    expect(w.detail).toMatch(/8192 MB, 80 % of SQL Server Express's 10 GB cap/);
    expect(w.detail).toMatch(/IFL/);
  });

  it('checkDatabaseSize clears then raises when over, clears alone when under', async () => {
    pool = fakePool({ sizeMb: 9000 });
    const over = await checkDatabaseSize(pool);
    expect(over).toEqual({ sizeMb: 9000, warned: true });
    const sqls = pool.statements.map((s) => s.sql);
    expect(sqls.some((q) => /sys\.database_files/.test(q))).toBe(true);
    const del = pool.statements.find((s) => /DELETE FROM sms\.dq_finding WHERE check_name/.test(s.sql))!;
    expect(del.inputs.get('check')).toBe(DATABASE_SIZE);
    const ins = pool.statements.find((s) => /INSERT INTO sms\.dq_finding/.test(s.sql))!;
    expect(ins.inputs.get('sev')).toBe('WARNING');
    expect(ins.inputs.get('check')).toBe(DATABASE_SIZE);

    pool = fakePool({ sizeMb: 100 });
    const under = await checkDatabaseSize(pool);
    expect(under).toEqual({ sizeMb: 100, warned: false });
    expect(pool.statements.some((s) => /INSERT INTO sms\.dq_finding/.test(s.sql))).toBe(false);
    expect(pool.statements.some((s) => /DELETE FROM sms\.dq_finding/.test(s.sql))).toBe(true);
  });

  it('sizeCheckDue: the first pass checks, then once an hour', () => {
    expect(sizeCheckDue(null, 0)).toBe(true);
    expect(sizeCheckDue(0, 59 * 60_000)).toBe(false);
    expect(sizeCheckDue(0, 60 * 60_000)).toBe(true);
  });
});
