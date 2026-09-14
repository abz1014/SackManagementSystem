/**
 * auditedWrite() on its own, with a fake pool whose transaction records the
 * order of begin / statements / commit / rollback. The route-level proof
 * (a 500 and a rollback when the audit row fails) is in app.config.test.ts;
 * this file pins the helper's contract for the next caller: what a work
 * function returns decides the audit row, and a noop writes nothing.
 */
import { describe, it, expect } from 'vitest';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { auditedWrite, recordAuditIn } from './audit.js';

interface Stmt { sql: string; params: Record<string, unknown> }

function fakePool(opts: { failOn?: RegExp } = {}) {
  const log: string[] = [];
  const stmts: Stmt[] = [];
  const request = () => {
    const params: Record<string, unknown> = {};
    const req = {
      input: (name: string, _t: unknown, value: unknown) => { params[name] = value; return req; },
      query: async (sql: string) => {
        stmts.push({ sql, params });
        log.push(`sql:${sql.trim().split(/\s+/).slice(0, 3).join(' ')}`);
        if (opts.failOn?.test(sql)) throw new Error(`fake failure on ${sql.slice(0, 20)}`);
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return req;
  };
  const tx = {
    begin: async () => { log.push('begin'); return tx; },
    commit: async () => { log.push('commit'); },
    rollback: async () => { log.push('rollback'); },
    request,
  };
  const pool = { request, transaction: () => tx } as unknown as ConnectionPool;
  return { pool, log, stmts };
}

const audit = (stmts: Stmt[]) => stmts.filter((s) => /INSERT INTO sms\.audit_log/.test(s.sql));

describe('auditedWrite', () => {
  it('runs the work, then the audit INSERT, then commits — and returns the work\'s result', async () => {
    const { pool, log, stmts } = fakePool();
    const out = await auditedWrite(pool, 7, { action: 'rule.weight', targetType: 'weight_rule', targetId: 1, detail: 'basis net' }, async (tx) => {
      await tx.request().input('x', mssql.Int, 1).query('INSERT INTO sms.weight_rule (x) VALUES (@x)');
      return { result: 42 };
    });
    expect(out).toBe(42);
    expect(log).toEqual(['begin', 'sql:INSERT INTO sms.weight_rule', 'sql:INSERT INTO sms.audit_log', 'commit']);
    const a = audit(stmts)[0]!;
    expect(a.params).toEqual({ actor: 7, action: 'rule.weight', type: 'weight_rule', target: '1', detail: 'basis net' });
  });

  it('the work may decide the detail and the target id after the write (an IDENTITY, an OUTPUT deleted.*)', async () => {
    const { pool, stmts } = fakePool();
    await auditedWrite(pool, 7, { action: 'machine.create', targetType: 'machine', targetId: null, detail: null }, async () => ({
      result: undefined, targetId: 101, detail: 'winder "Winder 15"',
    }));
    expect(audit(stmts)[0]!.params).toMatchObject({ target: '101', detail: 'winder "Winder 15"' });
  });

  it('a noop rolls back and writes NO audit row — no phantom entry for a change that did not happen', async () => {
    const { pool, log, stmts } = fakePool();
    const out = await auditedWrite(pool, 7, { action: 'station.rename', targetType: 'station', targetId: 999, detail: null }, async (tx) => {
      await tx.request().query('UPDATE sms.station SET name = @n WHERE station_id = 999');
      return { result: false, noop: true };
    });
    expect(out).toBe(false);
    expect(audit(stmts)).toEqual([]);
    expect(log).toEqual(['begin', 'sql:UPDATE sms.station SET', 'rollback']);
  });

  it('when the audit INSERT throws, everything is rolled back and the error reaches the caller', async () => {
    const { pool, log } = fakePool({ failOn: /audit_log/ });
    await expect(
      auditedWrite(pool, 7, { action: 'rule.shift', targetType: 'shift_rule', targetId: 1, detail: null }, async (tx) => {
        await tx.request().query('INSERT INTO sms.shift_rule (x) VALUES (1)');
        return { result: undefined };
      }),
    ).rejects.toThrow(/fake failure/);
    expect(log).toEqual(['begin', 'sql:INSERT INTO sms.shift_rule', 'sql:INSERT INTO sms.audit_log', 'rollback']);
    expect(log).not.toContain('commit');
  });

  it('when the work throws, nothing is audited and the error is rethrown unchanged', async () => {
    const { pool, log, stmts } = fakePool();
    const boom = Object.assign(new Error('dup'), { number: 2627 });
    await expect(
      auditedWrite(pool, 7, { action: 'user.create', targetType: 'user', targetId: 'x', detail: null }, async () => { throw boom; }),
    ).rejects.toBe(boom);
    expect(audit(stmts)).toEqual([]);
    expect(log).toEqual(['begin', 'rollback']);
  });

  it('recordAuditIn writes a second row inside the same transaction', async () => {
    const { pool, log, stmts } = fakePool();
    await auditedWrite(pool, 7, { action: 'station.rename', targetType: 'station', targetId: 2, detail: 'name "a" -> "b"' }, async (tx) => {
      await recordAuditIn(tx, 7, { action: 'station.link', targetType: 'station', targetId: 2, detail: 'machine_id 2 -> 1' });
      return { result: undefined };
    });
    expect(audit(stmts).map((s) => s.params.action)).toEqual(['station.link', 'station.rename']);
    expect(log.filter((l) => l === 'commit')).toHaveLength(1);
  });
});
