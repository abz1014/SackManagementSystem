/**
 * Task W1-D (29 Sep 2026, failure analysis F-26/F-27/F-31) —
 * `PdasWriter.updateProductLimits`'s large-change guard and its locking read.
 *
 *  - A setpoint move of more than PDAS_LIMIT_MAX_SETPOINT_CHANGE_PCT percent
 *    (default 3), or either offset moving more than
 *    PDAS_LIMIT_MAX_OFFSET_CHANGE_G grams (default 20), from the CURRENT
 *    value is refused IMPLAUSIBLE unless `largeChangeConfirmed: true` AND a
 *    reason of at least 20 characters.
 *  - Both the built-in defaults and an env-style override (a hand-built
 *    PdasWriteConfig carrying its own bounds, the same shape `loadApiConfig`
 *    would produce from PDAS_LIMIT_MAX_*) are exercised.
 *  - A confirmed large change is audited under 'product.limits_large_change',
 *    distinct from the ordinary 'product.limits' action.
 *  - The in-transaction optimistic-concurrency check-read carries
 *    `WITH (UPDLOCK, HOLDLOCK)` — a SQL-shape pin, not a real-lock proof
 *    (this file never opens a real connection; see pdasWrite.test.ts's own
 *    header on why offline is the only mode available before IFL provisions
 *    `sms_pdas_writer`).
 *
 * Same offline mssql mock as pdasWrite.test.ts (updateProductLimits is the
 * only method that uses `new mssql.Transaction`/`new mssql.Request` directly
 * rather than `pool.request()`), duplicated here rather than imported so
 * this file has no test-to-test coupling with pdasWrite.test.ts.
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
          log.push({ sql, params });
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

/**
 * A writer pool for `updateProductLimits`: the FIRST `SELECT
 * MaterialSetpointWeight...` (the in-transaction optimistic-concurrency
 * check-read) answers `before` and is captured for the UPDLOCK/HOLDLOCK
 * shape pin; the SECOND (the post-commit echo-back, run directly on the
 * pool, outside any transaction) answers `after`, so a normal run's echo
 * always matches what was requested. Every other query (the UPDATE, the
 * nhs_events INSERT) just succeeds.
 */
function fakeLimitsPool(before: ProductFields, after: ProductFields, selectSqls: string[]): () => Promise<ConnectionPool> {
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
            selectSqls.push(sql);
            const f = selectCount === 1 ? before : after;
            return { recordset: [{ sp: f.setpointG, om: f.offsetMinusG, op: f.offsetPlusG, d1: f.desc1, d2: f.desc2, a: f.active }], rowsAffected: [1] };
          }
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return async () => pool as unknown as ConnectionPool;
}

const ACTOR = { userId: 7, username: 'engineer1' };
const BOUNDS = { setpointLoG: 1500, setpointHiG: 2100 };
const BEFORE: ProductFields = { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, desc1: '205-IL0-SD', desc2: 'Blue', active: true };
const REASON_SHORT_OK = 'Routine edit 900'; // 16 chars: >= 10 (ordinary minimum), < 20 (large-change minimum)
const REASON_LONG = 'This is a large change, confirmed by an engineer'; // >= 20 chars

const enabledCfg = {
  enabled: true,
  db: { server: 'nowhere', port: 1, database: 'x', user: 'x', password: 'x', encrypt: false, trustServerCertificate: true },
  disabledReason: null,
};

const changeRows = (log: Captured[]) => log.filter((c) => /INSERT INTO sms\.product_change/.test(c.sql));

describe('PdasWriter.updateProductLimits — large-change guard, default bounds (3% / 20 g)', () => {
  it('refuses a setpoint change over 3% without confirmation, and records it implausible', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, setpointG: 2050 }; // +90 g, +4.59%
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });

    const r = await w.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_LONG, actor: ACTOR });

    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    if (!r.ok) {
      expect(r.message).toContain('1960');
      expect(r.message).toContain('2050');
      expect(r.message).toMatch(/3%/);
    }
    expect(changeRows(log)).toHaveLength(1);
    expect(changeRows(log)[0]?.params.outcome).toBe('implausible');
  });

  it('refuses an offset change over 20 g without confirmation', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, offsetPlusG: 55 }; // +25 g
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });

    const r = await w.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_LONG, actor: ACTOR });

    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
    if (!r.ok) expect(r.message).toMatch(/20 g/);
  });

  it('refuses a large change when largeChangeConfirmed is true but the reason is under 20 characters', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, setpointG: 2050 };
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });

    const r = await w.updateProductLimits({
      productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_SHORT_OK, largeChangeConfirmed: true, actor: ACTOR,
    });

    expect(r).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });
  });

  it('accepts a large change with largeChangeConfirmed:true and a reason >= 20 chars, and audits it as large_change', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, setpointG: 2050 };
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });

    const r = await w.updateProductLimits({
      productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_LONG, largeChangeConfirmed: true, actor: ACTOR,
    });

    expect(r).toMatchObject({ ok: true, productId: 20 });
    const audits = log.filter((c) => /INSERT INTO sms\.audit_log/.test(c.sql));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.params.action).toBe('product.limits_large_change');
    expect(String(audits[0]?.params.detail)).toMatch(/^LARGE CHANGE —/);
  });

  it('an ordinary change (within bounds) is audited as plain product.limits, not large_change', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, setpointG: 1965 }; // +5 g, +0.26%
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });

    const r = await w.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_SHORT_OK, actor: ACTOR });

    expect(r).toMatchObject({ ok: true });
    const audits = log.filter((c) => /INSERT INTO sms\.audit_log/.test(c.sql));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.params.action).toBe('product.limits');
  });
});

describe('PdasWriter.updateProductLimits — large-change guard, env-overridden bounds', () => {
  it('a 10% setpoint move is refused at the default 3% bound but accepted when the config carries a wider one', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, setpointG: 2156 }; // +196 g, +10.0%

    const narrow = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });
    const refused = await narrow.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: { setpointLoG: 1500, setpointHiG: 2200 }, reason: REASON_LONG, actor: ACTOR });
    expect(refused).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });

    const wideCfg = { ...enabledCfg, maxSetpointChangePct: 12 };
    const wide = new PdasWriter(fakeAppPool([]), wideCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });
    const accepted = await wide.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: { setpointLoG: 1500, setpointHiG: 2200 }, reason: REASON_SHORT_OK, actor: ACTOR });
    expect(accepted).toMatchObject({ ok: true });
  });

  it('a 30 g offset move is refused at the default 20 g bound but accepted when the config carries a wider one', async () => {
    const after: ProductFields = { ...BEFORE, offsetMinusG: 60 }; // +30 g

    const narrow = new PdasWriter(fakeAppPool([]), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });
    const refused = await narrow.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_LONG, actor: ACTOR });
    expect(refused).toMatchObject({ ok: false, code: 'IMPLAUSIBLE' });

    const wideCfg = { ...enabledCfg, maxOffsetChangeG: 40 };
    const wide = new PdasWriter(fakeAppPool([]), wideCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, []) });
    const accepted = await wide.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_SHORT_OK, actor: ACTOR });
    expect(accepted).toMatchObject({ ok: true });
  });
});

describe('PdasWriter.updateProductLimits — the in-transaction check-read locks the row', () => {
  it('the optimistic-concurrency SELECT carries WITH (UPDLOCK, HOLDLOCK); the post-commit echo-back does not', async () => {
    const log: Captured[] = [];
    const after: ProductFields = { ...BEFORE, setpointG: 1965 };
    const selectSqls: string[] = [];
    const w = new PdasWriter(fakeAppPool(log), enabledCfg, 1, { writerPool: fakeLimitsPool(BEFORE, after, selectSqls) });

    const r = await w.updateProductLimits({ productId: 20, before: BEFORE, after, bounds: BOUNDS, reason: REASON_SHORT_OK, actor: ACTOR });

    expect(r.ok).toBe(true);
    expect(selectSqls).toHaveLength(2);
    expect(selectSqls[0]).toMatch(/WITH\s*\(UPDLOCK,\s*HOLDLOCK\)/);
    expect(selectSqls[1]).not.toMatch(/UPDLOCK/);
  });
});
