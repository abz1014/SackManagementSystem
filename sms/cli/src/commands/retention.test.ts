/**
 * `sms retention` (roadmap Phase 11 item 4 — core function 11, 14 Sep 2026)
 * over a recording fake pool: the dry run counts with the SAME predicates
 * the real run deletes with and issues no DELETE; the real run chunks its
 * deletes, writes the audit row with no actor, and never names audit_log,
 * product_change, a raw table or a canonical table in any statement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool(counts: Record<string, number>) {
  const statements: Stmt[] = [];
  const remaining = { ...counts };
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
          const table = /FROM (sms\.[a-z_]+)/.exec(sql)?.[1] ?? '';
          if (/^SELECT COUNT\(\*\)/.test(sql.trim())) return { recordset: [{ n: counts[table] ?? 0 }], rowsAffected: [1] };
          if (/^DELETE TOP \(5000\)/.test(sql.trim())) {
            const left = remaining[table] ?? 0;
            const n = Math.min(5000, left);
            remaining[table] = left - n;
            return { recordset: [], rowsAffected: [n] };
          }
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const world = { app: undefined as unknown as ReturnType<typeof fakePool> };

vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    cliLog: { error: () => {}, warn: () => {}, info: () => {}, child: () => ({}) },
    openContext: async () => ({ cfg: { lineId: 1, app: {} }, app: world.app, ifl: world.app, close: async () => {} }),
  };
});

const { retention, retentionPolicy, SYNC_RUN_WHERE, DQ_FINDING_WHERE, SESSION_WHERE, NEVER_PRUNED_NOTE } = await import('./retention.js');

const logs: string[] = [];
beforeEach(() => {
  world.app = fakePool({ 'sms.sync_run': 12000, 'sms.dq_finding': 40, 'sms.session': 3 });
  logs.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.RETENTION_SYNC_RUN_DAYS;
  delete process.env.RETENTION_DQ_FINDING_DAYS;
});
afterEach(() => vi.restoreAllMocks());

const FORBIDDEN = /audit_log|product_change|sms_raw\.|cone_event|sack_event|reject_event/;

describe('the predicates', () => {
  it('sync_run keeps the newest row per (line, target_table) and ages by started_at_utc', () => {
    expect(SYNC_RUN_WHERE).toMatch(/PARTITION BY line_id, target_table ORDER BY sync_run_id DESC/);
    expect(SYNC_RUN_WHERE).toMatch(/r\.rn > 1 AND r\.started_at_utc < DATEADD\(DAY, -@syncDays, SYSUTCDATETIME\(\)\)/);
  });
  it('dq_finding spares CRITICAL', () => {
    expect(DQ_FINDING_WHERE).toBe(`severity <> 'CRITICAL' AND detected_at_utc < DATEADD(DAY, -@dqDays, SYSUTCDATETIME())`);
  });
  it('sessions: expired only', () => {
    expect(SESSION_WHERE).toBe('expires_at_utc <= SYSUTCDATETIME()');
  });
  it('policy defaults 90 / 365 and refuses nonsense', () => {
    expect(retentionPolicy({})).toEqual({ syncRunDays: 90, dqFindingDays: 365 });
    expect(retentionPolicy({ RETENTION_SYNC_RUN_DAYS: '30', RETENTION_DQ_FINDING_DAYS: '400' })).toEqual({ syncRunDays: 30, dqFindingDays: 400 });
    expect(() => retentionPolicy({ RETENTION_SYNC_RUN_DAYS: 'ninety' })).toThrow(/whole number of days/);
    expect(() => retentionPolicy({ RETENTION_DQ_FINDING_DAYS: '0' })).toThrow(/at least 1/);
  });
});

describe('sms retention --dry-run', () => {
  it('counts with the real predicates, binds the policy, deletes nothing, and prints what it never prunes', async () => {
    process.env.RETENTION_SYNC_RUN_DAYS = '45';
    expect(await retention(['--dry-run'])).toBe(0);
    const stmts = world.app.statements;
    expect(stmts.every((s) => /^SELECT COUNT\(\*\)/.test(s.sql.trim()))).toBe(true);
    expect(stmts.some((s) => /^DELETE/.test(s.sql.trim()))).toBe(false);
    expect(stmts.some((s) => /audit_log/.test(s.sql))).toBe(false); // no audit row on a dry run
    const sync = stmts.find((s) => s.sql.includes('FROM sms.sync_run WHERE'))!;
    expect(sync.sql).toContain(SYNC_RUN_WHERE);
    expect(sync.inputs.get('syncDays')).toBe(45);
    const dq = stmts.find((s) => s.sql.includes('FROM sms.dq_finding WHERE'))!;
    expect(dq.sql).toContain(DQ_FINDING_WHERE);
    expect(dq.inputs.get('dqDays')).toBe(365);
    expect(stmts.find((s) => s.sql.includes('FROM sms.session WHERE'))!.sql).toContain(SESSION_WHERE);
    expect(logs.some((l) => /12000 rows would be deleted/.test(l))).toBe(true);
    expect(logs.some((l) => l.includes(NEVER_PRUNED_NOTE))).toBe(true);
    for (const s of stmts) expect(s.sql).not.toMatch(FORBIDDEN);
  });
});

describe('sms retention (real run)', () => {
  it('deletes in 5000-row chunks with the same WHERE, then writes retention.run with no actor', async () => {
    expect(await retention([])).toBe(0);
    const stmts = world.app.statements;
    const deletes = stmts.filter((s) => /^DELETE TOP \(5000\)/.test(s.sql.trim()));
    // 12000 sync_run rows = 3 chunks + 1 empty; 40 findings = 1 + 1; 3 sessions = 1 + 1
    expect(deletes.filter((s) => s.sql.includes('FROM sms.sync_run'))).toHaveLength(4);
    expect(deletes.filter((s) => s.sql.includes('FROM sms.dq_finding'))).toHaveLength(2);
    expect(deletes.filter((s) => s.sql.includes('FROM sms.session'))).toHaveLength(2);
    for (const d of deletes) {
      if (d.sql.includes('sms.sync_run')) expect(d.sql).toContain(SYNC_RUN_WHERE);
      if (d.sql.includes('sms.dq_finding')) expect(d.sql).toContain(DQ_FINDING_WHERE);
      if (d.sql.includes('sms.session')) expect(d.sql).toContain(SESSION_WHERE);
    }
    const audit = stmts.find((s) => /INSERT INTO sms\.audit_log/.test(s.sql))!;
    expect(audit).toBeDefined();
    expect(audit.sql).toMatch(/VALUES \(NULL, @action/);
    expect(audit.inputs.get('action')).toBe('retention.run');
    expect(String(audit.inputs.get('detail'))).toMatch(/sync_run 12000 \(>90d\), dq_finding 40 \(>365d, non-critical\), session 3 \(expired\)/);
    // Only the audit INSERT may name audit_log; nothing names the readings.
    for (const s of stmts.filter((x) => !/INSERT INTO sms\.audit_log/.test(x.sql))) expect(s.sql).not.toMatch(FORBIDDEN);
    expect(logs.some((l) => /12000 rows deleted/.test(l))).toBe(true);
  });
});
