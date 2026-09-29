/**
 * POST /api/dq-findings/:id/ack (Task W2-B, 29 Sep 2026, failure analysis
 * F-24) against the REAL createApp, same fixture shape as
 * routes/changeover.test.ts: a recording fake pool, four accounts, argon2
 * credentials, Node's fetch.
 *
 * Pinned here:
 *  - rank 1 -> 403, rank >= 2 -> reaches the service;
 *  - acknowledging a system-state check (persistent_sync_failure) -> 409;
 *  - acknowledging an unknown finding_id -> 404;
 *  - a short reason (<10 chars) -> 400, with no INSERT attempted;
 *  - a successful acknowledgement writes sms.dq_acknowledgement AND an
 *    sms.audit_log row naming the actor.
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

interface User { userId: number; username: string; role: string; rank: number }
const USERS: User[] = [
  { userId: 1, username: 'viewer', role: 'viewer', rank: 1 },
  { userId: 2, username: 'engineer', role: 'engineer', rank: 2 },
  { userId: 3, username: 'manager', role: 'manager', rank: 3 },
  { userId: 4, username: 'admin', role: 'admin', rank: 4 },
];

/** finding_id -> check_name, seeded per test with `db.findings`. */
class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();
  findings = new Map<number, string>();
  acks = new Set<number>();

  request(): FakeRequest { return new FakeRequest(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    // ---- auth (same shape as routes/changeover.test.ts) ----
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

    // ---- dqAck.ts ----
    if (sql.includes('SELECT check_name FROM sms.dq_finding')) {
      const id = inputs.get('id') as number;
      const check = this.findings.get(id);
      return check ? row({ check_name: check }) : none();
    }
    if (sql.includes('SELECT COUNT(*) AS n FROM sms.dq_acknowledgement')) {
      const id = inputs.get('id') as number;
      return row({ n: this.acks.has(id) ? 1 : 0 });
    }
    if (sql.includes('INSERT INTO sms.dq_acknowledgement')) {
      const id = inputs.get('id') as number;
      this.acks.add(id);
      return row({ acknowledged_utc: new Date('2026-09-29T12:00:00.000Z') });
    }
    if (sql.includes('INSERT INTO sms.audit_log')) return none();

    return none();
  }
}

const PASSWORD = 'dqack-routes-test-password-not-real';
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
  db.findings = new Map();
  db.acks = new Set();
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

const REASON = 'known clock-fault day, already reviewed';

describe('RBAC row for POST /api/dq-findings/:id/ack', () => {
  it('signed out -> 401; rank 1 -> 403; rank >= 2 reaches the service', async () => {
    db.findings.set(1, 'nonpositive_weight');
    expect((await call(null, 'POST', '/api/dq-findings/1/ack', { reason: REASON })).status).toBe(401);
    for (const u of USERS) {
      const r = await call(u.username, 'POST', '/api/dq-findings/1/ack', { reason: REASON });
      if (u.rank < 2) {
        expect(r.status, u.username).toBe(403);
      } else {
        expect(r.status, u.username).not.toBe(401);
        expect(r.status, u.username).not.toBe(403);
        expect(r.status, u.username).not.toBe(500);
      }
    }
  });
});

describe('POST /api/dq-findings/:id/ack — validation and refusals', () => {
  it('404s an unknown finding_id', async () => {
    const r = await call('engineer', 'POST', '/api/dq-findings/999/ack', { reason: REASON });
    expect(r.status).toBe(404);
  });

  it('409s a system-state check (persistent_sync_failure) — never acknowledgeable', async () => {
    db.findings.set(2, 'persistent_sync_failure');
    const r = await call('engineer', 'POST', '/api/dq-findings/2/ack', { reason: REASON });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('NOT_ALLOWED');
  });

  it('400s a reason under 10 characters, with no INSERT attempted', async () => {
    db.findings.set(3, 'nonpositive_weight');
    const r = await call('engineer', 'POST', '/api/dq-findings/3/ack', { reason: 'too short' });
    expect(r.status).toBe(400);
    expect(db.statements.some((s) => s.sql.includes('INSERT INTO sms.dq_acknowledgement'))).toBe(false);
  });

  it('409s a finding already acknowledged', async () => {
    db.findings.set(4, 'stale_timestamp');
    db.acks.add(4);
    const r = await call('engineer', 'POST', '/api/dq-findings/4/ack', { reason: REASON });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('ALREADY_ACKNOWLEDGED');
  });
});

describe('POST /api/dq-findings/:id/ack — success', () => {
  it('acknowledges an allow-listed finding and writes an audit_log row naming the actor', async () => {
    db.findings.set(5, 'nonpositive_weight');
    const r = await call('engineer', 'POST', '/api/dq-findings/5/ack', { reason: REASON });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ findingId: 5, reason: REASON });

    const insert = db.statements.find((s) => s.sql.includes('INSERT INTO sms.dq_acknowledgement'));
    expect(insert).toBeDefined();
    expect(insert!.inputs.get('id')).toBe(5);
    expect(insert!.inputs.get('by')).toBe(2); // the engineer
    expect(insert!.inputs.get('reason')).toBe(REASON);

    const audit = db.statements.find((s) => s.sql.includes('INSERT INTO sms.audit_log') && s.inputs.get('action') === 'dq_finding.ack');
    expect(audit).toBeDefined();
    expect(audit!.inputs.get('actor')).toBe(2);
    expect(audit!.inputs.get('target')).toBe('5');
  });
});
