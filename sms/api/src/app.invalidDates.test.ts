/**
 * Regression test for the defect this pass fixes: every date-taking route
 * validated `from`/`to`/`date` with a plain `/^\d{4}-\d{2}-\d{2}$/` regex,
 * which checks shape only. `2026-02-30` (February has no 30th) matches that
 * shape, so it reached the query layer as a literal string, every
 * `WHERE ProductionDate >= @from AND ProductionDate <= @to` comparison
 * matched nothing, and the route answered 200 with an empty-looking result —
 * indistinguishable on screen from "no production that day". A caller who
 * mistypes a date gets silence, not an error.
 *
 * Same harness as app.routes.test.ts: the real createApp, a hand-rolled fake
 * pool (only what these routes touch), Node's fetch.
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
    // Every other query (production/weights/rejects/spc aggregates etc.) —
    // an empty recordset is exactly what a passing 2xx test needs.
    return none();
  }
}

const PASSWORD = 'invalid-dates-test-password-not-real';
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

const INVALID = ['2026-02-30', '2026-13-01', '2025-02-29'];
const VALID_LEAP = '2024-02-29';

describe('date query params reject impossible calendar dates', () => {
  describe.each([
    ['/api/production', (d: string) => `/api/production?from=${d}&to=${d}`],
    ['/api/rejects', (d: string) => `/api/rejects?from=${d}&to=${d}`],
    ['/api/weights', (d: string) => `/api/weights?from=${d}&to=${d}`],
    ['/api/spc', (d: string) => `/api/spc?from=${d}&to=${d}`],
    ['/api/reject-spc', (d: string) => `/api/reject-spc?from=${d}&to=${d}`],
    ['/api/weight-stations', (d: string) => `/api/weight-stations?from=${d}&to=${d}`],
    ['/api/events', (d: string) => `/api/events?type=cone&from=${d}&to=${d}`],
    ['/api/downtime', (d: string) => `/api/downtime?date=${d}`],
  ])('%s', (_name, buildUrl) => {
    it.each(INVALID)('%s is refused with 400', async (d) => {
      const r = await get(buildUrl(d));
      expect(r.status).toBe(400);
    });

    it('a real leap day is accepted (not 400)', async () => {
      const r = await get(buildUrl(VALID_LEAP));
      expect(r.status).not.toBe(400);
    });
  });
});

/**
 * RT-016, ISO-timestamp half. Every `tsTo`/`tsFrom`/`asOf`/`at` param was
 * checked for shape only (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/`),
 * the same flaw `isoDate` had already been fixed for plain dates. A
 * calendar-invalid-but-shape-valid timestamp (`2026-02-30T..`, `..T24:00:00Z`,
 * `..T10:60:00Z`) either silently rolled over or became an `Invalid Date`
 * that reached mssql and crashed the driver with a raw stack trace instead
 * of a 400. `isoTimestamp` (dates.ts) closes this the same way `isoDate`
 * closes the plain-date case; this block proves it on every route that
 * takes one of these params, and proves the fake pool is never queried —
 * i.e. validation happens before any DB access, so the real driver never
 * sees the bad value either.
 */
const BAD_TIMESTAMPS = [
  '2026-02-30T10:00:00Z', // no such day
  '2026-13-01T10:00:00Z', // no such month
  '2026-04-31T10:00:00Z', // April has 30 days
  '2026-09-24T24:00:00Z', // hour 24
  '2026-09-24T10:60:00Z', // minute 60
  '2026-09-24T10:30:60Z', // second 60
];
const VALID_TS = '2026-09-07T12:00:00Z';
const VALID_DAY = '2026-09-01';

describe('ISO-timestamp query params reject impossible calendar instants (RT-016)', () => {
  describe.each([
    ['/api/production tsTo', (d: string) => `/api/production?tsTo=${d}`],
    ['/api/live asOf', (d: string) => `/api/live?asOf=${d}`],
    ['/api/attention tsTo', (d: string) => `/api/attention?tsTo=${d}`],
    ['/api/product-at at', (d: string) => `/api/product-at?at=${d}`],
    ['/api/reject-spc tsTo', (d: string) => `/api/reject-spc?from=${VALID_DAY}&to=${VALID_DAY}&tsTo=${d}`],
    ['/api/rejects tsTo (Pareto)', (d: string) => `/api/rejects?tsTo=${d}`],
    ['/api/events tsTo', (d: string) => `/api/events?type=cone&tsTo=${d}`],
    ['/api/sacks/summary tsTo', (d: string) => `/api/sacks/summary?from=${VALID_DAY}&to=${VALID_DAY}&tsTo=${d}`],
    ['/api/sacks/stock tsTo', (d: string) => `/api/sacks/stock?from=${VALID_DAY}&to=${VALID_DAY}&tsTo=${d}`],
    ['/api/reports/header at', (d: string) => `/api/reports/header?at=${d}`],
    ['/api/reports/daily at', (d: string) => `/api/reports/daily?period=day&at=${d}`],
    ['/api/machines/running at', (d: string) => `/api/machines/running?at=${d}`],
    ['/api/rejects/by-day-code tsTo', (d: string) => `/api/rejects/by-day-code?from=${VALID_DAY}&to=${VALID_DAY}&tsTo=${d}`],
  ])('%s', (_name, buildUrl) => {
    it.each(BAD_TIMESTAMPS)('%s is refused with 400, no query beyond session auth', async (d) => {
      const before = db.statements.length;
      const r = await get(buildUrl(d));
      expect(r.status).toBe(400);
      // Every request pays exactly one query for the session-cookie lookup
      // (auth.ts's authMiddleware, which runs before any route handler).
      // Zod rejecting the bad timestamp must stop the request there — no
      // production/weights/rejects/etc. query is ever issued for a value
      // that will never reach the DB.
      const issued = db.statements.slice(before);
      expect(issued.length).toBe(1);
      expect(issued[0]!.sql).toMatch(/FROM sms\.session s/);
    });

    it('a real timestamp is accepted (not 400)', async () => {
      const r = await get(buildUrl(VALID_TS));
      expect(r.status).not.toBe(400);
    });
  });
});
