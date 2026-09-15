/**
 * Roadmap Phase 11 (14 Sep 2026): the password paths, the last-admin guard,
 * the health shape, the auth/export audit rows and the audit paging — over
 * the REAL createApp with a fake pool that records every statement and its
 * bound parameters, the shape app.routes.test.ts established. Plus the RBAC
 * rows for the two new routes, in the form app.rbac.test.ts uses.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';

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
class FakeTransaction {
  constructor(private readonly db: FakeDb) {}
  async begin(): Promise<this> { this.db.txLog.push('begin'); return this; }
  async commit(): Promise<void> { this.db.txLog.push('commit'); }
  async rollback(): Promise<void> { this.db.txLog.push('rollback'); }
  request(): FakeRequest { return new FakeRequest(this.db); }
}

interface User { userId: number; username: string; role: string; rank: number; active: boolean }
const ADMIN: User = { userId: 4, username: 'admin', role: 'admin', rank: 4, active: true };
const ADMIN2: User = { userId: 5, username: 'admin2', role: 'admin', rank: 4, active: true };
const MANAGER: User = { userId: 3, username: 'manager', role: 'manager', rank: 3, active: true };
const OPERATOR: User = { userId: 1, username: 'viewer', role: 'viewer', rank: 1, active: true };

class FakeDb {
  statements: Stmt[] = [];
  txLog: string[] = [];
  hash = '';
  users: User[] = [ADMIN, ADMIN2, MANAGER, OPERATOR];
  sessions = new Map<string, number>();
  /** Overrides for the size probe. */
  sizeMb: number | null = 512;
  dbDown = false;

  request(): FakeRequest { return new FakeRequest(this); }
  transaction(): FakeTransaction { return new FakeTransaction(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const rows = (rs: Record<string, unknown>[]) => ({ recordset: rs as T[], rowsAffected: [rs.length] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) {
      if (this.dbDown) throw new Error('ECONNRESET');
      return row({ ok: 1, size_mb: this.sizeMb });
    }
    if (sql.includes('WHERE u.username = @u') && sql.includes('FROM sms.app_user u JOIN sms.role r')) {
      const u = this.users.find((x) => x.username === inputs.get('u'));
      if (!u) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: u.active });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const uid = this.sessions.get(inputs.get('id') as string);
      const u = this.users.find((x) => x.userId === uid);
      if (!u) return none();
      return row({ user_id: u.userId, username: u.username, display_name: u.username, role: u.role, rank: u.rank });
    }
    if (sql.includes('DELETE FROM sms.session WHERE user_id = @u')) {
      const uid = inputs.get('u') as number;
      const keep = inputs.get('keep') as string | null;
      let n = 0;
      for (const [id, owner] of this.sessions) {
        if (owner === uid && id !== keep) { this.sessions.delete(id); n += 1; }
      }
      return { recordset: [] as T[], rowsAffected: [n] };
    }
    if (sql.includes('DELETE FROM sms.session')) return none();
    // passwordHashOf / usernameOf
    if (sql.includes('SELECT password_hash AS h FROM sms.app_user')) {
      const u = this.users.find((x) => x.userId === inputs.get('id') && x.active);
      return u ? row({ h: this.hash }) : none();
    }
    if (sql.includes('SELECT username AS u FROM sms.app_user')) {
      const u = this.users.find((x) => x.userId === inputs.get('id'));
      return u ? row({ u: u.username }) : none();
    }
    if (sql.includes('UPDATE sms.app_user SET password_hash')) {
      const u = this.users.find((x) => x.userId === inputs.get('id'));
      return { recordset: [] as T[], rowsAffected: [u ? 1 : 0] };
    }
    // last-admin guard
    if (sql.includes("r.name = 'admin'") && sql.includes('u.user_id = @id')) {
      const u = this.users.find((x) => x.userId === inputs.get('id'));
      return row({ n: u && u.active && u.role === 'admin' ? 1 : 0 });
    }
    if (sql.includes("r.name = 'admin'")) {
      return row({ n: this.users.filter((x) => x.active && x.role === 'admin').length });
    }
    // health: acquisition facts
    if (sql.includes('WITH last_ok AS')) return row({ target_table: 'cone_raw', ageSeconds: 30 });
    if (sql.includes('WITH passes AS')) return rows([{ gapSeconds: 60 }, { gapSeconds: 60 }, { gapSeconds: 61 }]);
    if (sql.includes('SELECT MAX(tip) AS tip')) return row({ tip: Date.now() - 5 * 60_000 });
    if (sql.includes('DATEDIFF(SECOND, src_ProductionDate, src_Date)')) return rows([{ lagSeconds: 900 }, { lagSeconds: 1000 }, { lagSeconds: 1100 }]);
    if (sql.includes("outcome IN ('halted', 'failed')") && sql.includes('WITH latest AS')) return rows([{ target_table: 'sack_raw' }]);
    // audit paging
    if (sql.includes('FROM sms.audit_log a')) {
      const n = Number(inputs.get('n'));
      const before = inputs.get('before') as number | null;
      const start = before == null ? 100 : before - 1;
      const out: Record<string, unknown>[] = [];
      for (let id = start; id > 0 && out.length < n; id--) {
        out.push({ audit_id: id, at_utc: new Date(0), actor_id: null, actor_name: null, action: 'x', target_type: 'y', target_id: null, detail: null });
      }
      return rows(out);
    }
    if (/\bOUTPUT\b/i.test(sql)) return row({ id: 1, old_active: true, old_role: 4, old_name: null, old_label: null, old_is_pass: null });
    return none();
  }
}

const PASSWORD = 'ops-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
const cookies: Record<string, string> = {};

async function login(username: string, password = PASSWORD): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  db = new FakeDb();
  db.hash = await argon2.hash(PASSWORD);
  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    lineName: 'Test line',
    liveAllowAsOf: true,
    cacheTtlSeconds: 5,
    trustProxy: false,
    passwordMinLength: 10,
    backupDir: 'Z:\\nowhere\\sms-backups-test',
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
  };
  const app = createApp(db as unknown as import('mssql').ConnectionPool, cfg);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;
  for (const u of [ADMIN, ADMIN2, MANAGER, OPERATOR]) {
    const res = await login(u.username);
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
  db.txLog = [];
  db.users = [ADMIN, ADMIN2, MANAGER, OPERATOR].map((u) => ({ ...u }));
  db.sizeMb = 512;
  db.dbDown = false;
});

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(who ? { Cookie: cookies[who]! } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await new Promise((r) => setTimeout(r, 15)); // fire-and-forget audit rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}
const stmt = (needle: string) => db.statements.find((s) => s.sql.includes(needle));
const audits = () => db.statements.filter((s) => s.sql.includes('INSERT INTO sms.audit_log'));
const sessionIdOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]!);

/* ------------------------------------------------------------ passwords */

describe('POST /api/auth/password — self-service change', () => {
  it('refuses a wrong current password with 403 and writes nothing', async () => {
    const r = await call('viewer', 'POST', '/api/auth/password', { currentPassword: 'nope-not-it', newPassword: 'a-new-password-1' });
    expect(r.status).toBe(403);
    expect(stmt('UPDATE sms.app_user SET password_hash')).toBeUndefined();
    expect(db.txLog).toEqual([]);
  });

  it('applies PASSWORD_MIN_LENGTH (10) before touching the database', async () => {
    const r = await call('viewer', 'POST', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(r.status).toBe(400);
    expect(r.json.detail).toMatch(/at least 10 characters/);
    expect(db.statements.filter((s) => !s.sql.includes('FROM sms.session s'))).toHaveLength(0);
  });

  it('refuses reusing the current password', async () => {
    const r = await call('viewer', 'POST', '/api/auth/password', { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(r.status).toBe(400);
    expect(r.json.detail).toMatch(/differ/);
  });

  it('on success: new hash, every OTHER session revoked (own kept), audit row, one transaction', async () => {
    // Give the viewer a second session that must be revoked.
    const second = await login('viewer');
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0]!;
    db.statements = [];
    db.txLog = [];

    const r = await call('viewer', 'POST', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a-new-password-1' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, otherSessionsRevoked: 1 });

    const upd = stmt('UPDATE sms.app_user SET password_hash')!;
    expect(upd.inputs.get('id')).toBe(OPERATOR.userId);
    expect(await argon2.verify(upd.inputs.get('h') as string, 'a-new-password-1')).toBe(true);

    const rev = stmt('DELETE FROM sms.session WHERE user_id = @u')!;
    expect(rev.inputs.get('u')).toBe(OPERATOR.userId);
    expect(rev.inputs.get('keep')).toBe(sessionIdOf(cookies['viewer']!));
    // the second session is gone, the caller's own survives
    expect(db.sessions.has(sessionIdOf(secondCookie))).toBe(false);
    expect(db.sessions.has(sessionIdOf(cookies['viewer']!))).toBe(true);

    const a = audits().find((s) => s.inputs.get('action') === 'auth.password_change')!;
    expect(a).toBeDefined();
    expect(a.inputs.get('actor')).toBe(OPERATOR.userId);
    expect(a.inputs.get('detail')).toBe('other sessions revoked: 1');
    expect(db.txLog).toEqual(['begin', 'commit']);
  });
});

describe('POST /api/admin/users/:id/password — administrator reset', () => {
  it('refuses the actor\'s own id (use the self route)', async () => {
    const r = await call('admin', 'POST', `/api/admin/users/${ADMIN.userId}/password`, { newPassword: 'a-new-password-1' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/self-service/);
    expect(stmt('UPDATE sms.app_user SET password_hash')).toBeUndefined();
  });

  it('404s an unknown user', async () => {
    const r = await call('admin', 'POST', '/api/admin/users/999/password', { newPassword: 'a-new-password-1' });
    expect(r.status).toBe(404);
  });

  it('applies the policy', async () => {
    const r = await call('admin', 'POST', `/api/admin/users/${MANAGER.userId}/password`, { newPassword: 'tiny' });
    expect(r.status).toBe(400);
  });

  it('on success: hash set, EVERY session of the target revoked (keep = null), audited user.password_reset', async () => {
    const r = await call('admin', 'POST', `/api/admin/users/${MANAGER.userId}/password`, { newPassword: 'reset-by-admin-1' });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.sessionsRevoked).toBe(1);
    const rev = stmt('DELETE FROM sms.session WHERE user_id = @u')!;
    expect(rev.inputs.get('u')).toBe(MANAGER.userId);
    expect(rev.inputs.get('keep')).toBeNull();
    expect(db.sessions.has(sessionIdOf(cookies['manager']!))).toBe(false);
    const a = audits().find((s) => s.inputs.get('action') === 'user.password_reset')!;
    expect(a.inputs.get('actor')).toBe(ADMIN.userId);
    expect(a.inputs.get('target')).toBe(String(MANAGER.userId));
    expect(a.inputs.get('detail')).toBe('username manager; sessions revoked: 1');
    expect(db.txLog).toEqual(['begin', 'commit']);
    // the manager's cookie is now dead
    const after = await fetch(`${base}/api/range`, { headers: { Cookie: cookies['manager']! } });
    expect(after.status).toBe(401);
    // restore a manager session for the tests that follow
    const again = await login('manager');
    cookies['manager'] = again.headers.get('set-cookie')!.split(';')[0]!;
  });
});

/* ------------------------------------------------------ last-admin guard */

describe('PATCH /api/admin/users/:id — last active admin cannot be removed', () => {
  it('409 on deactivating the only active admin; the transaction is rolled back, no audit row', async () => {
    db.users = db.users.filter((u) => u.username !== 'admin2'); // one admin left
    const r = await call('admin', 'PATCH', `/api/admin/users/${ADMIN.userId}`, { active: false });
    expect(r.status).toBe(409);
    expect(r.json.detail).toMatch(/last active administrator/);
    expect(stmt('UPDATE sms.app_user SET active')).toBeUndefined();
    expect(audits()).toHaveLength(0);
    expect(db.txLog).toEqual(['begin', 'rollback']);
  });

  it('409 on demoting the only active admin', async () => {
    db.users = db.users.filter((u) => u.username !== 'admin2');
    const r = await call('admin', 'PATCH', `/api/admin/users/${ADMIN.userId}`, { role: 'manager' });
    expect(r.status).toBe(409);
  });

  it('allowed when another active admin exists', async () => {
    const r = await call('admin', 'PATCH', `/api/admin/users/${ADMIN2.userId}`, { active: false });
    expect(r.status).toBe(200);
    expect(stmt('UPDATE sms.app_user SET active')).toBeDefined();
  });

  it('deactivating a non-admin never counts the admins', async () => {
    const r = await call('admin', 'PATCH', `/api/admin/users/${OPERATOR.userId}`, { active: false });
    expect(r.status).toBe(200);
    // "is the target an active admin?" is asked (one seek); the count is not.
    const adminQueries = db.statements.filter((s) => s.sql.includes("r.name = 'admin'"));
    expect(adminQueries).toHaveLength(1);
    expect(adminQueries[0]!.sql).toMatch(/u\.user_id = @id/);
  });
});

/* ---------------------------------------------------------------- health */

describe('GET /api/health — shape, redaction, status', () => {
  it('unauthenticated: status and service, database size and acquisition nulled', async () => {
    const r = await call(null, 'GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('degraded'); // one table halted in the fixture — still visible as the WORD
    expect(r.json.service.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof r.json.service.uptimeSeconds).toBe('number');
    expect(typeof r.json.service.pid).toBe('number');
    expect(r.json.database).toEqual({ ok: true, latencyMs: expect.any(Number), sizeMb: null, capMb: 10240, pctOfCap: null });
    expect(r.json.acquisition).toEqual({ kind: null, ageSeconds: null, cadenceSeconds: null, halted: null });
    expect(r.json.backup).toBeNull();
    expect(r.json.degradedReason).toBeNull();
  });

  it('signed in (any rank): the details are filled in', async () => {
    const r = await call('viewer', 'GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.database.sizeMb).toBe(512);
    expect(r.json.database.pctOfCap).toBe(5);
    expect(r.json.acquisition).toEqual({ kind: 'ok', ageSeconds: 30, cadenceSeconds: 60, halted: ['sack_raw'] });
    expect(r.json.backup).toMatchObject({ newestFile: null, ageDays: null, warning: true });
  });

  it('a data file past 80 % of the cap degrades the status', async () => {
    db.sizeMb = 9000;
    const r = await call('viewer', 'GET', '/api/health');
    expect(r.json.status).toBe('degraded');
    expect(r.json.database.pctOfCap).toBe(87.9);
  });

  it('a dead database is status down with 503, never a 500', async () => {
    db.dbDown = true;
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    const j = (await res.json()) as { status: string; database: { ok: boolean } };
    expect(j.status).toBe('down');
    expect(j.database.ok).toBe(false);
  });
});

/* ---------------------------------------------------------- audit events */

describe('auth and export events are audited', () => {
  it('a successful login writes auth.login with the user as actor', async () => {
    const res = await login('viewer');
    await new Promise((r) => setTimeout(r, 15));
    expect(res.status).toBe(200);
    const a = audits().find((s) => s.inputs.get('action') === 'auth.login')!;
    expect(a).toBeDefined();
    expect(a.inputs.get('actor')).toBe(OPERATOR.userId);
  });

  it('a failed login writes auth.login_failed naming the username, no actor, never the password', async () => {
    const res = await login('viewer', 'the-wrong-password');
    await new Promise((r) => setTimeout(r, 15));
    expect(res.status).toBe(401);
    const a = audits().find((s) => s.inputs.get('action') === 'auth.login_failed')!;
    expect(a).toBeDefined();
    expect(a.inputs.get('actor')).toBeNull();
    expect(a.inputs.get('target')).toBe('viewer');
    for (const v of a.inputs.values()) expect(String(v)).not.toContain('the-wrong-password');
  });

  it('logout writes auth.logout', async () => {
    const extra = await login('viewer');
    const c = extra.headers.get('set-cookie')!.split(';')[0]!;
    db.statements = [];
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: c } });
    await new Promise((r) => setTimeout(r, 15));
    const a = audits().find((s) => s.inputs.get('action') === 'auth.logout')!;
    expect(a).toBeDefined();
    expect(a.inputs.get('actor')).toBe(OPERATOR.userId);
  });

  it('a CSV export writes export.csv naming the register', async () => {
    const r = await call('manager', 'GET', '/api/events/export?type=cone&from=2026-09-01&to=2026-09-07');
    expect(r.status).toBe(200);
    const a = audits().find((s) => s.inputs.get('action') === 'export.csv')!;
    expect(a).toBeDefined();
    expect(a.inputs.get('type')).toBe('register');
    expect(a.inputs.get('target')).toBe('cone');
    expect(a.inputs.get('detail')).toBe('2026-09-01 to 2026-09-07');
  });
});

/* ------------------------------------------------------------ audit paging */

describe('GET /api/admin/audit — keyset paging', () => {
  it('the first page is the newest rows and names the cursor for the next', async () => {
    const r = await call('admin', 'GET', '/api/admin/audit?limit=10');
    expect(r.status).toBe(200);
    expect(r.json.entries).toHaveLength(10);
    expect(r.json.entries[0].auditId).toBe(100);
    expect(r.json.nextBefore).toBe(91);
    const q = stmt('FROM sms.audit_log a')!;
    expect(q.inputs.get('n')).toBe(11); // one extra to know whether there is more
    expect(q.inputs.get('before')).toBeNull();
    expect(q.sql).toMatch(/a\.audit_id < @before/);
  });

  it('`before` binds and the last page has no cursor', async () => {
    const r = await call('admin', 'GET', '/api/admin/audit?before=8&limit=10');
    expect(r.json.entries.map((e: { auditId: number }) => e.auditId)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(r.json.nextBefore).toBeNull();
    expect(stmt('FROM sms.audit_log a')!.inputs.get('before')).toBe(8);
  });
});

/* -------------------------------------------------------------------- RBAC */

describe('RBAC rows for the Phase 11 routes', () => {
  const ROLES = [OPERATOR, MANAGER, ADMIN];
  it.each([
    { method: 'POST', path: '/api/auth/password', minRank: 1, body: { currentPassword: 'x', newPassword: 'y' } },
    { method: 'POST', path: `/api/admin/users/${MANAGER.userId}/password`, minRank: 4, body: { newPassword: 'a-new-password-1' } },
  ])('$method $path (needs rank $minRank)', async (route) => {
    const anon = await call(null, route.method, route.path, route.body);
    expect(anon.status).toBe(401);
    for (const u of ROLES) {
      const r = await call(u.username, route.method, route.path, route.body);
      if (u.rank < route.minRank) expect(r.status, `${u.username} on ${route.path}`).toBe(403);
      else {
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(401);
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(403);
      }
    }
  });
});
