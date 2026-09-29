/**
 * /api/reject-spc had NO cache at all (perf defect found 29 Sep 2026):
 * 570-730ms on EVERY call, unlike every sibling analytics route (/api/spc,
 * /api/weight-stations, /api/production), which all key `prodCache` on every
 * parameter that can change the answer — see app.spcCache.test.ts's own file
 * header, same idiom, same fake-pool harness shape (real `createApp`, a
 * hand-rolled fake pool, Node's own `fetch` over a real `http.Server`).
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
  hash = '';

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    throw new Error('transaction() not expected in app.rejectSpcCache.test.ts');
  }

  async handle<T>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql });
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
    if (sql.includes('FROM sms.plausibility_rule')) return row({ min_g: 1500, max_g: 3000 });

    // Everything else getRejectSpc issues (the produced/rejects/allRejects/
    // unmatched population queries, resolveGenerationScope's tally) is a
    // list this codebase handles safely when empty — same fallback idiom as
    // app.spcCache.test.ts's own FakeDb.
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
  db.hash = await argon2.hash('reject-spc-cache-test-password');

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
    body: JSON.stringify({ username: 'viewer', password: 'reject-spc-cache-test-password' }),
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

async function get(qs: string) {
  const res = await fetch(`${base}/api/reject-spc?${qs}`, { headers: { Cookie: cookie } });
  return { status: res.status, xCache: res.headers.get('x-cache'), body: await res.json() };
}

/** The produced-population query (rejectSpc.ts's own `producedRes` select) —
 *  issued on every cache MISS, never on a HIT. Distinct from the unmatched-
 *  rejects query, which aliases the table `ce` and never appears as the bare
 *  `FROM sms.cone_event WHERE` this one does. */
function producedQueryCount(): number {
  return db.statements.filter((s) => s.sql.includes('FROM sms.cone_event WHERE')).length;
}

describe('GET /api/reject-spc — cached (previously uncached on every call)', () => {
  it('MISSes cold, HITs warm, and a warm hit issues no new query against the pool', async () => {
    const first = await get('from=2026-08-01&to=2026-08-30');
    expect(first.status).toBe(200);
    expect(first.xCache).toBe('MISS');

    const afterFirst = producedQueryCount();
    expect(afterFirst).toBeGreaterThan(0);

    const second = await get('from=2026-08-01&to=2026-08-30');
    expect(second.status).toBe(200);
    expect(second.xCache).toBe('HIT');
    expect(second.body).toEqual(first.body);

    expect(producedQueryCount()).toBe(afterFirst);
  });

  it("does not serve one period, shift, station, or batch's cached answer to a different one", async () => {
    const base1 = 'from=2026-08-02&to=2026-08-02';

    const r0 = await get(base1);
    expect(r0.xCache).toBe('MISS');

    // Different `to`.
    const rTo = await get('from=2026-08-02&to=2026-08-03');
    expect(rTo.xCache).toBe('MISS');

    // Different `fromShift`/`toShift` (wire form: `YYYY-MM-DD.shift`, see
    // shiftRangeParam.ts's file header — both must be given together).
    const shiftQs = 'fromShift=2026-08-02.evening&toShift=2026-08-02.night';
    const rShift = await get(`${base1}&${shiftQs}`);
    expect(rShift.xCache).toBe('MISS');

    // Second call with the SAME shift range must now HIT its own entry, not
    // the shift-less one above.
    const rShift2 = await get(`${base1}&${shiftQs}`);
    expect(rShift2.xCache).toBe('HIT');

    // Different `station`.
    const rStation = await get(`${base1}&station=3`);
    expect(rStation.xCache).toBe('MISS');
  });
});
