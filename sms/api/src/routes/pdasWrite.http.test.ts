/**
 * Task P — HTTP-layer tests for the four PDAS write routes (POST /api/products,
 * POST /api/products/:id/active, POST /api/products/:id/limits — all three in
 * app.ts — and POST /api/changeover/execute in routes/changeover.ts). Same
 * fixture shape as app.rbac.test.ts / routes/changeover.test.ts: a real
 * createApp, a hand-rolled fake mssql pool, real argon2-verified sessions,
 * Node's fetch. Every config here is HAND-BUILT (or loaded via loadApiConfig
 * with an in-memory env object) — never the real `.env` — so this file can
 * never accidentally reach a real PDAS connection.
 *
 * Proves, against the real Express routing and RBAC gate:
 *  - PDAS_WRITE_ENABLED=false (hand-built config): all four routes answer 503
 *    DISABLED and each records exactly one sms.product_change row at
 *    outcome='disabled' (the three app.ts routes via PdasWriter's own
 *    recordChange; changeover/execute via changeover.ts's own
 *    recordDisabledAttempt — same table, same shape).
 *  - Writes enabled but the changeover plan is blocked (an existing product
 *    already carries the requested blend+count+tube triple): 409 BLOCKED, and
 *    the writer is never called — planChangeover only reads the sidecar
 *    mirror, so no live PDAS connection is ever attempted even though
 *    pdasWrite.enabled is true in this fixture.
 *  - A rank-1 (viewer) session gets 403 on all four routes.
 *  - app.rbac.test.ts and routes/changeover.test.ts still pass (run
 *    separately by the test runner; not re-implemented here).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';
import { loadApiConfig } from '../config.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

class FakeRequest {
  private inputs = new Map<string, unknown>();
  constructor(private readonly db: FakeDb) {}
  input(name: string, _type: unknown, value: unknown): this {
    this.inputs.set(name, value);
    return this;
  }
  async query<T = Record<string, unknown>>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    return this.db.handle<T>(sql, this.inputs);
  }
}

interface User { userId: number; username: string; role: string; rank: number }
const USERS: User[] = [
  { userId: 1, username: 'viewer', role: 'viewer', rank: 1 },
  { userId: 2, username: 'engineer', role: 'engineer', rank: 2 },
  { userId: 3, username: 'manager', role: 'manager', rank: 3 },
  { userId: 4, username: 'admin', role: 'admin', rank: 4 },
];

/**
 * A product row whose (blend_id, count_id, tube_type_id) exactly matches
 * CHANGEOVER_BODY below — so planChangeover finds the same clash F1 in
 * scripts/pdas-e2e-local.mjs exercises live: CreateMaterial refuses a
 * duplicate (blend, count, tube) triple, so the plan itself must block
 * before any PDAS connection is ever opened.
 */
const CLASHING_PRODUCT = { product_id: 900, blend_id: 1, count_id: 2, tube_type_id: 3, active_flag: true, description: 'Existing clash product', lot_code: null };

class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest { return new FakeRequest(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    // ---- auth (same shape as app.rbac.test.ts / routes/changeover.test.ts) ----
    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = USERS.find((x) => x.username === inputs.get('u'));
      if (!u) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const u = USERS.find((x) => x.userId === this.sessions.get(inputs.get('id') as string));
      if (!u) return none();
      return row({ user_id: u.userId, username: u.username, display_name: u.username, role: u.role, rank: u.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();

    // ---- the changeover mirror (services/changeover.ts's readMirror) ----
    if (sql.includes('FROM sms.tube_type')) return rows([{ id: 3, name: 'PP Tube', w: 12, form: 2 }]);
    if (sql.includes('FROM sms.blend')) return rows([{ id: 1, name: 'PolyBlend' }]);
    if (sql.includes('FROM sms.yarn_count')) return rows([{ id: 2, name: '30s' }]);
    if (sql.includes('FROM sms.pallet pl')) return rows([]);
    // Checked before the generic 'FROM sms.product' match, same ordering
    // reason as routes/changeover.test.ts (product_change vs product substring).
    if (sql.includes('FROM sms.product_change c')) return rows([]);
    if (sql.includes('FROM sms.product')) return rows([CLASHING_PRODUCT]);
    if (sql.includes('sms.plausibility_rule')) return row({ cl: 1500, ch: 2100, sl: 40, sh: 60 });
    if (sql.includes('INSERT INTO sms.product_change')) return none();
    if (sql.includes('INSERT INTO sms.dq_finding')) return none();

    return none();
  }
}

const PASSWORD = 'pdas-http-routes-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
const cookies: Record<string, string> = {};

/** Writes disabled — an ordinary, safe default. Never sourced from a real .env. */
const DISABLED_CFG: ApiConfig['pdasWrite'] = { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' };

/**
 * Writes "enabled" with a login that would fail if ever opened
 * (server 'nowhere', port 1). Every test that uses this must never let the
 * writer pool actually open — the blocked-plan test proves exactly that: the
 * plan's own blockers refuse the request before planChangeover or
 * executeChangeover ever calls a PdasWriter method that would touch the
 * pool. Built with loadApiConfig from an in-memory env object (never process
 * env, never a file), demonstrating the "or a hand-built config" alternative
 * the task allows — this is NOT the real `.env`.
 */
function enabledCfgViaLoadApiConfig(): ApiConfig['pdasWrite'] {
  const cfg = loadApiConfig({
    API_PORT: '4000',
    LINE_ID: '1',
    LINE_NAME: 'Test line',
    APP_DB_SERVER: 'unused',
    APP_DB_PORT: '1433',
    APP_DB_NAME: 'unused',
    APP_DB_USER: 'unused',
    APP_DB_PASSWORD: 'unused',
    APP_DB_ENCRYPT: 'false',
    APP_DB_TRUST_SERVER_CERTIFICATE: 'true',
    PDAS_WRITE_ENABLED: 'true',
    PDAS_WRITE_SERVER: 'nowhere',
    PDAS_WRITE_PORT: '1',
    PDAS_WRITE_DATABASE: 'PDAS_TP1U2',
    PDAS_WRITE_USER: 'x',
    PDAS_WRITE_PASSWORD: 'x',
    PDAS_WRITE_ENCRYPT: 'false',
    PDAS_WRITE_TRUST_SERVER_CERTIFICATE: 'true',
    IFL_DB_NAME_PDAS: 'PDAS_TP1U2',
    IFL_DB_USER: 'ifl_reader_not_the_writer',
  } as unknown as NodeJS.ProcessEnv);
  return cfg.pdasWrite;
}

async function buildApp(pdasWrite: ApiConfig['pdasWrite']): Promise<{ app: ReturnType<typeof createApp>; db: FakeDb }> {
  const fakeDb = new FakeDb();
  fakeDb.hash = await argon2.hash(PASSWORD);
  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    lineName: 'Test line',
    liveAllowAsOf: true,
    cacheTtlSeconds: 5,
    trustProxy: false,
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    pdasWrite,
  };
  const app = createApp(fakeDb as unknown as import('mssql').ConnectionPool, cfg);
  return { app, db: fakeDb };
}

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  const built = await buildApp(DISABLED_CFG);
  db = built.db;
  server = built.app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;
  for (const u of USERS) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`fixture login failed for ${u.username}: ${res.status}`);
    cookies[u.username] = res.headers.get('set-cookie')!.split(';')[0]!;
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.statements = [];
});

async function call(base_: string, who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base_}${path}`, {
    method,
    headers: { ...(who ? { Cookie: cookies[who]! } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

const PRODUCT_FIELDS = { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, desc1: null, desc2: null, active: true };
const REASON = 'HTTP fixture test, ticket 900';

const PRODUCT_CREATE_BODY = { blendId: 1, countId: 2, tubeTypeId: 3, fields: PRODUCT_FIELDS, reason: REASON };
const PRODUCT_ACTIVE_BODY = { active: false, reason: REASON };
const PRODUCT_LIMITS_BODY = { before: PRODUCT_FIELDS, after: { ...PRODUCT_FIELDS, setpointG: 1965 }, reason: REASON };
const CHANGEOVER_BODY = {
  blend: { id: 1 },
  count: { id: 2 },
  tubeType: { id: 3 },
  material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: 'HTTP-FIXTURE-LOT', ppColour: 'Blue' },
  pallet: { packSchemaId: 1, lot: null, sackColour: 'Blue' },
  retire: { productIds: [], palletIds: [] },
  reason: REASON,
};

const ROUTES: { method: string; path: string; body: unknown }[] = [
  { method: 'POST', path: '/api/products', body: PRODUCT_CREATE_BODY },
  { method: 'POST', path: '/api/products/21/active', body: PRODUCT_ACTIVE_BODY },
  { method: 'POST', path: '/api/products/21/limits', body: PRODUCT_LIMITS_BODY },
  { method: 'POST', path: '/api/changeover/execute', body: CHANGEOVER_BODY },
];

describe('PDAS write routes — confirm the exact paths and methods this file assumes', () => {
  // Documents (and locks down) exactly which four routes this file exercises,
  // per the task brief: POST /api/products, POST /api/products/:id/active,
  // POST /api/products/:id/limits, POST /api/changeover/execute.
  it('all four routes exist and are not 404', async () => {
    for (const r of ROUTES) {
      const res = await call(base, 'engineer', r.method, r.path, r.body);
      expect(res.status, `${r.method} ${r.path}`).not.toBe(404);
    }
  });
});

describe('PDAS_WRITE_ENABLED=false — all four write routes answer 503 DISABLED, one product_change row each', () => {
  it.each(ROUTES)('$method $path -> 503 DISABLED, exactly one sms.product_change row at outcome=disabled', async (route) => {
    const before = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.product_change')).length;
    const r = await call(base, 'engineer', route.method, route.path, route.body);
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('DISABLED');
    const inserts = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.product_change'));
    expect(inserts.length - before).toBe(1);
    const last = inserts[inserts.length - 1]!;
    expect(last.inputs.get('outcome')).toBe('disabled');
  });
});

describe('rank 1 (viewer) -> 403 on all four write routes, never reaching PDAS logic', () => {
  it.each(ROUTES)('$method $path', async (route) => {
    const r = await call(base, 'viewer', route.method, route.path, route.body);
    expect(r.status).toBe(403);
  });

  it('signed out -> 401 on all four write routes', async () => {
    for (const route of ROUTES) {
      const r = await call(base, null, route.method, route.path, route.body);
      expect(r.status).toBe(401);
    }
  });
});

describe('writes enabled but the changeover plan is blocked — 409 BLOCKED, the writer is never opened', () => {
  let enabledBase: string;
  let enabledServer: Server;
  let enabledDb: FakeDb;
  const enabledCookies: Record<string, string> = {};

  beforeAll(async () => {
    const built = await buildApp(enabledCfgViaLoadApiConfig());
    enabledDb = built.db;
    enabledServer = built.app.listen(0);
    await new Promise<void>((resolve) => enabledServer.once('listening', resolve));
    const addr = enabledServer.address();
    if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
    enabledBase = `http://127.0.0.1:${addr.port}`;
    for (const u of USERS) {
      const res = await fetch(`${enabledBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u.username, password: PASSWORD }),
      });
      if (res.status !== 200) throw new Error(`fixture login failed for ${u.username}: ${res.status}`);
      enabledCookies[u.username] = res.headers.get('set-cookie')!.split(';')[0]!;
    }
  });

  afterAll(() => new Promise<void>((resolve) => enabledServer.close(() => resolve())));

  it('POST /api/changeover/execute with a blend+count+tube triple that already exists -> 409 BLOCKED', async () => {
    const res = await fetch(`${enabledBase}/api/changeover/execute`, {
      method: 'POST',
      headers: { Cookie: enabledCookies['engineer']!, 'Content-Type': 'application/json' },
      body: JSON.stringify(CHANGEOVER_BODY),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json().catch(() => null);
    expect(res.status).toBe(409);
    expect(json.code).toBe('BLOCKED');
    expect(json.reachesMachine).toBe(false);
    // The writer is never opened: nothing in the fixture answers a real PDAS
    // query (there is no PDAS pool in this fixture at all — writer.enabled is
    // true but the config's db points at 'nowhere'/port 1, which would hang
    // or fail if ever connected to), and no sms.product_change row is
    // written for a blocked plan — the route returns before
    // executeChangeover's own recordDisabledAttempt/recordChange path runs.
    expect(enabledDb.statements.some((s) => s.sql.includes('INSERT INTO sms.product_change'))).toBe(false);
  });
});
