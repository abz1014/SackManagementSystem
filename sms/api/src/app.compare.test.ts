/**
 * /api/production?compare=prev|week adds data.previous; without compare the
 * payload is unchanged. Same harness as app.rangeCap.productionWeights.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

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

const PASSWORD = 'compare-test-password-not-real';
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
  const json = (await res.json().catch(() => null)) as any;
  return { status: res.status, json };
}


const BASE = '/api/production?from=2026-09-02&to=2026-09-04';

describe('/api/production compare', () => {
  it('without compare there is no previous (response unchanged)', async () => {
    const r = await get(BASE);
    expect(r.status).toBe(200);
    expect(r.json.data).toBeDefined();
    expect('previous' in r.json.data).toBe(false);
  });

  it('compare=prev returns the equal-length block before', async () => {
    const r = await get(`${BASE}&compare=prev`);
    expect(r.status).toBe(200);
    const p = r.json.data.previous;
    expect(p.from).toBe('2026-08-30');
    expect(p.to).toBe('2026-09-01');
    expect(p.fromShift).toBeNull();
    expect(p.result).toBeDefined();
    expect(r.json.data.previous.result).not.toHaveProperty('previous');
  });

  it('compare=week subtracts seven days', async () => {
    const r = await get(`${BASE}&compare=week`);
    expect(r.status).toBe(200);
    expect(r.json.data.previous.from).toBe('2026-08-26');
    expect(r.json.data.previous.to).toBe('2026-08-28');
  });

  it('compare with a shift range reports the previous shifts', async () => {
    const r = await get(
      '/api/production?from=2026-09-10&to=2026-09-11&fromShift=2026-09-10.evening&toShift=2026-09-11.morning&compare=prev',
    );
    expect(r.status).toBe(200);
    const p = r.json.data.previous;
    expect(p.fromShift).toBe('2026-09-09.evening');
    expect(p.toShift).toBe('2026-09-10.morning');
  });

  it('an invalid compare is a 400', async () => {
    const r = await get(`${BASE}&compare=month`);
    expect(r.status).toBe(400);
  });
});
