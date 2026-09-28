/**
 * Task P — unit tests for PdasWriter's echo-back mismatch path, the
 * addTubeType plausibility guards, and the vendor error-code mapping.
 * Companion to pdasWrite.test.ts (which covers the disabled path, the
 * PROC_PARAMS binding check, and the permission-denied echo-back READ
 * failure path — a different case from the echo-back MISMATCH this file
 * covers: here the read succeeds but returns a row that differs from what
 * was requested).
 *
 * Same offline idioms as pdasWrite.test.ts: `vi.mock('mssql', ...)` replaces
 * only `Transaction`/`Request` (needed by updateProductLimits's direct
 * `new mssql.Transaction`/`new mssql.Request` usage), a fake app pool that
 * records every statement, and a fake writer pool (PdasWriterOptions) that
 * never opens a real connection.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { PdasWriter, type ProductFields } from './pdasWrite.js';

vi.mock('mssql', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  class FakeRequest {
    private req: any;
    constructor(poolOrTx: any) {
      const pool = poolOrTx && poolOrTx.__fakePool ? poolOrTx.__fakePool : poolOrTx;
      this.req = pool.request();
    }
    input(...args: any[]) {
      this.req.input(...args);
      return this;
    }
    output(...args: any[]) {
      this.req.output?.(...args);
      return this;
    }
    query(...args: any[]) {
      return this.req.query(...args);
    }
    execute(...args: any[]) {
      return this.req.execute(...args);
    }
  }
  class FakeTransaction {
    __fakePool: any;
    constructor(pool: any) {
      this.__fakePool = pool;
    }
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest } };
});

interface Captured { sql: string; params: Record<string, unknown> }

function fakeAppPool(log: Captured[]): ConnectionPool {
  return {
    request: () => {
      const params: Record<string, unknown> = {};
      const req = {
        input: (name: string, _t: unknown, value: unknown) => {
          params[name] = value;
          return req;
        },
        query: async (sql: string) => {
          log.push({ sql, params: { ...params } });
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

const ACTOR = { userId: 7, username: 'manager' };
const BOUNDS = { setpointLoG: 1500, setpointHiG: 2100 };
const FIELDS: ProductFields = { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, desc1: '205-IL0-SD', desc2: 'Blue', active: true };
const REASON = 'Process engineer request, ticket 42';

const enabledCfg = {
  enabled: true,
  db: { server: 'nowhere', port: 1, database: 'x', user: 'x', password: 'x', encrypt: false, trustServerCertificate: true },
  disabledReason: null,
};

const changeRows = (log: Captured[]) => log.filter((c) => /INSERT INTO sms\.product_change/.test(c.sql));
const dqRows = (log: Captured[]) => log.filter((c) => /INSERT INTO sms\.dq_finding/.test(c.sql));

/* ============================================================================
 * 1. Echo-back MISMATCH after a limits UPDATE — updateProductLimits commits
 * the UPDATE, then reads the row back and finds it does NOT match what was
 * requested. This is a real defect class: a trigger, a concurrent write this
 * process didn't see, or truncation could all produce this. Distinct from
 * pdasWrite.test.ts's B2/RT24-05 tests, which cover the check-READ itself
 * throwing (never learned what PDAS holds) — here the read succeeds and
 * proves a mismatch.
 * ==========================================================================*/
describe('PdasWriter — updateProductLimits echo-back MISMATCH raises a CRITICAL finding and records observed_after_json', () => {
  /**
   * The in-transaction optimistic-concurrency read (before the UPDATE)
   * matches `before`; the UPDATE and nhs_events INSERT both succeed; the
   * POST-COMMIT echo-back read then returns a row that differs from `after`
   * — e.g. PDAS silently clamped or truncated a value. Never throws.
   */
  function fakeMismatchPool(before: ProductFields, observedAfterCommit: ProductFields): () => Promise<ConnectionPool> {
    let selectCount = 0;
    const pool = {
      request: () => {
        const req: { input: (n: string, ...r: unknown[]) => typeof req; query: (sql: string) => Promise<{ recordset: unknown[]; rowsAffected: number[] }> } = {
          input: () => req,
          query: async (sql: string) => {
            if (/SELECT MaterialSetpointWeight/.test(sql)) {
              selectCount += 1;
              const f = selectCount === 1 ? before : observedAfterCommit;
              return { recordset: [{ sp: f.setpointG, om: f.offsetMinusG, op: f.offsetPlusG, d1: f.desc1, d2: f.desc2, a: f.active }], rowsAffected: [1] };
            }
            // SET XACT_ABORT ON / UPDATE dbo.Materials / INSERT INTO dbo.nhs_events
            return { recordset: [], rowsAffected: [1] };
          },
        };
        return req;
      },
    };
    return async () => pool as unknown as ConnectionPool;
  }

  it('raises pdas_write_echo_mismatch (CRITICAL) and records the observed row in observed_after_json — not null, and not equal to what was requested', async () => {
    const log: Captured[] = [];
    const before = FIELDS;
    const after: ProductFields = { ...FIELDS, setpointG: 1965 };
    // PDAS committed 1965 as requested but the setpoint reads back as 1960 —
    // as though the write silently did not take, or something else changed
    // it between commit and read.
    const observedAfterCommit: ProductFields = { ...after, setpointG: 1960 };
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeMismatchPool(before, observedAfterCommit) });

    const r = await w.updateProductLimits({ productId: 20, before, after, bounds: BOUNDS, reason: REASON, actor: ACTOR });

    // The route/caller still gets a concrete result: the app returns what it
    // actually observed, not what it requested — the mismatch is real, so
    // pretending the request succeeded as asked would hide it from the caller.
    expect(r).toMatchObject({ ok: true, productId: 20, observedAfter: observedAfterCommit });

    const rows = changeRows(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.params.outcome).toBe('ok');
    expect(String(rows[0]?.params.msg)).toBe('echo-back differs from request — CRITICAL finding raised');
    // observed_after_json must be the OBSERVED row, not null and not `after`.
    expect(rows[0]?.params.obs).not.toBeNull();
    expect(JSON.parse(String(rows[0]?.params.obs))).toEqual(observedAfterCommit);

    const findings = dqRows(log);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.params.check).toBe('pdas_write_echo_mismatch');
    expect(findings[0]?.params.sev).toBe('CRITICAL');
    expect(findings[0]?.params.tbl).toBe('product');
    expect(String(findings[0]?.params.detail)).toContain('Product 20');
    expect(String(findings[0]?.params.detail)).toContain(JSON.stringify(observedAfterCommit));
    expect(String(findings[0]?.params.detail)).toContain(JSON.stringify(after));
  });

  it('a matching echo-back (the normal case) raises no finding and records the SAME row as observed_after_json', async () => {
    const log: Captured[] = [];
    const before = FIELDS;
    const after: ProductFields = { ...FIELDS, setpointG: 1965 };
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeMismatchPool(before, after) });

    const r = await w.updateProductLimits({ productId: 20, before, after, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: true, observedAfter: after });
    expect(dqRows(log)).toHaveLength(0);
    const rows = changeRows(log);
    expect(rows[0]?.params.msg).toBeNull();
    expect(JSON.parse(String(rows[0]?.params.obs))).toEqual(after);
  });
});

/* ============================================================================
 * 2. addTubeType plausibility guards — form 0/3 and weight 0/-1 must refuse
 * BEFORE any connection is opened (pdasWrite.ts ~1194-1203). The writer pool
 * passed in throws on ANY use, so a passing test here proves the procedure
 * was never called, not just that the eventual result was IMPLAUSIBLE.
 * ==========================================================================*/
describe('PdasWriter — addTubeType refuses an implausible form or weight before any connection is opened', () => {
  function poisonedWriterPool(): () => Promise<ConnectionPool> {
    return async () => {
      throw new Error('addTubeType must not open a connection when the request is IMPLAUSIBLE');
    };
  }

  it.each([
    { tubeForm: 0, tubeWeightG: 70, label: 'form 0 (the proc\'s own default, which its own check refuses)' },
    { tubeForm: 3, tubeWeightG: 70, label: 'form 3 (not 1 or 2)' },
  ])('tubeForm=$tubeForm ($label) -> IMPLAUSIBLE, never calls the procedure', async ({ tubeForm, tubeWeightG }) => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: poisonedWriterPool() });
    const r = await w.addTubeType({ tubeType: 'PP-Test', tubeWeightG, tubeForm: tubeForm as unknown as 1 | 2, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    if (!r.ok) expect(r.message).toMatch(/tube form must be 1 or 2/);
    const rows = changeRows(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.params.outcome).toBe('implausible');
  });

  it.each([
    { tubeWeightG: 0, label: 'weight 0' },
    { tubeWeightG: -1, label: 'weight -1' },
  ])('tubeWeightG=$tubeWeightG ($label) -> IMPLAUSIBLE, never calls the procedure', async ({ tubeWeightG }) => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: poisonedWriterPool() });
    const r = await w.addTubeType({ tubeType: 'PP-Test', tubeWeightG, tubeForm: 2, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    if (!r.ok) expect(r.message).toMatch(/tube weight .* must be more than 0/);
    const rows = changeRows(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.params.outcome).toBe('implausible');
  });
});

/* ============================================================================
 * 3. Vendor error-code mapping — a fake procedure EXECUTE that returns a
 * non-zero @error must map to PDAS_ERROR with explainPdasError's own text,
 * and must change nothing (the id output is never treated as real when
 * @error is non-zero). Covers -5001 (AddTubeType duplicate), -5002 (bad
 * form), -5003 (bad weight, PDAS's OWN check — distinct from this file's
 * client-side IMPLAUSIBLE guard above, which never reaches the procedure at
 * all), and -7001 (CreateMaterial duplicate triple).
 * ==========================================================================*/
describe('PdasWriter — vendor error codes map to PDAS_ERROR with explainPdasError\'s text', () => {
  /** A writer pool whose vendor-proc EXECUTE always answers with the given @error/@errorMsg and no id. */
  function fakeErrorProcPool(code: number, rawMsg: string | null): () => Promise<ConnectionPool> {
    const pool = {
      request: () => {
        const outputs: Record<string, unknown> = {};
        const req: {
          input: (name: string, ...rest: unknown[]) => typeof req;
          output: (name: string, ...rest: unknown[]) => typeof req;
          query: (sql: string) => Promise<{ recordset: unknown[]; rowsAffected: number[] }>;
          execute: (proc: string) => Promise<{ output: Record<string, unknown>; returnValue: number; recordset: unknown[] }>;
        } = {
          input: () => req,
          output: (name) => {
            outputs[name] = name === 'error' ? code : name === 'errorMsg' ? rawMsg : null;
            return req;
          },
          query: async () => ({ recordset: [], rowsAffected: [0] }),
          execute: async () => ({ output: outputs, returnValue: 0, recordset: [] }),
        };
        return req;
      },
    };
    return async () => pool as unknown as ConnectionPool;
  }

  it('AddTubeType: -5001 (duplicate name+form) -> PDAS_ERROR, "already has a tube type with this name and form"', async () => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeErrorProcPool(-5001, 'Tube type already exists') });
    const r = await w.addTubeType({ tubeType: 'RED', tubeWeightG: 70, tubeForm: 2, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'PDAS_ERROR', pdasErrorCode: -5001 });
    if (!r.ok) expect(r.message).toBe('PDAS already has a tube type with this name and form (compared case-insensitively). Choose the existing tube type instead.');
    expect(changeRows(log)[0]?.params.outcome).toBe('pdas_error');
    expect(changeRows(log)[0]?.params.code).toBe(-5001);
  });

  it('AddTubeType: -5002 (bad form, PDAS\'s OWN check) -> PDAS_ERROR, "the tube form: it must be 1 or 2"', async () => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeErrorProcPool(-5002, null) });
    // A plausible client-side value (2) so the client guard does not refuse
    // first — this exercises PDAS's OWN -5002, not this app's IMPLAUSIBLE path.
    const r = await w.addTubeType({ tubeType: 'PP-Test', tubeWeightG: 70, tubeForm: 2, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'PDAS_ERROR', pdasErrorCode: -5002 });
    if (!r.ok) expect(r.message).toBe('PDAS rejected the tube form: it must be 1 or 2.');
  });

  it('AddTubeType: -5003 (bad weight, PDAS\'s OWN check) -> PDAS_ERROR, "the tube weight: it must be more than zero"', async () => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeErrorProcPool(-5003, null) });
    const r = await w.addTubeType({ tubeType: 'PP-Test', tubeWeightG: 70, tubeForm: 2, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'PDAS_ERROR', pdasErrorCode: -5003 });
    if (!r.ok) expect(r.message).toBe('PDAS rejected the tube weight: it must be more than zero.');
  });

  it('CreateMaterial: -7001 (duplicate blend+count+tube triple) -> PDAS_ERROR, names the alternative', async () => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeErrorProcPool(-7001, 'Material already exist') });
    const r = await w.createProduct({ blendId: 2, countId: 8, tubeTypeId: 4, fields: FIELDS, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'PDAS_ERROR', pdasErrorCode: -7001 });
    if (!r.ok) {
      expect(r.message).toBe(
        'PDAS already has a product with this blend, count and tube type. It allows only one, active or not — ' +
          'change one of the three, or change the limits on the existing product instead.',
      );
    }
    expect(changeRows(log)[0]?.params.outcome).toBe('pdas_error');
    expect(changeRows(log)[0]?.params.code).toBe(-7001);
  });

  it('SetMaterialStatusActive: the SAME -7001 code means "no such MaterialId" for THIS proc, not "duplicate"', async () => {
    // explainPdasError's -7001 branch is proc-name-dependent — CreateMaterial's
    // duplicate-triple text above, vs this proc's "no such MaterialId" text.
    // Both are real, verified against the proc bodies (pdasWrite.ts header).
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeErrorProcPool(-7001, null) });
    const r = await w.setProductActive({ productId: 9999, active: false, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', pdasErrorCode: -7001 });
    if (!r.ok) expect(r.message).toBe('PDAS has no product with that number.');
  });
});
