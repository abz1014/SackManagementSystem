/**
 * C-022 (D-68): once an ACKNOWLEDGED finding aged past the dq_finding window,
 * the prune's DELETE hit FK_dq_ack_finding (547); sync_run had already been
 * pruned unaudited, the session prune never ran and no retention.run audit row
 * was written, every night. Acknowledged findings must be excluded from the
 * prune so the acknowledgement trail is kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool() {
  const statements: Stmt[] = [];
  const done = new Set<string>();
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
          const s = sql.trim();
          const table = /FROM (sms\.[a-z_]+)/.exec(s)?.[1] ?? '';
          if (/^SELECT COUNT\(\*\)/.test(s)) return { recordset: [{ n: 1 }], rowsAffected: [1] };
          if (/^DELETE TOP \(5000\)/.test(s)) {
            // One acknowledged, aged-out finding is in the eligible set unless excluded.
            if (table === 'sms.dq_finding' && !/NOT EXISTS\s*\(\s*SELECT 1 FROM sms\.dq_acknowledgement/.test(s)) {
              throw new Error('The DELETE statement conflicted with the REFERENCE constraint "FK_dq_ack_finding" (547)');
            }
            if (done.has(table)) return { recordset: [], rowsAffected: [0] };
            done.add(table);
            return { recordset: [], rowsAffected: [1] };
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

const { retention, DQ_FINDING_WHERE } = await import('./retention.js');

beforeEach(() => {
  world.app = fakePool();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sms retention — acknowledged findings (C-022)', () => {
  it('the dq_finding predicate excludes findings that have an acknowledgement', () => {
    expect(DQ_FINDING_WHERE).toMatch(/NOT EXISTS \(SELECT 1 FROM sms\.dq_acknowledgement a WHERE a\.finding_id = sms\.dq_finding\.id\)/);
    expect(DQ_FINDING_WHERE).toMatch(/severity <> 'CRITICAL'/);
  });

  it('completes with an acknowledged old finding present: session prune runs and the audit row is written', async () => {
    expect(await retention([])).toBe(0);
    const stmts = world.app.statements;
    expect(stmts.some((s) => /^DELETE TOP \(5000\) FROM sms\.session/.test(s.sql.trim()))).toBe(true);
    const audit = stmts.find((s) => /INSERT INTO sms\.audit_log/.test(s.sql));
    expect(audit?.inputs.get('action')).toBe('retention.run');
  });
});
