/**
 * The adapter contract (roadmap Phase 2 items 1-2, 14 Sep 2026):
 * classifyError sorts a driver failure into what the operator should do about
 * it; createAdapter is the one place a system code becomes a reader and
 * refuses any code it does not know (the PLC adapter is deliberately absent);
 * IflSqlAdapter's probe never throws and its columnList is the FULL list in
 * ordinal order.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { classifyError, createAdapter, isTransient, REGISTERED_SYSTEM_CODES } from './SourceAdapter.js';
import { IflSqlAdapter } from './IflSqlAdapter.js';
import { DEFAULT_IFL_TABLES } from './iflTables.js';

/** A node-mssql style error: `code` from the driver, `number` from the server. */
const mssqlError = (code?: string, number?: number, message = 'x'): Error => {
  const e = new Error(message) as Error & { code?: string; number?: number };
  if (code !== undefined) e.code = code;
  if (number !== undefined) e.number = number;
  return e;
};

describe('classifyError', () => {
  it('driver connection codes are transient', () => {
    for (const code of ['ESOCKET', 'ETIMEOUT', 'ECONNRESET', 'ECONNCLOSED']) {
      expect(classifyError(mssqlError(code))).toBe('transient');
    }
  });

  it('ELOGIN and the permission numbers are auth', () => {
    expect(classifyError(mssqlError('ELOGIN'))).toBe('auth');
    for (const n of [18456, 229, 230, 297]) expect(classifyError(mssqlError('EREQUEST', n))).toBe('auth');
  });

  it('invalid column / object / database are schema', () => {
    for (const n of [207, 208, 4060]) expect(classifyError(mssqlError('EREQUEST', n))).toBe('schema');
  });

  it('an EREQUEST wrapping a transient server number (deadlock, lock timeout) is transient', () => {
    expect(classifyError(mssqlError('EREQUEST', 1205))).toBe('transient');
    expect(classifyError(mssqlError('EREQUEST', 1222))).toBe('transient');
  });

  it('reads the server number from tedious’s originalError.info when it is not on the top level', () => {
    const e = new Error('Invalid object name') as Error & { code: string; originalError: unknown };
    e.code = 'EREQUEST';
    e.originalError = { info: { number: 208 } };
    expect(classifyError(e)).toBe('schema');
  });

  it("everything else — a gate's own Error, a string, null — is unknown and not retried", () => {
    expect(classifyError(new Error('Source generation changed for pack1_TP1U2'))).toBe('unknown');
    expect(classifyError('boom')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(mssqlError('EREQUEST', 50000))).toBe('unknown');
    expect(isTransient(new Error('x'))).toBe(false);
    expect(isTransient(mssqlError('ESOCKET'))).toBe(true);
  });
});

describe('createAdapter — the registry', () => {
  const def = DEFAULT_IFL_TABLES[0]!;
  const pool = {} as ConnectionPool;

  it("'ifl_sql' yields an IflSqlAdapter carrying the def and its system code", () => {
    const a = createAdapter('ifl_sql', pool, def);
    expect(a).toBeInstanceOf(IflSqlAdapter);
    expect(a.systemCode).toBe('ifl_sql');
    expect(a.def).toBe(def);
  });

  it('throws, naming the code and the deliberate absence of the PLC adapter, for anything else', () => {
    expect(() => createAdapter('plc_direct', pool, def)).toThrow(/No adapter is registered for source system "plc_direct"/);
    expect(() => createAdapter('plc_direct', pool, def)).toThrow(/deliberately not built/);
    expect(() => createAdapter('', pool, def)).toThrow(/No adapter is registered/);
    // Object.prototype names must not resolve to a factory either.
    expect(() => createAdapter('constructor', pool, def)).toThrow(/No adapter is registered/);
    expect(REGISTERED_SYSTEM_CODES).toEqual(['ifl_sql']);
  });
});

/** A pool whose one request answers `query` with whatever `answer` returns, or throws. */
function poolAnswering(answer: (sql: string, inputs: Map<string, unknown>) => unknown): ConnectionPool {
  return {
    request() {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          const r = answer(sql, inputs);
          if (r instanceof Error) throw r;
          return { recordset: r };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('IflSqlAdapter.probe', () => {
  const def = DEFAULT_IFL_TABLES[0]!;

  it('answers ok with a round trip when SELECT 1 + sys.tables succeed', async () => {
    const a = new IflSqlAdapter(poolAnswering(() => [{ one: 1, tables: 12 }]), def);
    const r = await a.probe();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roundTripMs).toBeGreaterThanOrEqual(0);
  });

  it('never throws: a refused login comes back classified as auth, with the message', async () => {
    const a = new IflSqlAdapter(poolAnswering(() => mssqlError('ELOGIN', 18456, 'Login failed for user sms_readonly')), def);
    const r = await a.probe();
    expect(r).toEqual({ ok: false, error: 'Login failed for user sms_readonly', classification: 'auth' });
  });
});

describe('IflSqlAdapter.columnList', () => {
  it('returns "name type" strings in the order the query gives them, for the schema-qualified table', async () => {
    const def = DEFAULT_IFL_TABLES[0]!;
    let seenSql = '';
    let seenTbl: unknown;
    const pool = poolAnswering((sql, inputs) => {
      seenSql = sql;
      seenTbl = inputs.get('tbl');
      return [
        { name: 'id', type: 'int' },
        { name: 'Date', type: 'datetime' },
        { name: 'MaterialId', type: 'int' },
      ];
    });
    const cols = await new IflSqlAdapter(pool, def).columnList();
    expect(cols).toEqual(['id int', 'Date datetime', 'MaterialId int']);
    expect(seenTbl).toBe('dbo.pack1_TP1U2');
    expect(seenSql).toMatch(/sys\.columns c\s+JOIN sys\.types t ON t\.user_type_id = c\.user_type_id/);
    expect(seenSql).toMatch(/OBJECT_ID\(@tbl\)/);
    expect(seenSql).toMatch(/ORDER BY c\.column_id/);
  });
});
