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
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { PdasWriter, type ProductFields } from './pdasWrite.js';

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
