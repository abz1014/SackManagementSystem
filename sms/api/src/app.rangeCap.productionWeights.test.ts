/**
 * RT-028 (Task W2-C, 29 Sep 2026): `/api/production` (~app.ts:989) and
 * `/api/weights` (~app.ts:1418) had no MAX_RANGE_DAYS check at all, unlike
 * their sibling analytics routes (`/api/calibration`, `/api/spc`,
 * `/api/reject-spc`, `/api/weight-stations`, the register, ...), which all
 * call the shared `validateRange` (app.ts, gated to `config.ts`'s
 * `MAX_RANGE_DAYS`, pinned at 366 by `app.rangeCap.test.ts`). An unbounded
 * `from`/`to` here let a caller ask `getProduction`/`getWeights` to scan and
 * group an arbitrarily large date range with no server-side cap.
 *
 * Same harness as `app.invalidDates.test.ts`: the real `createApp`, a
 * hand-rolled fake pool, Node's fetch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';
import { MAX_RANGE_DAYS } from './config.js';

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

const ADMIN = { userId: 4, username: 'admin', role: 'admin', rank: 4 };

class FakeDb {
  statements: { sql: string }[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    const db = this;
    return {
      async begin() { return this; },
      async commit() {},
      async rollback() {},
      request() { return new FakeRequest(db); },
    };
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = ADMIN;
      if (inputs.get('u') !== u.username) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const uid = this.sessions.get(inputs.get('id') as string);
      if (uid !== ADMIN.userId) return none();
      return row({ user_id: ADMIN.userId, username: ADMIN.username, display_name: ADMIN.username, role: ADMIN.role, rank: ADMIN.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();
    if (sql.includes('MAX(shift_date)') || sql.includes('MAX(production_ts_utc_ms)')) {
      return row({ shift_date: '2026-09-07', ms: Date.UTC(2026, 8, 7, 12, 0, 0) });
    }
    if (sql.includes('FROM sms.plausibility_rule')) {
      return row({ min_g: 1500, max_g: 3000 });
    }
    // getWeights' own stat aggregates (weights.ts, cones and sacks both)
    // read recordset[0] unconditionally (no COUNT(*)=0 guard) — an empty
    // recordset makes them throw, unlike every other query here, so both
    // need a real row.
    if (sql.includes('STDEV(weight_g') || sql.includes('STDEV(weight_kg')) {
      return row({ n: 0, avg: null, mn: null, mx: null, sd: null, excluded: 0 });
    }
    // Every other query (production/weights aggregates etc.) — an empty
    // recordset is exactly what a passing 2xx test needs.
    return none();
  }
}

const PASSWORD = 'range-cap-prod-weights-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let cookie: string;

beforeAll(async () => {
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
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.username, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** `to` fixed; `from` set `days - 1` days before it, inclusive range of `days` days. */
function rangeOf(days: number): { from: string; to: string } {
  const to = '2027-01-01';
  const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

describe.each([
  ['/api/production', (from: string, to: string) => `/api/production?from=${from}&to=${to}`],
  ['/api/weights', (from: string, to: string) => `/api/weights?from=${from}&to=${to}`],
])('%s — RT-028 MAX_RANGE_DAYS cap', (_name, buildUrl) => {
  it(`refuses a range of ${MAX_RANGE_DAYS + 1} days with 400`, async () => {
    const { from, to } = rangeOf(MAX_RANGE_DAYS + 1);
    const r = await get(buildUrl(from, to));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain(`max ${MAX_RANGE_DAYS} days`);
  });

  it(`accepts a range of exactly ${MAX_RANGE_DAYS} days (200)`, async () => {
    const { from, to } = rangeOf(MAX_RANGE_DAYS);
    const r = await get(buildUrl(from, to));
    expect(r.status).toBe(200);
  });
});
