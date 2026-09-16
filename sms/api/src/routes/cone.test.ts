/**
 * POST /api/products/limits/local — the SMS-local limit editor's route
 * (roadmap Phase 4 item 2, 15 Sep 2026: IFL wants limits editable from Setup;
 * nothing may write to PDAS yet). Same fixture shape as routes/sacks.test.ts
 * — a recording fake pool with four accounts, argon2 credentials, Node's
 * fetch, against the REAL createApp.
 *
 * Pinned here:
 *  - engineer rank (2), same as /api/current-product and the PDAS write path;
 *  - a successful call is ONE INSERT (never an UPDATE) into
 *    sms.product_limit_version with source 'sms_local', PLUS the audit row,
 *    both inside ONE transaction (auditedWrite);
 *  - PDAS_WRITE_ENABLED is unset in this fixture's config throughout — the
 *    route never touches pdas.enabled and never opens the writer pool;
 *  - an unknown product, an implausible window and a future effective_from
 *    are all refused before anything is written.
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

interface User { userId: number; username: string; role: string; rank: number }
const USERS: User[] = [
  { userId: 1, username: 'viewer', role: 'viewer', rank: 1 },
  { userId: 2, username: 'engineer', role: 'engineer', rank: 2 },
  { userId: 3, username: 'manager', role: 'manager', rank: 3 },
  { userId: 4, username: 'admin', role: 'admin', rank: 4 },
];

class FakeDb {
  statements: Stmt[] = [];
  txLog: string[] = [];
  hash = '';
  sessions = new Map<string, number>();
  nextVersionId = 501;
  /** Products the mirror knows. */
  products = new Set<number>([20]);

  request(): FakeRequest { return new FakeRequest(this); }
  transaction(): FakeTransaction { return new FakeTransaction(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

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
    if (sql.includes('sms.plausibility_rule')) return row({ cl: 1500, ch: 2100, sl: 40, sh: 60 });
    if (sql.includes('FROM sms.product WHERE product_id')) {
      return row({ n: this.products.has(inputs.get('id') as number) ? 1 : 0 });
    }
    if (sql.includes('INSERT INTO sms.product_limit_version')) {
      return row({ version_id: this.nextVersionId++ });
    }
    if (sql.includes('FROM sms.product ORDER BY product_id') || sql.includes('FROM sms.product_limit_version v')) {
      // GET .../history, read back after a successful write — empty is fine.
      return none();
    }
    return none();
  }
}

const PASSWORD = 'cone-routes-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
const cookies: Record<string, string> = {};

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
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    // PDAS_WRITE_ENABLED unset throughout this file — the local limits path
    // must work regardless.
    pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
  };
  const app = createApp(db as unknown as import('mssql').ConnectionPool, cfg);
  server = app.listen(0);
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
  db.txLog = [];
});

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(who ? { Cookie: cookies[who]! } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

const BODY = { productId: 20, setpointG: 1970, offsetMinusG: 40, offsetPlusG: 40, reason: 'recalibration' };

describe('POST /api/products/limits/local — rank', () => {
  it('refuses without a session, refuses rank 1 (viewer), accepts rank 2 and above', async () => {
    expect((await call(null, 'POST', '/api/products/limits/local', BODY)).status).toBe(401);
    const viewer = await call('viewer', 'POST', '/api/products/limits/local', BODY);
    expect(viewer.status).toBe(403);
    for (const who of ['engineer', 'manager', 'admin']) {
      const r = await call(who, 'POST', '/api/products/limits/local', BODY);
      expect(r.status, who).not.toBe(401);
      expect(r.status, who).not.toBe(403);
      expect(r.status, who).toBe(200);
    }
  });
});

describe('POST /api/products/limits/local — what it writes', () => {
  it('is one INSERT (never an UPDATE) into product_limit_version, source sms_local, plus the audit row, in one transaction', async () => {
    const r = await call('engineer', 'POST', '/api/products/limits/local', BODY);
    expect(r.status).toBe(200);
    // The RBAC test above already appended a few versions on this shared fake
    // DB (db.statements/txLog reset per test, but the IDENTITY counter does
    // not, same as a real one never would) — so pin the shape, not a literal.
    expect(typeof r.json.versionId).toBe('number');
    expect(r.json.versionId).toBeGreaterThan(0);

    const insert = db.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(insert).toBeDefined();
    expect(db.statements.some((s) => /UPDATE\s+sms\.product_limit_version/i.test(s.sql))).toBe(false);
    // never sms.product, never anything PDAS
    expect(db.statements.some((s) => /UPDATE\s+sms\.product\b/i.test(s.sql))).toBe(false);
    expect(db.statements.some((s) => /PDAS|dbo\./i.test(s.sql))).toBe(false);

    expect(insert.inputs.get('src')).toBe('sms_local');
    expect(insert.inputs.get('pid')).toBe(20);
    expect(insert.inputs.get('sp')).toBe(1970);
    expect(insert.inputs.get('om')).toBe(40);
    expect(insert.inputs.get('op')).toBe(40);
    expect(insert.inputs.get('lb')).toBe(false); // never a lower bound — this IS the decision, not an observation
    expect(insert.inputs.get('by')).toBe(2); // the engineer's userId
    expect(insert.inputs.get('reason')).toBe('recalibration');

    expect(db.txLog).toEqual(['begin', 'commit']);
    const audit = db.statements.find((s) => s.sql.includes('INSERT INTO sms.audit_log'))!;
    expect(audit).toBeDefined();
    expect(audit.inputs.get('action')).toBe('product.limits.local');
    expect(audit.inputs.get('actor')).toBe(2);
    expect(audit.inputs.get('target')).toBe('20');
    // the audit row commits in the SAME transaction as the version row —
    // both after 'begin' and before 'commit', not a separate fire-and-forget write.
    expect(db.statements.indexOf(audit)).toBeGreaterThan(db.statements.indexOf(insert));
  });

  it('refuses an unknown product before writing anything', async () => {
    const r = await call('engineer', 'POST', '/api/products/limits/local', { ...BODY, productId: 999 });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe('UNKNOWN_PRODUCT');
    expect(db.statements.some((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))).toBe(false);
    expect(db.txLog).toEqual(['begin', 'rollback']);
  });

  it('refuses a setpoint outside the plausible cone range, and a zero offset', async () => {
    const bad = await call('engineer', 'POST', '/api/products/limits/local', { ...BODY, setpointG: 5000 });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('IMPLAUSIBLE');
    const zeroOffset = await call('engineer', 'POST', '/api/products/limits/local', { ...BODY, offsetMinusG: 0 });
    // offsetMinusG must be > 0 per the zod schema (z.coerce.number().positive())
    expect(zeroOffset.status).toBe(400);
    expect(db.statements.some((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))).toBe(false);
  });

  it('refuses an effective_from in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const r = await call('engineer', 'POST', '/api/products/limits/local', { ...BODY, effectiveFrom: future });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('FUTURE');
    expect(db.statements.some((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))).toBe(false);
  });
});
