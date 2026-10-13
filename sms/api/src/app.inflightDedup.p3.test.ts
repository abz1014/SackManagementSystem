/**
 * Phase 3 (12 Oct 2026): identical concurrent cold requests used to each run
 * the full computation (M-LOAD: 4 at once cost 4.0x the SQL of one). Proves,
 * on the real createApp with a counting fake pool, that two requests fired at
 * the same instant issue the data queries ONCE, for a cached analytics route
 * (/api/production) and for a report (/api/reports/daily); a joiner reports
 * X-Cache MISS; the response bodies are identical.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

interface Stmt { sql: string }

class FakeRequest {
  private inputs = new Map<string, unknown>();
  constructor(private readonly db: FakeDb) {}
  input(name: string, _type: unknown, value: unknown): this {
    this.inputs.set(name, value);
    return this;
  }
  async query<T = Record<string, unknown>>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    return this.db.handle<T>(sql);
  }
}

class FakeDb {
  statements: Stmt[] = [];
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    // Not exercised by /api/spc (a read-only route) — never called in this file.
    throw new Error('transaction() not expected in app.spcCache.test.ts');
  }

  async handle<T>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql });
    // A real round trip takes time; without it a request finishes before its twin arrives.
    if (!sql.includes('sms.session') && !sql.includes('sms.app_user')) await new Promise((r) => setTimeout(r, 15));
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      return row({ user_id: 1, password_hash: this.hash, display_name: 'viewer', role: 'viewer', rank: 1, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) return none();
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      return row({ user_id: 1, username: 'viewer', display_name: 'viewer', role: 'viewer', rank: 1 });
    }

    // spc.ts's getWeightSpc summary aggregate — always exactly one row (no
    // FROM/WHERE it can filter to zero rows out of, it's a plain SELECT of
    // subqueries), same as the real server. Empty here would throw on
    // `sumRes.recordset[0]!` in spc.ts, same as it would against a real DB
    // returning zero rows for a query that structurally cannot do that —
    // this fake matches the real shape, not merely avoids a crash.
    if (sql.includes('MIN(production_ts_utc) minTs')) {
      return row({ n: 0, mean: null, sd: null, excluded: 0, minTs: null, maxTs: null, occDays: 0 });
    }

    // Everything else /api/spc issues (median, subgroup, station, histogram
    // queries) is a list this codebase handles safely when empty.
    return none();
  }

  hash = '';
}

let server: Server;
let base: string;
let cookie: string;
let db: FakeDb;

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  db = new FakeDb();
  db.hash = await argon2.hash('inflight-test-password');

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
    body: JSON.stringify({ username: 'viewer', password: 'inflight-test-password' }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('fixture login set no cookie');
  cookie = setCookie.split(';')[0]!;
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getPath(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, xCache: res.headers.get('x-cache'), body: await res.json() };
}

/** Statements that are not the auth middleware's per-request session check. */
function dataQueryCount(): number {
  return db.statements.filter((s) => !s.sql.includes('sms.session') && !s.sql.includes('sms.app_user') && !s.sql.includes('SELECT 1 AS ok')).length;
}

async function dedupFor(path: string) {
  // Warm-up on its own key so one-time config reads are not counted below.
  await getPath(path.replaceAll('PERIOD', '2026-08-09'));

  // One request alone (cold key), then the same again (cache HIT): the HIT's
  // queries are the per-request overhead that is never shared (auth, header, envelope).
  const t0 = dataQueryCount();
  const alone = await getPath(path.replaceAll('PERIOD', '2026-08-10'));
  const single = dataQueryCount() - t0;
  expect(alone.status, JSON.stringify(alone.body)).toBe(200);
  const t1 = dataQueryCount();
  await getPath(path.replaceAll('PERIOD', '2026-08-10'));
  const perRequest = dataQueryCount() - t1;

  const t2 = dataQueryCount();
  const [a, b] = await Promise.all([getPath(path.replaceAll('PERIOD', '2026-08-11')), getPath(path.replaceAll('PERIOD', '2026-08-11'))]);
  const both = dataQueryCount() - t2;
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  return { single, perRequest, both, a, b };
}

describe('identical concurrent cold requests share one computation', () => {
  it('/api/production: two at once issue the data queries once', async () => {
    const r = await dedupFor('/api/production?from=PERIOD&to=PERIOD&groupBy=none');
    // data queries once + the per-request overhead of the second request (none for a cached envelope)
    expect(r.both).toBe(r.single + r.perRequest);
    expect(r.b.body).toEqual(r.a.body);
  });

  it('/api/reports/daily: two at once issue the data queries once', async () => {
    const r = await dedupFor('/api/reports/daily?from=PERIOD&to=PERIOD');
    expect(r.both).toBe(r.single + r.perRequest);
    // The header (who/when) is per request by design; the cached report body is the shared part.
    const rep = (x: unknown) => (x as { data: { report: unknown } }).data.report;
    expect(rep(r.b.body)).toEqual(rep(r.a.body));
  });

  it('a joiner reports MISS (it did not read the cache), and a later call HITs', async () => {
    const p = '/api/production?from=2026-08-12&to=2026-08-12&groupBy=none';
    const [a, b] = await Promise.all([getPath(p), getPath(p)]);
    expect(a.xCache).toBe('MISS');
    expect(b.xCache).toBe('MISS');
    expect((await getPath(p)).xCache).toBe('HIT');
  });
});
