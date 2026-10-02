/**
 * C-021 (D-67): cutover cleared every reproducible row, then its DELETE on
 * sms.dq_finding hit FK_dq_ack_finding (547) before the audit row was written.
 */
/**
 * `sms cutover` gates (roadmap Phase 11 item 3, 14 Sep 2026): refuses
 * without `--backup` — before opening anything; refuses a path that is not
 * a .bak or does not exist; refuses while a pass is in flight — before any
 * DELETE; and deletes under the transform lock. The same guards module
 * serves `sms epoch:purge`; guards.test.ts covers its pure part.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool() {
  const statements: Stmt[] = [];
  const cleared = new Set<string>();
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
          if (/SELECT COUNT\(\*\) n FROM sms\.dq_acknowledgement/.test(sql)) return { recordset: [{ n: world.acks }], rowsAffected: [1] };
          if (/^DELETE FROM sms\.dq_acknowledgement/.test(sql.trim())) {
            const k = world.acks;
            world.acks = 0;
            return { recordset: [], rowsAffected: [k] };
          }
          if (/^DELETE FROM sms\.dq_finding/.test(sql.trim())) {
            if (world.acks > 0) throw new Error('The DELETE statement conflicted with the REFERENCE constraint "FK_dq_ack_finding" (547)');
            return { recordset: [], rowsAffected: [33] };
          }
          if (/SELECT COUNT\(\*\) n FROM sms\.source_epoch/.test(sql)) return { recordset: [{ n: 2 }], rowsAffected: [1] };
          if (/SELECT COUNT\(\*\) n FROM/.test(sql)) return { recordset: [{ n: 10 }], rowsAffected: [1] };
          if (/finished_at_utc IS NULL/.test(sql)) return { recordset: [{ n: world.inFlight }], rowsAffected: [1] };
          if (/^DELETE TOP \(5000\) FROM (\S+)/.test(sql.trim())) {
            const t = /FROM (\S+)/.exec(sql)![1]!;
            if (cleared.has(t)) return { recordset: [], rowsAffected: [0] };
            cleared.add(t);
            return { recordset: [], rowsAffected: [10] };
          }
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const world = { app: undefined as unknown as ReturnType<typeof fakePool>, inFlight: 0, opened: 0, lockHeld: 0, acks: 0 };

const resetTransformWatermarks = vi.fn(async (): Promise<void> => undefined);
vi.mock('@sms/sync-worker', () => ({
  loadSourceTables: async () => [{ sourceTable: 'pack1_TP1U2' }, { sourceTable: 'sack1_TP1U2' }],
  resetTransformWatermarks: () => resetTransformWatermarks(),
  withTransformLock: async (_c: unknown, fn: () => Promise<unknown>) => {
    world.lockHeld += 1;
    return fn();
  },
  TABLE_KINDS: ['cone', 'sack', 'reject_qcs', 'reject_weight'],
  TABLE_SHAPES: {
    cone: { rawTable: 'sms_raw.cone_raw' },
    sack: { rawTable: 'sms_raw.sack_raw' },
    reject_qcs: { rawTable: 'sms_raw.reject_qcs_raw' },
    reject_weight: { rawTable: 'sms_raw.reject_weight_raw' },
  },
}));
vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    cliLog: { error: () => {}, warn: () => {}, info: () => {}, child: () => ({}) },
    openContext: async () => {
      world.opened += 1;
      return { cfg: { lineId: 1, app: {} }, app: world.app, ifl: world.app, close: async () => {} };
    },
  };
});
// The backup file's existence, without touching the disk.
vi.mock('node:fs', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...real, existsSync: (p: string) => p === 'C:\\sms-backups\\sms-20260914-0200.bak' };
});

const { cutover } = await import('./cutover.js');

beforeEach(() => {
  world.app = fakePool();
  world.inFlight = 0;
  world.opened = 0;
  world.lockHeld = 0;
  world.acks = 0;
  resetTransformWatermarks.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const GOOD = '--backup=C:\\sms-backups\\sms-20260914-0200.bak';

describe('sms cutover — acknowledged findings (C-021)', () => {
  it('clears acknowledgements before the finding DELETE, so the FK cannot fail it, and still writes the audit row', async () => {
    world.acks = 1;
    expect(await cutover(['--confirm', GOOD])).toBe(0);
    const sqls = world.app.statements.map((s) => s.sql.trim());
    const ackDel = sqls.findIndex((q) => /^DELETE FROM sms\.dq_acknowledgement/.test(q));
    const findDel = sqls.findIndex((q) => /^DELETE FROM sms\.dq_finding/.test(q));
    expect(ackDel).toBeGreaterThanOrEqual(0);
    expect(findDel).toBeGreaterThan(ackDel);
    const audit = world.app.statements.find((s) => /INSERT INTO sms\.audit_log/.test(s.sql))!;
    expect(audit).toBeDefined();
    expect(String(audit.inputs.get('detail'))).toMatch(/1 acknowledgement/);
  });

  it('the confirmation printed before --confirm states how many acknowledgements will be cleared', async () => {
    world.acks = 3;
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
    expect(await cutover([GOOD])).toBe(2);
    expect(out.join('\n')).toMatch(/3\s+acknowledgement/);
  });
});
