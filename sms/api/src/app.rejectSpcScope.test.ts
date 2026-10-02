/**
 * C-009 (D-61): /api/reject-spc must resolve the period's generation scope and
 * pass it to getRejectSpc (as reports/reject.ts does); with no scope
 * rejectSpc.ts picks the newest real generation present, which for a July
 * period is the September generation's one stray July cone.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import { getRejectSpc } from './services/rejectSpc.js';

const SENTINEL_SCOPE = { generation: null, spansGenerations: false, otherGenerationExcluded: 0, excludedSimulator: 0, epochIds: () => [] as number[] };
vi.mock('./services/rejectSpc.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/rejectSpc.js')>()),
  getRejectSpc: vi.fn(async () => ({ buckets: [], generations: [] })),
}));
vi.mock('./services/generation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/generation.js')>()),
  resolveGenerationScope: vi.fn(async () => SENTINEL_SCOPE),
}));
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
    throw new Error('transaction() not expected in app.rejectSpcScope.test.ts');
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
  db.hash = await argon2.hash('reject-spc-scope-test-password');

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
    body: JSON.stringify({ username: 'viewer', password: 'reject-spc-scope-test-password' }),
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


describe('GET /api/reject-spc — generation scope (C-009)', () => {
  it('passes the resolved generation scope to getRejectSpc as filters.scope', async () => {
    const res = await fetch(`${base}/api/reject-spc?from=2026-07-01&to=2026-07-31&bucket=day`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const mock = vi.mocked(getRejectSpc);
    expect(mock).toHaveBeenCalledTimes(1);
    const filters = mock.mock.calls[0]![6] as { scope?: unknown };
    expect(filters.scope).toBe(SENTINEL_SCOPE);
  });
});
