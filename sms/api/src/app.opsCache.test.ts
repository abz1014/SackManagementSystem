/**
 * /api/operations and /api/system-history are both flat (no query params)
 * reads that were previously uncached: /api/operations measured ~187-225ms
 * on every Health load, /api/system-history ~90-122ms — see app.ts's
 * comments right above each route for the reasoning (both mirror /api/live's
 * existing 5s-TTL precedent; system-history is additionally the record of a
 * MANUAL run, never a live signal). This proves both now cache on the same
 * idiom as every other prodCache route: MISS then HIT, and — the one thing
 * that would make caching a defect here rather than a speed win — a FAILED
 * fetch is never written to the cache, so an outage is always seen on the
 * very next request rather than being masked for the TTL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
    return this.db.handle<T>(sql);
  }
}

class FakeDb {
  statements: string[] = [];
  hash = '';
  /** Set true to make every /api/operations-shaped query throw, simulating a real outage. */
  failOperations = false;

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    throw new Error('transaction() not expected in app.opsCache.test.ts');
  }

  async handle<T>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push(sql);
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      return row({ user_id: 1, password_hash: this.hash, display_name: 'admin', role: 'admin', rank: 4, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) return none();
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      return row({ user_id: 1, username: 'admin', display_name: 'admin', role: 'admin', rank: 4 });
    }

    if (this.failOperations) throw new Error('simulated outage — DB unreachable');

    // Every other query this codebase's list/optional-row call sites already
    // handle safely when empty (verified: operations.ts and systemHistory.ts
    // use `recordset[0]` / `recordset[0]?.x`, never a non-null assertion).
    return none();
  }
}

let server: Server;
let base: string;
let cookie: string;
let db: FakeDb;

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  db = new FakeDb();
  db.hash = await argon2.hash('ops-cache-test-password');

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
    body: JSON.stringify({ username: 'admin', password: 'ops-cache-test-password' }),
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

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, xCache: res.headers.get('x-cache') };
}

describe('GET /api/operations — cached, but never a masked outage', () => {
  it('MISSes cold, HITs warm', async () => {
    const first = await get('/api/operations');
    expect(first.status).toBe(200);
    expect(first.xCache).toBe('MISS');
    const second = await get('/api/operations');
    expect(second.status).toBe(200);
    expect(second.xCache).toBe('HIT');
  });

  it('a failed fetch is never cached as a healthy snapshot — the very next request still fails', async () => {
    const fresh = new FakeDb();
    fresh.hash = await argon2.hash('ops-cache-outage-password');
    const cfg: ApiConfig = {
      port: 0, lineId: 1, lineName: 'Test line', liveAllowAsOf: true, cacheTtlSeconds: 5, trustProxy: false,
      appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
      pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
    };
    const app = createApp(fresh as unknown as import('mssql').ConnectionPool, cfg);
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', resolve));
    const addr = s.address();
    if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
    const b = `http://127.0.0.1:${addr.port}`;
    const loginRes = await fetch(`${b}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'ops-cache-outage-password' }),
    });
    const c = loginRes.headers.get('set-cookie')!.split(';')[0]!;

    fresh.failOperations = true;
    const outage1 = await fetch(`${b}/api/operations`, { headers: { Cookie: c } });
    expect(outage1.status).toBe(500);
    expect(outage1.headers.get('x-cache')).toBeNull();

    // Still failing right after — an outage is never hidden behind a cached
    // all-clear from before it started (there was none to cache: the
    // failing response above never reached prodCache.set).
    const outage2 = await fetch(`${b}/api/operations`, { headers: { Cookie: c } });
    expect(outage2.status).toBe(500);
    expect(outage2.headers.get('x-cache')).toBeNull();

    // Recovery: once the DB answers again, the next request MISSes fresh
    // (not a stale cached failure either) and warms normally.
    fresh.failOperations = false;
    const recovered = await fetch(`${b}/api/operations`, { headers: { Cookie: c } });
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('x-cache')).toBe('MISS');

    await new Promise<void>((resolve) => s.close(() => resolve()));
  });
});

describe('GET /api/system-history — cached', () => {
  it('MISSes cold, HITs warm, and does not share operations\' cache key', async () => {
    const first = await get('/api/system-history');
    expect(first.status).toBe(200);
    expect(first.xCache).toBe('MISS');
    const second = await get('/api/system-history');
    expect(second.status).toBe(200);
    expect(second.xCache).toBe('HIT');
  });
});
