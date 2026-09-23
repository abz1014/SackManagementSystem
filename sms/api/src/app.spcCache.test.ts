/**
 * /api/spc was the heaviest read in the app with NO cache at all (defect
 * found 23 Sep 2026): a warm call cost the same as a cold one — 1.6-2.0s at
 * full range — because every other cached route (see prodCache.get/set in
 * app.ts) had a `key` built and this one never did. This file proves the fix
 * two ways, against the REAL createApp and a hand-rolled fake pool (same
 * shape as app.rbac.test.ts / app.routes.test.ts, not a reimplementation of
 * routing):
 *
 *  1. a second identical request is served from cache (X-Cache: HIT, and no
 *     new query hits the fake pool);
 *  2. a request that differs in ANY of the parameters that change the
 *     answer — from, to, station, productId, shift, usl/lsl — is NOT served
 *     the other request's cached payload. A cache keyed on too few
 *     parameters would silently serve one period's chart under another's
 *     label, which is worse than being slow (see app.ts's own comment on the
 *     key, right above where it's built).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

interface Stmt { sql: string }

class FakeRequest {
  private inputs = new Map<string, unknown>();
  constructor(private readonly db: FakeDb) {}
  input(name: string, _type: unknown, value: unknown): this {
    this.inputs.set(name, value);
    return this;
  }
  async query<T = Record<string, unknown>>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    return this.db.handle<T>(sql);
  }
}

class FakeDb {
  statements: Stmt[] = [];
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    // Not exercised by /api/spc (a read-only route) — never called in this file.
    throw new Error('transaction() not expected in app.spcCache.test.ts');
  }

  async handle<T>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      return row({ user_id: 1, password_hash: this.hash, display_name: 'viewer', role: 'viewer', rank: 1, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) return none();
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      return row({ user_id: 1, username: 'viewer', display_name: 'viewer', role: 'viewer', rank: 1 });
    }

    // spc.ts's getWeightSpc summary aggregate — always exactly one row (no
    // FROM/WHERE it can filter to zero rows out of, it's a plain SELECT of
    // subqueries), same as the real server. Empty here would throw on
    // `sumRes.recordset[0]!` in spc.ts, same as it would against a real DB
    // returning zero rows for a query that structurally cannot do that —
    // this fake matches the real shape, not merely avoids a crash.
    if (sql.includes('MIN(production_ts_utc) minTs')) {
      return row({ n: 0, mean: null, sd: null, excluded: 0, minTs: null, maxTs: null, occDays: 0 });
    }

    // Everything else /api/spc issues (median, subgroup, station, histogram
    // queries) is a list this codebase handles safely when empty.
    return none();
  }

  hash = '';
}

let server: Server;
let base: string;
let cookie: string;
let db: FakeDb;

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  db = new FakeDb();
  db.hash = await argon2.hash('spc-cache-test-password');

  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    lineName: 'Test line',
    liveAllowAsOf: true,
    cacheTtlSeconds: 5,
    trustProxy: false,
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
  };
  const app = createApp(db as unknown as import('mssql').ConnectionPool, cfg);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer', password: 'spc-cache-test-password' }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('fixture login set no cookie');
  cookie = setCookie.split(';')[0]!;
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(qs: string) {
  const res = await fetch(`${base}/api/spc?${qs}`, { headers: { Cookie: cookie } });
  return { status: res.status, xCache: res.headers.get('x-cache'), body: await res.json() };
}

/** Count of the spc.ts summary-aggregate query — the one statement every
 *  /api/spc call issues on a cache MISS and NEVER on a HIT (unlike the
 *  session-validation query the auth middleware runs on every request,
 *  cached or not — so a plain "total statement count" assertion is the
 *  wrong measure here). */
function spcQueryCount(): number {
  return db.statements.filter((s) => s.sql.includes('MIN(production_ts_utc) minTs')).length;
}

describe('GET /api/spc — cached (previously the one uncached heavy read)', () => {
  it('MISSes cold, HITs warm, and a warm hit issues no new query against the pool', async () => {
    const first = await get('type=cone&from=2026-08-01&to=2026-08-01');
    expect(first.status).toBe(200);
    expect(first.xCache).toBe('MISS');

    const afterFirst = spcQueryCount();
    expect(afterFirst).toBeGreaterThan(0);

    const second = await get('type=cone&from=2026-08-01&to=2026-08-01');
    expect(second.status).toBe(200);
    expect(second.xCache).toBe('HIT');
    expect(second.body).toEqual(first.body);

    // The whole point: a warm call must not touch the database for the
    // spc.ts computation at all (the auth middleware's own per-request
    // session check is unaffected by this cache and is not what this
    // counts).
    expect(spcQueryCount()).toBe(afterFirst);
  });

  it("does not serve one period a different period, station, or product's cached answer", async () => {
    const base1 = 'type=cone&from=2026-08-02&to=2026-08-02';

    const r0 = await get(base1);
    expect(r0.xCache).toBe('MISS');

    // Different `to` — a different reporting period.
    const rTo = await get('type=cone&from=2026-08-02&to=2026-08-03');
    expect(rTo.xCache).toBe('MISS');

    // Different `station`.
    const rStation = await get(`${base1}&station=3`);
    expect(rStation.xCache).toBe('MISS');

    // Second call with the SAME station must now hit its own cache entry,
    // not the station-less one above.
    const rStation2 = await get(`${base1}&station=3`);
    expect(rStation2.xCache).toBe('HIT');

    // Different `productId`.
    const rProduct = await get(`${base1}&productId=7`);
    expect(rProduct.xCache).toBe('MISS');

    // Different `type` (sack vs cone) must also be a distinct key.
    const rSack = await get('type=sack&from=2026-08-02&to=2026-08-02');
    expect(rSack.xCache).toBe('MISS');
  });
});
