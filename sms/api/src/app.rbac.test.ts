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
// 'http', NOT 'node:http'. Express's own types reference the bare-specifier
// module, and with the installed @types/node the two resolve to structurally
// different Server types ("Property 'keepAliveTimeoutBuffer' is missing"), so
// `app.listen()`'s return would not assign to a node:http Server. Matching
// express's specifier fixes it without touching any dependency version.
import type { Server } from 'http';
import argon2 from 'argon2';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/**
 * Stands in for mssql.Transaction. auditedWrite() (services/audit.ts) runs
 * every configuration write through `pool.transaction()`, so the fake pool
 * must hand one out; it answers queries exactly as the pool does.
 */
class FakeTransaction {
  constructor(private readonly db: FakeDb) {}
  async begin(): Promise<this> { return this; }
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
  request(): FakeRequest { return new FakeRequest(this.db); }
}

class FakeDb {
  users: FakeUser[] = [];
  sessions = new Map<string, { userId: number; expiresAtUtc: Date }>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction(): FakeTransaction {
    return new FakeTransaction(this);
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
// The four names since migration 035 (15 Sep 2026): viewer / engineer / manager / admin.
const ROLES: { role: string; rank: number }[] = [
  { role: 'viewer', rank: 1 },
  { role: 'engineer', rank: 2 },
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
  // but it logs — one JSON line on stdout per refused request and per 500
  // since 14 Sep 2026 (api/src/log.ts). Quiet that expected noise; a genuine
  // assertion failure still surfaces through vitest's own reporting, not this.
  // The logger's own shape is asserted in app.log.test.ts.
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

  const db = new FakeDb();
  const hash = await argon2.hash(PASSWORD);
  ROLES.forEach((r, i) => db.users.push({ userId: i + 1, username: r.role, passwordHash: hash, role: r.role, rank: r.rank }));

  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    lineName: 'Test line',
    liveAllowAsOf: true,
    cacheTtlSeconds: 5,
    trustProxy: false,
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    // Off, as in production, until the local end-to-end test on the local
    // database copy has passed (DEFECTS.md D-12). The write routes must
    // still exist and answer 503 with this reason, not 404.
    pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
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
// (viewer=1, engineer=2, manager=3, admin=4). The write matrix is IFL's of
// 15 Sep 2026 (DEPLOY.md, "Roles and the write matrix"): engineer sets the
// product, its limits, reject-code names, calibration and sack movements;
// manager exports and reads the management summary; admin owns Setup.

interface RouteCase {
  method: string;
  path: string;
  minRank: number;
  body?: unknown;
}

const ROUTES: RouteCase[] = [
  // blanket requireRole(1) tier
  { method: 'GET', path: '/api/range', minRank: 1 },
  { method: 'GET', path: '/api/live', minRank: 1 },
  { method: 'GET', path: '/api/report?period=day&anchor=2026-07-09', minRank: 1 },
  { method: 'GET', path: '/api/operations', minRank: 1 },
  { method: 'GET', path: '/api/production', minRank: 1 },
  { method: 'GET', path: '/api/downtime', minRank: 1 },
  { method: 'GET', path: '/api/spc?type=cone', minRank: 1 },
  { method: 'GET', path: '/api/reject-spc', minRank: 1 },
  { method: 'GET', path: '/api/events?type=cone', minRank: 1 },
  { method: 'GET', path: '/api/events/cone/1', minRank: 1 },
  { method: 'GET', path: '/api/rejects', minRank: 1 },
  { method: 'GET', path: '/api/weights', minRank: 1 },
  { method: 'GET', path: '/api/products', minRank: 1 },
  { method: 'GET', path: '/api/current-product', minRank: 1 },
  { method: 'GET', path: '/api/product-timeline', minRank: 1 },
  { method: 'GET', path: '/api/calibration?from=2026-07-09&to=2026-07-09', minRank: 1 },
  { method: 'GET', path: '/api/calibration/adjustments', minRank: 1 },
  // roadmap Phase 9 (15 Sep 2026): the ledger filters and the rule table
  { method: 'GET', path: '/api/calibration/adjustments?from=2026-09-01&to=2026-09-07&station=7', minRank: 1 },
  { method: 'GET', path: '/api/calibration/rules?points=12', minRank: 1 },
  { method: 'GET', path: '/api/config', minRank: 1 },
  { method: 'GET', path: '/api/reject-codes', minRank: 1 },
  // roadmap Phase 4 (routes/cone.ts)
  { method: 'GET', path: '/api/products/limits/history', minRank: 1 },
  { method: 'GET', path: '/api/machines/running', minRank: 1 },
  { method: 'GET', path: '/api/shift-check?from=2026-09-01&to=2026-09-07', minRank: 1 },
  { method: 'GET', path: '/api/reconciliation?from=2026-09-01&to=2026-09-07', minRank: 1 },
  // roadmap Phase 5 (routes/rejects.ts) — reads, open to every signed-in account
  { method: 'GET', path: '/api/rejects/by-day-code?from=2026-09-01&to=2026-09-07', minRank: 1 },
  { method: 'GET', path: '/api/rejects/reason?day=2026-09-07&code=1-3', minRank: 1 },
  // route-specific gates
  { method: 'GET', path: '/api/events/export?type=cone', minRank: 3 },
  { method: 'PUT', path: '/api/reject-codes/1', minRank: 2, body: { label: 'x' } },
  { method: 'POST', path: '/api/current-product', minRank: 2, body: { productId: 1 } },
  { method: 'POST', path: '/api/calibration/adjustments', minRank: 2, body: { reason: 'test' } },
  // the PDAS write path (flag off here, so an allowed rank answers 503 or 400 — never 401/403)
  { method: 'POST', path: '/api/products', minRank: 2, body: {} },
  { method: 'POST', path: '/api/products/21/active', minRank: 2, body: { active: false, reason: 'rbac boundary test' } },
  { method: 'POST', path: '/api/products/21/limits', minRank: 2, body: {} },
  { method: 'GET', path: '/api/admin/users', minRank: 4 },
  { method: 'POST', path: '/api/admin/users', minRank: 4, body: { username: 'x', password: 'abcdef', role: 'viewer' } },
  { method: 'PATCH', path: '/api/admin/users/1', minRank: 4, body: { active: true } },
  { method: 'GET', path: '/api/admin/stations', minRank: 4 },
  { method: 'PUT', path: '/api/admin/stations/1', minRank: 4, body: { name: 'x', machine: null, description: null } },
  { method: 'POST', path: '/api/admin/stations', minRank: 4, body: { stationId: 15 } },
  // roadmap Phase 1 (14 Sep 2026): line identity, machines, sources
  { method: 'GET', path: '/api/admin/line', minRank: 4 },
  { method: 'PUT', path: '/api/admin/line', minRank: 4, body: { displayName: 'x' } },
  { method: 'GET', path: '/api/admin/machines', minRank: 4 },
  { method: 'POST', path: '/api/admin/machines', minRank: 4, body: { machineNo: 15, kind: 'winder', name: 'Winder 15' } },
  { method: 'PUT', path: '/api/admin/machines/1', minRank: 4, body: { name: 'x' } },
  { method: 'GET', path: '/api/admin/sources', minRank: 4 },
  { method: 'PUT', path: '/api/admin/sources/1', minRank: 4, body: { isEnabled: true } },
  { method: 'PUT', path: '/api/admin/sources/tables/1', minRank: 4, body: { isEnabled: true } },
  { method: 'GET', path: '/api/admin/rules', minRank: 4 },
  { method: 'POST', path: '/api/admin/rules/weight', minRank: 4, body: { basis: 'as_recorded', coneTubeWeightG: 5, sackTareKg: 1 } },
  { method: 'POST', path: '/api/admin/rules/shift', minRank: 4, body: { morningStart: '06:00', eveningStart: '14:00', nightStart: '22:00', mode: 'corrected', nightBelongsTo: 'start_day' } },
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
      body: JSON.stringify({ username: 'viewer', password: PASSWORD }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect(await hit({ method: 'GET', path: '/api/range', minRank: 1 }, cookie)).not.toBe(401);

    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    expect(await hit({ method: 'GET', path: '/api/range', minRank: 1 }, cookie)).toBe(401);
  });
});

/* =====================================================================*
 * GUARD 2, Part B (UX Phase 7 Brief 4) — mechanical enumeration of every *
 * GET route's requireRole gate, against the app.ts/routes/*.ts SOURCE,  *
 * not the curated ROUTES table above.                                   *
 *                                                                        *
 * The ROUTES table above is a hand-picked boundary test: it proves the  *
 * gates it lists behave correctly, but it says nothing about a route    *
 * NOT on the list — exactly how /api/reconciliation shipped at          *
 * requireRole(3) in Phase 6 (owner-approved fix, lowered to rank 1,     *
 * `git log --oneline -- api/src/routes/cone.ts` around "UX Phase 6      *
 * Brief 4") in violation of CLAUDE.md's ONE AUDIENCE rule: every screen *
 * is open to every signed-in account; only Setup (and by extension the  *
 * admin-only management surface) is rank >= 4, and everything else that *
 * gates at all is a WRITE, not a read. This block reads app.ts and      *
 * every routes/*.ts file off disk (node:fs, no import of the real       *
 * modules — same "deliberately dumb" idiom as targets.guard.test.ts and *
 * api.callers.test.ts in web/src) and fails if any GET route acquires a *
 * requireRole gate this list does not already name.                     *
 * =====================================================================*/
describe('GUARD 2, Part B — every GET route\'s requireRole gate is on the written list', () => {
  const apiSrcDir = fileURLToPath(new URL('.', import.meta.url));

  function listRouteFiles(): string[] {
    const routesDir = `${apiSrcDir}routes`;
    const routeFiles = readdirSync(routesDir)
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .map((f) => `${routesDir}/${f}`);
    return [`${apiSrcDir}app.ts`, ...routeFiles];
  }

  interface GetRoute { file: string; path: string; rankArg: string | null }

  /**
   * `app.get('/api/foo', requireRole(N), ...)` — deliberately single-line
   * (every GET registration in this codebase is written on one line, the
   * canary test below proves the scan still finds a realistic number of
   * them so a reformat that breaks this assumption is caught, not silently
   * under-counted).
   */
  const GET_RE = /app\.get\(\s*(['"])([^'"]+)\1\s*,\s*(?:(requireRole\(([^)]+)\))\s*,\s*)?/;

  function listGetRoutes(): GetRoute[] {
    const out: GetRoute[] = [];
    for (const file of listRouteFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const rawLine of src.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('app.get(')) continue;
        const m = GET_RE.exec(line);
        if (!m) continue;
        const path = m[2]!;
        if (!path.startsWith('/api/')) continue; // the SPA catch-all ('*') is not an API route
        out.push({ file, path, rankArg: m[4] ?? null });
      }
    }
    return out;
  }

  /** Resolves a requireRole(...) argument literal to a rank number, without
   *  importing the real module — read straight off the one file that
   *  defines it, so a rename or a changed value is caught rather than
   *  silently trusted. */
  function resolveRankArg(arg: string): number {
    if (/^\d+$/.test(arg)) return Number(arg);
    if (arg === 'EXPORT_RANK') {
      const commonSrc = readFileSync(`${apiSrcDir}services/reports/common.ts`, 'utf8');
      const m = /export const EXPORT_RANK\s*=\s*(\d+)/.exec(commonSrc);
      if (!m) throw new Error('EXPORT_RANK definition not found in services/reports/common.ts — update this guard');
      return Number(m[1]);
    }
    throw new Error(`GUARD 2 Part B does not know how to resolve requireRole(${arg}) to a rank — update resolveRankArg`);
  }

  it('sanity: the scan actually found GET routes (canary on the scan itself)', () => {
    expect(listGetRoutes().length).toBeGreaterThan(30);
  });

  it('the only GET routes gated above rank 1 are the register export, the report export, and /api/admin/*', () => {
    const violations: string[] = [];
    for (const route of listGetRoutes()) {
      const rank = route.rankArg == null ? 1 : resolveRankArg(route.rankArg);
      if (rank === 1) continue; // the blanket app.use('/api', requireRole(1)) tier — the default, not a violation
      const isRegisterExport = route.path === '/api/events/export' && rank === 3;
      const isReportExport = route.path === '/api/reports/:type/export' && rank === 3;
      const isAdminRoute = route.path.startsWith('/api/admin/') && rank === 4;
      if (isRegisterExport || isReportExport || isAdminRoute) continue;
      violations.push(`${route.path} (GET, requireRole(${rank}))`);
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these GET routes are gated above rank 1 and are not on the written list (register export rank 3, report ` +
            `export rank 3, /api/admin/* rank 4): ${violations.join(', ')}. Per CLAUDE.md's ONE AUDIENCE rule every ` +
            `screen is open to every signed-in account; a read gated above rank 1 outside the three named exceptions ` +
            `is the exact defect Phase 6 found and fixed at /api/reconciliation (was requireRole(3), lowered to rank ` +
            `1 with owner approval). If this is deliberate and owner-approved, update this test's exception list; if ` +
            `not, remove the requireRole call.`,
    ).toEqual([]);
  });

  it('the register export and the report export routes still exist and are still gated (canary against the check being vacuous)', () => {
    const routes = listGetRoutes();
    const registerExport = routes.find((r) => r.path === '/api/events/export');
    const reportExport = routes.find((r) => r.path === '/api/reports/:type/export');
    expect(registerExport?.rankArg, '/api/events/export no longer requireRole-gated at all — update this guard').not.toBeNull();
    expect(reportExport?.rankArg, "/api/reports/:type/export no longer requireRole-gated at all — update this guard").not.toBeNull();
    expect(resolveRankArg(registerExport!.rankArg!)).toBe(3);
    expect(resolveRankArg(reportExport!.rankArg!)).toBe(3);
  });

  it('every /api/admin/* GET route found is actually rank 4 (canary — an admin route silently downgraded would otherwise pass the exception check above)', () => {
    const adminGets = listGetRoutes().filter((r) => r.path.startsWith('/api/admin/'));
    expect(adminGets.length).toBeGreaterThan(3);
    for (const r of adminGets) {
      expect(r.rankArg, `${r.path} has no requireRole at all`).not.toBeNull();
      expect(resolveRankArg(r.rankArg!), `${r.path} is not rank 4`).toBe(4);
    }
  });
});
