/**
 * RT24-10 / RT24-11 / RT24-12 / RT-014 — 24 Sep 2026 red-team audit
 * (ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md) and its RT-014 response
 * (DEFECTS.md). Real createApp, a hand-rolled fake pool (same idiom as
 * app.invalidDates.test.ts), Node's fetch.
 *
 *  - RT24-10: the legacy `/api/report` period-summary route is deleted, not
 *    aligned — no UI ever called it (getReport is unreferenced from any
 *    screen) and it silently ignored from/to unless period=custom. 404 now.
 *  - RT24-11: `X-Powered-By` is gone from every response.
 *  - RT24-12: pins the full round trip through /api/health (see
 *    services/health.test.ts for the pure-function-level cases).
 *  - RT-014: the row/byte cap (middleware/responseCap.ts) is wired into the
 *    real app, not just unit-tested in isolation — a pool that hands back an
 *    oversized recordset (the exact "no cap independent of SQL" shape the
 *    finding names) is refused with 413, not served; and /api/spc's own
 *    186-day span cap (MAX_SPC_RANGE_DAYS) answers 400 with a plain message.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';
import { MAX_RESPONSE_ROWS, MAX_SPC_RANGE_DAYS } from './config.js';

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
  /** When set, the cone-event row SELECT (register.ts's listEvents) answers
   *  this many bare rows regardless of the requested pageSize — simulating
   *  exactly the "no cap independent of SQL" shape RT-014 describes: a query
   *  that, for whatever reason, comes back far larger than the caller asked. */
  huge = 0;

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
    // register.ts's row SELECT: has OFFSET/FETCH and no GROUP BY, unlike the
    // tally query (which groups by source_epoch). Answer `huge` bare rows
    // when armed; otherwise fall through to the generic empty-recordset case.
    if (this.huge > 0 && sql.includes('FROM sms.cone_event') && sql.includes('OFFSET @offset ROWS')) {
      return { recordset: new Array(this.huge).fill({}) as T[], rowsAffected: [this.huge] };
    }
    // Every other query (production/weights/rejects/spc aggregates, the
    // register's own tally, etc.) — an empty recordset is exactly what a
    // passing 2xx test needs.
    return none();
  }
}

const PASSWORD = 'rt24-test-password-not-real';
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
  const json = (await res.json().catch(() => null)) as Record<string, unknown> & { error?: string };
  return { status: res.status, headers: res.headers, json };
}

describe('RT24-10 — /api/report deleted', () => {
  it('answers 404 (no longer aligned, deleted outright — no UI ever called it)', async () => {
    const r = await get('/api/report?period=day&anchor=2026-09-07');
    expect(r.status).toBe(404);
  });
});

describe('RT24-11 — X-Powered-By removed', () => {
  it('is absent on an ordinary response', async () => {
    const r = await get('/api/health');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });
  it('is absent even on a 404', async () => {
    const r = await get('/api/definitely-not-a-route');
    expect(r.status).toBe(404);
    expect(r.headers.get('x-powered-by')).toBeNull();
  });
});

describe('RT24-12 — /api/health degradedReason (integration; pure-fold cases in health.test.ts)', () => {
  // This fixture's fake pool answers empty recordsets for the acquisition/DQ
  // probes and there is no real backup directory on this machine, so
  // status may legitimately read 'degraded' here (e.g. "no backup found")
  // rather than 'ok' — the invariant this pins is RT24-12's own: whenever
  // status is 'degraded', degradedReason must be a non-null, non-empty
  // sentence, never the null the finding caught it as before the fix.
  it('degradedReason is populated whenever status is degraded; null only when ok', async () => {
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    if (r.json.status === 'degraded') {
      expect(typeof r.json.degradedReason).toBe('string');
      expect((r.json.degradedReason as string).length).toBeGreaterThan(0);
    } else {
      expect(r.json.degradedReason).toBeNull();
    }
  });
});

describe('RT-014 — response cap wired into the real app', () => {
  it('an ordinary /api/events page is unaffected', async () => {
    db.huge = 0;
    const r = await get('/api/events?type=cone&page=1&pageSize=50');
    expect(r.status).toBe(200);
  });

  it('a recordset larger than MAX_RESPONSE_ROWS is refused with 413, not served', async () => {
    db.huge = MAX_RESPONSE_ROWS + 1;
    const r = await get('/api/events?type=cone&page=1&pageSize=50');
    expect(r.status).toBe(413);
    expect(r.json).toMatchObject({ error: 'result too large', limit: MAX_RESPONSE_ROWS });
    db.huge = 0;
  });

  it('exactly MAX_RESPONSE_ROWS is not refused', async () => {
    db.huge = MAX_RESPONSE_ROWS;
    const r = await get('/api/events?type=cone&page=1&pageSize=50');
    expect(r.status).toBe(200);
    db.huge = 0;
  });
});

describe('RT-014(c) — /api/spc span cap at MAX_SPC_RANGE_DAYS', () => {
  it(`refuses a span of MAX_SPC_RANGE_DAYS + 1 days with a plain 400 message`, async () => {
    const to = '2026-09-07';
    const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - MAX_SPC_RANGE_DAYS * 86_400_000)
      .toISOString().slice(0, 10);
    const r = await get(`/api/spc?type=cone&from=${from}&to=${to}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(new RegExp(`max ${MAX_SPC_RANGE_DAYS} days`));
  });

  it(`accepts exactly MAX_SPC_RANGE_DAYS days`, async () => {
    const to = '2026-09-07';
    const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - (MAX_SPC_RANGE_DAYS - 1) * 86_400_000)
      .toISOString().slice(0, 10);
    const r = await get(`/api/spc?type=cone&from=${from}&to=${to}`);
    expect(r.status).not.toBe(400);
  });
});
