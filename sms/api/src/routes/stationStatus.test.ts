/**
 * GET /api/station-status (redesign task D2b) against the REAL createApp with
 * the service and envelope mocked: auth/RBAC, query validation, shift-range
 * decoding, the cache, and the absence of any tsTo handling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';

const svc = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../services/stationStatus.js', async (orig) => ({
  ...(await orig<typeof import('../services/stationStatus.js')>()),
  getStationStatus: async (...a: unknown[]) => {
    svc.calls.push(a);
    return { from: 'x', to: 'y', lineFailedPct: null, thresholds: { watch: 1.5, act: 2, minCones: 50, assumed: true }, stations: [] };
  },
}));

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

const PASSWORD = 'station-status-routes-test-password-not-real';
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

beforeEach(() => { db.statements = []; });

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


beforeEach(() => { svc.calls.length = 0; });
let n = 0;
/** Distinct dates per test so the route cache never serves a previous test. */
const day = () => `2026-09-${String(1 + (n++ % 28)).padStart(2, '0')}`;

describe('GET /api/station-status', () => {
  it('signed out -> 401; every rank reaches the service', async () => {
    const d = day();
    expect((await call(null, 'GET', `/api/station-status?from=${d}&to=${d}`)).status).toBe(401);
    for (const u of USERS) {
      const r = await call(u.username, 'GET', `/api/station-status?from=${d}&to=${d}&shift=morning`);
      expect(r.status, u.username).toBe(200);
      expect(r.json.data.thresholds.minCones).toBe(50);
    }
  });
  it('400 on missing/impossible/reversed/too-long ranges and bad shift range, service never called', async () => {
    for (const p of [
      '', '?from=2026-02-30&to=2026-02-30', '?from=2026-09-05&to=2026-09-01',
      '?from=2024-01-01&to=2026-01-01', '?from=2026-09-01&to=2026-09-01&shift=lunch',
    ]) {
      expect((await call('viewer', 'GET', `/api/station-status${p}`)).status, p).toBe(400);
    }
    expect(svc.calls.length).toBe(0);
  });
  it('passes period and shift to the service and does not forward tsTo', async () => {
    const d = day();
    const r = await call('viewer', 'GET', `/api/station-status?from=${d}&to=${d}&shift=night&tsTo=2026-09-07T12:00:00Z`);
    expect(r.status).toBe(200);
    const opts = svc.calls[0]![2] as Record<string, unknown>;
    expect(opts.from).toBe(d);
    expect(opts.shift).toBe('night');
    expect('tsTo' in opts).toBe(false);
  });
  it('second identical request is a cache HIT', async () => {
    const d = day();
    await call('viewer', 'GET', `/api/station-status?from=${d}&to=${d}`);
    const res = await fetch(`${base}/api/station-status?from=${d}&to=${d}`, { headers: { Cookie: cookies.viewer! } });
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(svc.calls.length).toBe(1);
  });
});
