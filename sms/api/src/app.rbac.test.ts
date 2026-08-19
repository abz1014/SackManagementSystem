/**
 * RBAC boundary tests against the REAL Express app (createApp), not a
 * reimplementation of its routing. No new dependency: a hand-rolled fake
 * mssql pool stands in for the DB, and Node's built-in fetch drives real HTTP
 * requests at an ephemeral port. The fake pool answers the specific queries
 * auth.ts issues (login, session lookup) with real argon2-verified
 * credentials, and answers every other query generically — enough for each
 * route's requireRole gate to be exercised for real, which is the boundary
 * this file exists to prove. It deliberately does not assert response BODIES
 * (that would require faithfully replaying this app's entire query surface,
 * duplicating work the live-database browser verification in this project
 * already does) — only that the gate lets through what it should and blocks
 * what it shouldn't.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

// ---- fake mssql pool ---------------------------------------------------

interface FakeUser { userId: number; username: string; passwordHash: string; role: string; rank: number }

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

class FakeDb {
  users: FakeUser[] = [];
  sessions = new Map<string, { userId: number; expiresAtUtc: Date }>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    // health check
    if (sql.includes('SELECT 1 AS ok')) return { recordset: [{ ok: 1 } as T], rowsAffected: [1] };

    // authenticate(): username -> row with password_hash/role/rank
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const username = inputs.get('u') as string;
      const u = this.users.find((x) => x.username === username);
      if (!u) return { recordset: [], rowsAffected: [0] };
      return {
        recordset: [{
          user_id: u.userId, password_hash: u.passwordHash, display_name: u.username,
          role: u.role, rank: u.rank, active: true,
        } as T],
        rowsAffected: [1],
      };
    }

    // createSession(): INSERT INTO sms.session
    if (sql.includes('INSERT INTO sms.session')) {
      const id = inputs.get('id') as string;
      const userId = inputs.get('u') as number;
      const exp = inputs.get('exp') as Date;
      this.sessions.set(id, { userId, expiresAtUtc: exp });
      return { recordset: [], rowsAffected: [1] };
    }

    // userFromSession(): session id -> user row (session/user join)
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const id = inputs.get('id') as string;
      const s = this.sessions.get(id);
      if (!s || s.expiresAtUtc.getTime() <= Date.now()) return { recordset: [], rowsAffected: [0] };
      const u = this.users.find((x) => x.userId === s.userId);
      if (!u) return { recordset: [], rowsAffected: [0] };
      return {
        recordset: [{ user_id: u.userId, username: u.username, display_name: u.username, role: u.role, rank: u.rank } as T],
        rowsAffected: [1],
      };
    }

    // destroySession() / pruneExpiredSessions()
    if (sql.includes('DELETE FROM sms.session WHERE session_id=@id')) {
      const id = inputs.get('id') as string;
      this.sessions.delete(id);
      return { recordset: [], rowsAffected: [1] };
    }
    if (sql.includes('DELETE FROM sms.session WHERE expires_at_utc')) {
      return { recordset: [], rowsAffected: [0] };
    }

    // Every route handler beyond auth issues its own business-logic query
    // against real data this test never seeds — that is out of scope here
    // (covered by this project's live-database verification instead). Rows
    // with OUTPUT (INSERT/UPDATE...OUTPUT deleted/inserted) get a row shaped
    // to satisfy every OUTPUT clause in this codebase so the handler doesn't
    // throw on `.recordset[0]` before ever reaching its res.json(); every
    // other query gets an empty result set, which every list/map call site
    // in this codebase handles safely.
    if (/\bOUTPUT\b/i.test(sql)) {
      return {
        recordset: [{
          id: 1, timeline_id: 1,
          old_label: null, old_is_pass: null, old_active: true, old_role: 1, old_name: null,
        } as T],
        rowsAffected: [1],
      };
    }
    return { recordset: [], rowsAffected: [0] };
  }
}

// ---- test fixture --------------------------------------------------------

const PASSWORD = 'rbac-test-password-not-real';
const ROLES: { role: string; rank: number }[] = [
  { role: 'operator', rank: 1 },
  { role: 'supervisor', rank: 2 },
  { role: 'manager', rank: 3 },
  { role: 'admin', rank: 4 },
];

let server: Server;
let base: string;
const cookies: Record<string, string> = {}; // role -> Cookie header value

beforeAll(async () => {
  // Some "allowed" cases hit real handlers against fake data the DB double
  // doesn't fully understand (e.g. getWeights expects a populated stats
  // shape) and 500 via app.ts's error handler — expected and asserted on
  // (500 is neither 401 nor 403, which is the only thing this file checks),
  // but it logs via console.error. Quiet that expected noise; a genuine
  // assertion failure still surfaces through vitest's own reporting, not this.
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const db = new FakeDb();
  const hash = await argon2.hash(PASSWORD);
  ROLES.forEach((r, i) => db.users.push({ userId: i + 1, username: r.role, passwordHash: hash, role: r.role, rank: r.rank }));

  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    cacheTtlSeconds: 5,
    trustProxy: false,
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
  };
  const app = createApp(db as unknown as import('mssql').ConnectionPool, cfg);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;

  for (const r of ROLES) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: r.role, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`fixture login failed for ${r.role}: ${res.status}`);
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error(`fixture login for ${r.role} set no cookie`);
    cookies[r.role] = setCookie.split(';')[0]!;
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---- route table: mirrors app.ts's actual requireRole placements --------
// (operator=1, supervisor=2, manager=3, admin=4)

interface RouteCase {
  method: string;
  path: string;
  minRank: number;
  body?: unknown;
}

const ROUTES: RouteCase[] = [
  // blanket requireRole(1) tier
  { method: 'GET', path: '/api/range', minRank: 1 },
  { method: 'GET', path: '/api/operations', minRank: 1 },
  { method: 'GET', path: '/api/production', minRank: 1 },
  { method: 'GET', path: '/api/downtime', minRank: 1 },
  { method: 'GET', path: '/api/stoppage-patterns', minRank: 1 },
  { method: 'GET', path: '/api/spc?type=cone', minRank: 1 },
  { method: 'GET', path: '/api/reject-spc', minRank: 1 },
  { method: 'GET', path: '/api/oee', minRank: 1 },
  { method: 'GET', path: '/api/events?type=cone', minRank: 1 },
  { method: 'GET', path: '/api/events/cone/1', minRank: 1 },
  { method: 'GET', path: '/api/shift-analysis', minRank: 1 },
  { method: 'GET', path: '/api/rejects', minRank: 1 },
  { method: 'GET', path: '/api/weights', minRank: 1 },
  { method: 'GET', path: '/api/products', minRank: 1 },
  { method: 'GET', path: '/api/current-product', minRank: 1 },
  { method: 'GET', path: '/api/product-timeline', minRank: 1 },
  { method: 'GET', path: '/api/calibration?from=2026-07-09&to=2026-07-09', minRank: 1 },
  { method: 'GET', path: '/api/calibration/adjustments', minRank: 1 },
  // route-specific gates
  { method: 'GET', path: '/api/events/export?type=cone', minRank: 3 },
  { method: 'PUT', path: '/api/reject-codes/1', minRank: 3, body: { label: 'x' } },
  { method: 'POST', path: '/api/current-product', minRank: 2, body: { productId: 1 } },
  { method: 'POST', path: '/api/calibration/adjustments', minRank: 2, body: { reason: 'test' } },
  { method: 'GET', path: '/api/admin/users', minRank: 4 },
  { method: 'POST', path: '/api/admin/users', minRank: 4, body: { username: 'x', password: 'abcdef', role: 'operator' } },
  { method: 'PATCH', path: '/api/admin/users/1', minRank: 4, body: { active: true } },
  { method: 'GET', path: '/api/admin/stations', minRank: 4 },
  { method: 'PUT', path: '/api/admin/stations/1', minRank: 4, body: { name: 'x', machine: null, description: null } },
  { method: 'GET', path: '/api/admin/rules', minRank: 4 },
  { method: 'POST', path: '/api/admin/rules/weight', minRank: 4, body: { basis: 'as_recorded', coneTubeWeightG: 5, sackTareKg: 1 } },
  { method: 'POST', path: '/api/admin/rules/shift', minRank: 4, body: { mode: 'corrected', nightBelongsTo: 'start_day' } },
  { method: 'POST', path: '/api/admin/rules/plausibility', minRank: 4, body: { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 } },
  { method: 'GET', path: '/api/admin/audit', minRank: 4 },
];

async function hit(route: RouteCase, cookie: string | null): Promise<number> {
  const res = await fetch(`${base}${route.path}`, {
    method: route.method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(route.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: route.body ? JSON.stringify(route.body) : undefined,
  });
  return res.status;
}

describe('RBAC boundary — every gated route in app.ts, against the real app', () => {
  it.each(ROUTES)('$method $path (needs rank $minRank)', async (route) => {
    // Unauthenticated: always 401, never anything else.
    expect(await hit(route, null)).toBe(401);

    for (const r of ROLES) {
      const status = await hit(route, cookies[r.role]!);
      if (r.rank < route.minRank) {
        expect(status, `${r.role} (rank ${r.rank}) should be blocked from ${route.method} ${route.path} (needs rank ${route.minRank})`).toBe(403);
      } else {
        expect(status, `${r.role} (rank ${r.rank}) should be let through ${route.method} ${route.path} (needs rank ${route.minRank})`).not.toBe(401);
        expect(status, `${r.role} (rank ${r.rank}) should be let through ${route.method} ${route.path} (needs rank ${route.minRank})`).not.toBe(403);
      }
    }
  });
});

describe('Public routes — never gated', () => {
  it('GET /api/health works with no session', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
  });

  it('GET /api/auth/me returns { user: null } with no session, never 401', async () => {
    const res = await fetch(`${base}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ user: null });
  });

  it('GET /api/auth/me returns the real user for a valid session', async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookies['admin']! } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { username: string; role: string } | null };
    expect(body.user?.username).toBe('admin');
    expect(body.user?.role).toBe('admin');
  });

  it('POST /api/auth/login rejects a wrong password with 401, not 403 or 500', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'definitely-wrong' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('Session lifecycle', () => {
  it('a logged-out session can no longer reach a protected route', async () => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: PASSWORD }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect(await hit({ method: 'GET', path: '/api/range', minRank: 1 }, cookie)).not.toBe(401);

    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    expect(await hit({ method: 'GET', path: '/api/range', minRank: 1 }, cookie)).toBe(401);
  });
});
