/**
 * The PDAS write path's guards (SEPT-2026-EPOCH-DECISION §5.4) — everything
 * that must refuse BEFORE a writable connection to PDAS is ever opened.
 *
 * These run entirely offline: the disabled path never touches a writer pool,
 * and the validation paths refuse before `pool()` is reached. The transaction
 * paths (conflict, single-row assert, echo-back) need a real PDAS with the
 * `sms_pdas_writer` login IFL has not yet provisioned, so they are exercised
 * only when that exists — and the flag stays false until then (§6.2).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { PdasWriter, PROC_PARAMS, type ProductFields, type VendorProc } from './pdasWrite.js';

/**
 * updateProductLimits is the only method that uses `new mssql.Transaction(...)`
 * / `new mssql.Request(...)` directly rather than `pool.request()` off a
 * duck-typed ConnectionPool, so it is the only place this file needs to
 * replace those two real mssql classes to drive it offline. Everything else
 * mssql exports (Int, Float, NVarChar, Decimal, ...) stays real — those are
 * only ever used as inert type-marker values/factories the fake `.input()`/
 * `.output()` below ignore. FakeRequest just forwards to whatever `.request()`
 * the underlying fake pool already provides (the same fake pool shape every
 * other test in this file uses), and FakeTransaction is a no-op wrapper
 * around that pool — this test does not need real transactional semantics,
 * only the code path through `updateProductLimits`.
 */
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

/** App pool that records every statement and answers nothing. */
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
          log.push({ sql, params });
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

/**
 * A writer pool (see PdasWriterOptions.writerPool) whose `execute` records
 * every `.input()` / `.output()` parameter name bound before it, keyed by the
 * proc name it was called with — the raw evidence the PROC_PARAMS subset test
 * below checks. It never opens a real connection and never runs against PDAS.
 *
 * `query()` (the post-write echo-back reads — readPallet, and the Blend/Count/
 * TubeType SELECTs — plus updateProductLimits's own SELECT/UPDATE, which this
 * test does not exercise) answers every call with the same permissive row:
 * every column any echo-back query might select is present with a harmless
 * value, so whichever columns a given method reads back never hits `undefined`
 * (addTubeType's echo comparison calls `.trim()` on what it reads, for
 * instance). The exact echo values are not what this test is checking — only
 * that every real method call completes and that PROC_PARAMS matches what got
 * bound to `.execute()`.
 */
function fakeWriterPool(calls: Array<{ proc: string; params: string[] }>): () => Promise<ConnectionPool> {
  const echoRow = {
    Blend: 'x', Count: 'x', TubeType: 'x', TubeWeight: 0, TubeForm: 1,
    MaterialId: 1, PackSchemaId: 1, Lot: 'L', SteamProg: 0, LabelType: 1, Routing: 0,
    PalletActive: true, PalletDesc1: '', PalletDesc2: '', PalletDesc3: '', PalletDesc4: '', PalletDesc5: '',
    Timestamp: new Date(),
  };
  const pool = {
    request: () => {
      const names: string[] = [];
      const outputs: Record<string, unknown> = {};
      const req: {
        input: (name: string, ...rest: unknown[]) => typeof req;
        output: (name: string, ...rest: unknown[]) => typeof req;
        query: (sql: string) => Promise<{ recordset: unknown[]; rowsAffected: number[] }>;
        execute: (proc: string) => Promise<{ output: Record<string, unknown>; returnValue: number; recordset: unknown[] }>;
      } = {
        input: (name) => {
          names.push(name);
          return req;
        },
        output: (name) => {
          names.push(name);
          outputs[name] = name === 'error' ? 0 : name === 'errorMsg' ? null : 1;
          return req;
        },
        query: async () => ({ recordset: [echoRow], rowsAffected: [1] }),
        execute: async (proc) => {
          calls.push({ proc: proc.replace(/^dbo\./, ''), params: [...names] });
          return { output: outputs, returnValue: outputs.error === 0 ? 1 : 0, recordset: [] };
        },
      };
      return req;
    },
  };
  return async () => pool as unknown as ConnectionPool;
}

const ACTOR = { userId: 7, username: 'manager' };
const BOUNDS = { setpointLoG: 1500, setpointHiG: 2100 };
const FIELDS: ProductFields = { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, desc1: '205-IL0-SD', desc2: 'Blue', active: true };
const REASON = 'Process engineer request, ticket 42';

const disabledCfg = { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' };
// "Enabled" with a login that would fail if ever opened. It must never be opened
// by any test here — validation refuses first.
const enabledCfg = {
  enabled: true,
  db: { server: 'nowhere', port: 1, database: 'x', user: 'x', password: 'x', encrypt: false, trustServerCertificate: true },
  disabledReason: null,
};

const changeRows = (log: Captured[]) => log.filter((c) => /INSERT INTO sms\.product_change/.test(c.sql));

describe('PdasWriter — disabled', () => {
  it('refuses every operation with DISABLED and the configured reason, and records the attempt', async () => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), disabledCfg, 1);
    expect(w.enabled).toBe(false);

    const c = await w.createProduct({ blendId: 2, countId: 8, tubeTypeId: 4, fields: FIELDS, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    const a = await w.setProductActive({ productId: 20, active: false, reason: REASON, actor: ACTOR });
    const u = await w.updateProductLimits({ productId: 20, before: FIELDS, after: { ...FIELDS, setpointG: 1965 }, bounds: BOUNDS, reason: REASON, actor: ACTOR });

    for (const r of [c, a, u]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('DISABLED');
        expect(r.message).toContain('PDAS_WRITE_ENABLED');
      }
    }
    // Every refusal is on the record — the audit trail PDAS itself will never keep.
    expect(changeRows(log).map((c) => c.params.outcome)).toEqual(['disabled', 'disabled', 'disabled']);
  });
});

describe('PdasWriter — validation refuses before any connection is opened', () => {
  it('requires a reason of at least ten characters', async () => {
    const log: Captured[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1);
    const r = await w.updateProductLimits({ productId: 20, before: FIELDS, after: { ...FIELDS, setpointG: 1965 }, bounds: BOUNDS, reason: 'typo', actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    expect(changeRows(log)[0]?.params.outcome).toBe('implausible');
  });

  it('refuses a setpoint outside the plausible cone range', async () => {
    const w = new PdasWriter(fakeAppPool([]), enabledCfg, 1);
    const r = await w.createProduct({ blendId: 2, countId: 8, tubeTypeId: 4, fields: { ...FIELDS, setpointG: 9000 }, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    if (!r.ok) expect(r.message).toMatch(/1500.2100/);
  });

  it('refuses an offset wider than half the setpoint', async () => {
    const w = new PdasWriter(fakeAppPool([]), enabledCfg, 1);
    const r = await w.updateProductLimits({ productId: 20, before: FIELDS, after: { ...FIELDS, offsetPlusG: 1200 }, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
  });

  it('will not change the active flag through the limits path — that is Retire/Activate', async () => {
    // The vendor's ActiveChanged trigger is single-row and must see the change
    // through its own proc, not folded into an unrelated UPDATE.
    const w = new PdasWriter(fakeAppPool([]), enabledCfg, 1);
    const r = await w.updateProductLimits({ productId: 20, before: FIELDS, after: { ...FIELDS, active: false }, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    if (!r.ok) expect(r.message).toMatch(/Retire/);
  });
});

describe('PdasWriter — every vendor-proc binding is within PROC_PARAMS (16 Sep 2026 introspection task)', () => {
  // The 16 Sep 2026 introspection task PROVED, against the real plant server's
  // own metadata (Desktop/SPS unzip/SPS/*.jpg — see PROC_PARAMS' own comment
  // in pdasWrite.ts), that CreateMaterial's binding was wrong: the code bound
  // only materialDesc1/2 of the proc's five @materialDesc parameters. This
  // test exists so that class of defect fails loudly next time, for any of
  // the seven procedures, rather than waiting for a real EXEC to discover it —
  // which, per Phase 1 hard constraint 3 and PDAS_WRITE_ENABLED staying off,
  // may not happen for a long time.
  //
  // It runs every method that calls a vendor proc against fakeWriterPool
  // (never a real connection), captures exactly what each call bound, by
  // name, and asserts it is a subset of PROC_PARAMS[proc] — which is the same
  // statement as "no method binds a name absent from PROC_PARAMS", the two
  // being one fact viewed two ways.
  it('binds only names PROC_PARAMS declares, for all seven procedures', async () => {
    const calls: Array<{ proc: string; params: string[] }> = [];
    const w = new PdasWriter(fakeAppPool([]), enabledCfg, 1, { writerPool: fakeWriterPool(calls) });

    const create = await w.createProduct({ blendId: 2, countId: 8, tubeTypeId: 4, fields: FIELDS, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(create.ok).toBe(true);

    const active = await w.setProductActive({ productId: 20, active: true, reason: REASON, actor: ACTOR });
    expect(active.ok).toBe(true);

    const blend = await w.addBlend({ blend: 'Cotton 30/1', reason: REASON, actor: ACTOR });
    expect(blend.ok).toBe(true);

    const count = await w.addCount({ count: '30', reason: REASON, actor: ACTOR });
    expect(count.ok).toBe(true);

    const tube = await w.addTubeType({ tubeType: 'PP-2', tubeWeightG: 12, reason: REASON, actor: ACTOR });
    expect(tube.ok).toBe(true);

    const pallet = await w.createPallet({
      fields: { productId: 20, packSchemaId: 1, lot: 'L-1', active: true, desc1: 'Blue' },
      reason: REASON,
      actor: ACTOR,
    });
    expect(pallet.ok).toBe(true);

    const palletActive = await w.setPalletActive({ palletId: 5, active: true, reason: REASON, actor: ACTOR });
    expect(palletActive.ok).toBe(true);

    const expectedProcs: VendorProc[] = [
      'CreateMaterial', 'SetMaterialStatusActive', 'AddBlend', 'AddCount', 'AddTubeType', 'CreatePallet', 'SetPalletStatusActive',
    ];
    expect(calls.map((c) => c.proc).sort()).toEqual([...expectedProcs].sort());

    for (const call of calls) {
      const allowed = PROC_PARAMS[call.proc as VendorProc];
      expect(allowed, `no PROC_PARAMS entry for ${call.proc}`).toBeDefined();
      for (const name of call.params) {
        expect(allowed, `${call.proc} binds "${name}" — not declared in PROC_PARAMS.${call.proc}`).toContain(name);
      }
      // The reverse direction the header promises without pretending to
      // assert it here: PROC_PARAMS is what the vendor declares, and a proc
      // may accept parameters this app has no reason to bind (packSchemaId
      // defaults, etc.) — that is not a defect, so this test does not require
      // every PROC_PARAMS entry to be fully used.
    }
  });

  it('CreateMaterial binds all five @materialDesc parameters, not two', async () => {
    // The specific regression this task fixed (defect 1): before this task,
    // materialDesc3/4/5 were never bound at all.
    const calls: Array<{ proc: string; params: string[] }> = [];
    const w = new PdasWriter(fakeAppPool([]), enabledCfg, 1, { writerPool: fakeWriterPool(calls) });
    const r = await w.createProduct({ blendId: 2, countId: 8, tubeTypeId: 4, fields: FIELDS, bounds: BOUNDS, reason: REASON, actor: ACTOR });
    expect(r.ok).toBe(true);
    const create = calls.find((c) => c.proc === 'CreateMaterial');
    expect(create?.params).toEqual(expect.arrayContaining(['materialDesc1', 'materialDesc2', 'materialDesc3', 'materialDesc4', 'materialDesc5']));
  });
});

describe('PdasWriter — createProduct bookkeeping failure after a successful PDAS write (R-2)', () => {
  // Before this fix, mirrorProduct/appendLimitVersion/recordChange/recordAudit
  // ran inside the SAME try as the vendor proc call, so a bookkeeping-only
  // failure AFTER CreateMaterial had already committed a real new product in
  // PDAS was caught by the outer catch and recorded as outcome 'error' —
  // indistinguishable from the write itself failing. A caller retrying "the
  // failed create" would hit CreateMaterial's own duplicate refusal against a
  // product that, per PDAS, already exists.
  it('still returns ok:true with the new productId, and records outcome ok (not error), when mirrorProduct throws', async () => {
    const calls: Array<{ proc: string; params: string[] }> = [];
    const log: Captured[] = [];
    const appPool: ConnectionPool = {
      request: () => {
        const params: Record<string, unknown> = {};
        const req = {
          input: (name: string, _t: unknown, value: unknown) => {
            params[name] = value;
            return req;
          },
          query: async (sql: string) => {
            if (/MERGE sms\.product\b/.test(sql)) throw new Error('deadlocked with another process');
            log.push({ sql, params });
            return { recordset: [], rowsAffected: [1] };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;

    const w = new PdasWriter(appPool, enabledCfg, 1, { writerPool: fakeWriterPool(calls) });
    const r = await w.createProduct({ blendId: 2, countId: 8, tubeTypeId: 4, fields: FIELDS, bounds: BOUNDS, reason: REASON, actor: ACTOR });

    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.productId).toBeGreaterThan(0);

    const rows = changeRows(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.params.outcome).toBe('ok');
    expect(String(rows[0]?.params.msg)).toMatch(/PDAS write succeeded.*bookkeeping failed.*deadlocked/);
  });
});

/**
 * B1/B2 — read code by pdasWrite.ts:942/993/1068/1229/1282 (addBlend, addCount,
 * addTubeType, createPallet, setPalletActive) and ~812 (updateProductLimits):
 * each runs a check SELECT to read back the row PDAS now holds AFTER its
 * vendor proc (or, for updateProductLimits, its own guarded UPDATE) has
 * already committed. Before this fix that read sat inside the same try as
 * the write (or, for updateProductLimits, outside any try at all), so a
 * permission-denied error on it — the real shape of the plant's EXECUTE-only
 * role, which has no SELECT on PDAS tables — was recorded (or thrown) as
 * though the WRITE had failed. It had not: retrying would hit the vendor's
 * own duplicate refusal (-4001/-6001/-5001/-8001) against a row that already
 * exists, and for updateProductLimits the route returned 500 with no
 * sms.product_change row at all for an UPDATE that had committed.
 *
 * Per the decision recorded in CLAUDE.md's current-phase section: a confirmed
 * write whose follow-up check read fails is recorded with the EXISTING
 * outcome 'ok' (no CHECK-constraint migration needed — sms.dq_finding's
 * check_name is free VARCHAR(64), verified against 009_dq_finding.sql), the
 * message names that the check read failed and why, the sidecar mirror is
 * still written with the requested values (plus the id the proc returned),
 * and a dq finding is raised under the new check_name
 * 'pdas_write_readback_failed' (a WARNING, distinct from the existing
 * CRITICAL 'pdas_write_echo_mismatch', because a failed read is not a proven
 * mismatch). A genuine proc-level failure (non-zero @error, or a thrown EXEC)
 * must still be reported as an error exactly as before this fix — that is
 * not what these tests exercise.
 */

/** A writer pool whose vendor-proc EXECUTE always succeeds, but whose every
 * follow-up `.query()` (the echo-back SELECT) throws a permission-denied
 * error in the exact shape SQL Server raises one (message text + `.number`
 * 229), simulating the plant's EXECUTE-only role reading back a table it
 * has no SELECT grant on. */
function fakeWriterPoolFailingQuery(calls: Array<{ proc: string; params: string[] }>): () => Promise<ConnectionPool> {
  const permissionDenied = () => {
    const e = new Error(
      "The SELECT permission was denied on the object 'Blends', database 'PDAS_TP1U2_SEP07', schema 'dbo'.",
    ) as Error & { number: number };
    e.number = 229;
    return e;
  };
  const pool = {
    request: () => {
      const names: string[] = [];
      const outputs: Record<string, unknown> = {};
      const req: {
        input: (name: string, ...rest: unknown[]) => typeof req;
        output: (name: string, ...rest: unknown[]) => typeof req;
        query: (sql: string) => Promise<{ recordset: unknown[]; rowsAffected: number[] }>;
        execute: (proc: string) => Promise<{ output: Record<string, unknown>; returnValue: number; recordset: unknown[] }>;
      } = {
        input: (name) => {
          names.push(name);
          return req;
        },
        output: (name) => {
          names.push(name);
          outputs[name] = name === 'error' ? 0 : name === 'errorMsg' ? null : 1;
          return req;
        },
        query: async () => {
          throw permissionDenied();
        },
        execute: async (proc) => {
          calls.push({ proc: proc.replace(/^dbo\./, ''), params: [...names] });
          return { output: outputs, returnValue: outputs.error === 0 ? 1 : 0, recordset: [] };
        },
      };
      return req;
    },
  };
  return async () => pool as unknown as ConnectionPool;
}

describe('PdasWriter — B1: a permission-denied follow-up check read must not undo a committed write', () => {
  const targets: Array<{
    name: string;
    run: (w: PdasWriter) => Promise<{ ok: boolean } & Record<string, unknown>>;
    idField: string;
    mirrorTable: RegExp;
    verbPast: string;
  }> = [
    {
      name: 'addBlend',
      run: (w) => w.addBlend({ blend: 'Cotton 30/1', reason: REASON, actor: ACTOR }),
      idField: 'blendId',
      mirrorTable: /MERGE sms\.blend\b/,
      verbPast: 'AddBlend committed',
    },
    {
      name: 'addCount',
      run: (w) => w.addCount({ count: '30', reason: REASON, actor: ACTOR }),
      idField: 'countId',
      mirrorTable: /MERGE sms\.yarn_count\b/,
      verbPast: 'AddCount committed',
    },
    {
      name: 'addTubeType',
      run: (w) => w.addTubeType({ tubeType: 'PP-2', tubeWeightG: 12, reason: REASON, actor: ACTOR }),
      idField: 'tubeTypeId',
      mirrorTable: /MERGE sms\.tube_type\b/,
      verbPast: 'AddTubeType committed',
    },
    {
      name: 'createPallet',
      run: (w) =>
        w.createPallet({
          fields: { productId: 20, packSchemaId: 1, lot: 'L-1', active: true, desc1: 'Blue' },
          reason: REASON,
          actor: ACTOR,
        }),
      idField: 'palletId',
      mirrorTable: /MERGE sms\.pallet\b/,
      verbPast: 'CreatePallet committed',
    },
    {
      name: 'setPalletActive',
      run: (w) => w.setPalletActive({ palletId: 5, active: true, reason: REASON, actor: ACTOR }),
      idField: 'palletId',
      mirrorTable: /(MERGE sms\.pallet\b|UPDATE sms\.pallet\b)/,
      verbPast: 'SetPalletStatusActive committed',
    },
  ];

  for (const t of targets) {
    it(`${t.name}: proc succeeds, follow-up check read throws permission-denied — still ok:true with the id, product_change 'ok', mirror written, dq finding raised`, async () => {
      const calls: Array<{ proc: string; params: string[] }> = [];
      const log: Captured[] = [];
      const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeWriterPoolFailingQuery(calls) });

      const r = await t.run(w);

      expect(r.ok).toBe(true);
      expect((r as Record<string, unknown>)[t.idField]).toBeGreaterThan(0);

      // The write itself must be reported as having happened.
      const rows = changeRows(log);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.params.outcome).toBe('ok');
      expect(String(rows[0]?.params.msg)).toMatch(/follow-up check read failed/);
      expect(String(rows[0]?.params.msg)).toContain(t.verbPast);

      // The sidecar mirror must still be written, with the requested values.
      expect(log.some((e) => t.mirrorTable.test(e.sql))).toBe(true);

      // A dq finding under the new, non-CRITICAL check_name — not the
      // existing 'pdas_write_echo_mismatch', which asserts a PROVEN mismatch.
      const dqRows = log.filter((e) => /INSERT INTO sms\.dq_finding/.test(e.sql));
      expect(dqRows).toHaveLength(1);
      expect(dqRows[0]?.params.check).toBe('pdas_write_readback_failed');
      expect(dqRows[0]?.params.sev).toBe('WARNING');
    });
  }
});

/** A writer pool for updateProductLimits: the in-transaction optimistic-
 * concurrency read (before the UPDATE) succeeds and matches `before`; the
 * UPDATE and the nhs_events insert both succeed; the SECOND read of the same
 * SELECT — the post-commit echo-back this fix targets — throws permission-
 * denied, simulating a role that can read the row once but not again (or any
 * other transient cause): the point under test is only that this second
 * failure must not surface as though the UPDATE itself failed. */
function fakeUpdateLimitsPool(before: ProductFields): () => Promise<ConnectionPool> {
  let selectCount = 0;
  const pool = {
    request: () => {
      const req: {
        input: (name: string, ...rest: unknown[]) => typeof req;
        query: (sql: string) => Promise<{ recordset: unknown[]; rowsAffected: number[] }>;
      } = {
        input: () => req,
        query: async (sql: string) => {
          if (/SELECT MaterialSetpointWeight/.test(sql)) {
            selectCount += 1;
            if (selectCount === 1) {
              return {
                recordset: [
                  { sp: before.setpointG, om: before.offsetMinusG, op: before.offsetPlusG, d1: before.desc1, d2: before.desc2, a: before.active },
                ],
                rowsAffected: [1],
              };
            }
            const e = new Error(
              "The SELECT permission was denied on the object 'Materials', database 'PDAS_TP1U2_SEP07', schema 'dbo'.",
            ) as Error & { number: number };
            e.number = 229;
            throw e;
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

describe('PdasWriter — B2: updateProductLimits post-commit check read must not throw out of the route', () => {
  it('post-commit check read throws — ok:true, product_change row written, no throw', async () => {
    const log: Captured[] = [];
    const before = FIELDS;
    const after: ProductFields = { ...FIELDS, setpointG: 1965 };
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeUpdateLimitsPool(before) });

    const r = await w.updateProductLimits({ productId: 20, before, after, bounds: BOUNDS, reason: REASON, actor: ACTOR });

    expect(r).toMatchObject({ ok: true, productId: 20 });

    const rows = changeRows(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.params.outcome).toBe('ok');
    expect(String(rows[0]?.params.msg)).toMatch(/follow-up check read failed/);
    expect(String(rows[0]?.params.msg)).toContain('updateProductLimits committed');

    const dqRows = log.filter((e) => /INSERT INTO sms\.dq_finding/.test(e.sql));
    expect(dqRows).toHaveLength(1);
    expect(dqRows[0]?.params.check).toBe('pdas_write_readback_failed');
    expect(dqRows[0]?.params.sev).toBe('WARNING');
  });
});
