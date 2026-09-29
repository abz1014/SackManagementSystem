/**
 * /api/events (the register's paged list) had NO cache at all (perf defect
 * found 29 Sep 2026): 1.5-1.8s on EVERY call at pageSize 500 over 30 days,
 * unlike every sibling analytics route (/api/spc, /api/weight-stations,
 * /api/production), which all key `prodCache` on every parameter that can
 * change the answer — see app.spcCache.test.ts's file header, same idiom.
 *
 * `/api/events/export` deliberately shares none of this: it is proven
 * uncached here (a bulk CSV pull must never be served a stale/truncated
 * cached page, and its own audit-log side effect must fire every time).
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
    return this.db.handle<T>(sql, this.inputs);
  }
}

class FakeDb {
  statements: Stmt[] = [];
  hash = '';

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    throw new Error('transaction() not expected in app.eventsCache.test.ts');
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      return row({ user_id: 1, password_hash: this.hash, display_name: 'manager', role: 'manager', rank: 3, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) return none();
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      return row({ user_id: 1, username: 'manager', display_name: 'manager', role: 'manager', rank: 3 });
    }
    if (sql.includes('FROM sms.plausibility_rule')) return row({ min_g: 1500, max_g: 3000 });

    // The register's own row SELECT (listEvents' OFFSET/FETCH page, or
    // exportEventsCsv's capped TOP) — one real row so envelope()/the export
    // path have something to serialize; distinct from every other query this
    // fixture answers via `none()`.
    if (sql.includes('FROM sms.cone_event e') && (sql.includes('OFFSET @offset ROWS') || sql.includes('SELECT TOP (@cap)'))) {
      void inputs;
      return {
        recordset: [{
          line_id: 1, event_id: 1, cone_event_id: 1, source_row_id: 1, source_epoch: null,
          weight_g: 1900, in_range: true, production_ts_utc_ms: Date.UTC(2026, 7, 15, 6, 0, 0), shift_date: '2026-08-15',
          station_id: null, material_id: null,
          prov_source_system: 'ifl_sql', prov_source_table: 'pack1_TP1U2', prov_epoch_label: null,
          prov_source_row_id: 1, prov_raw_id: 1, prov_source_insert_utc: null,
          prov_ingested_at_utc: null, prov_ingest_run_id: null, prov_transform_version: 1,
          prov_attribution_method: null, prov_attribution_confidence: null, prov_night_belongs_to: null,
          prov_epoch_id: null,
        }] as T[],
        rowsAffected: [1],
      };
    }

    // Everything else (resolveGenerationScope's tally/epoch-catalogue
    // queries, the register's own unconstrained generations tally, etc.) is
    // a list this codebase handles safely when empty — same fallback idiom
    // as app.spcCache.test.ts's own FakeDb.
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
  db.hash = await argon2.hash('events-cache-test-password');

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
    body: JSON.stringify({ username: 'manager', password: 'events-cache-test-password' }),
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
  const res = await fetch(`${base}/api/events?${qs}`, { headers: { Cookie: cookie } });
  return { status: res.status, xCache: res.headers.get('x-cache'), body: await res.json() };
}

/** The register's own page SELECT (listEvents) — issued on every cache MISS, never on a HIT. */
function rowQueryCount(): number {
  return db.statements.filter((s) => s.sql.includes('OFFSET @offset ROWS')).length;
}

/** The export path's own capped SELECT (exportEventsCsv) — a distinct query shape, never cached. */
function exportQueryCount(): number {
  return db.statements.filter((s) => s.sql.includes('SELECT TOP (@cap)')).length;
}

describe('GET /api/events — cached (previously uncached on every call)', () => {
  it('MISSes cold, HITs warm, and a warm hit issues no new query against the pool', async () => {
    const first = await get('type=cone&from=2026-08-01&to=2026-08-30&pageSize=500');
    expect(first.status).toBe(200);
    expect(first.xCache).toBe('MISS');

    const afterFirst = rowQueryCount();
    expect(afterFirst).toBeGreaterThan(0);

    const second = await get('type=cone&from=2026-08-01&to=2026-08-30&pageSize=500');
    expect(second.status).toBe(200);
    expect(second.xCache).toBe('HIT');
    expect(second.body).toEqual(first.body);

    expect(rowQueryCount()).toBe(afterFirst);
  });

  it("does not serve one page, batch, or fromShift's cached answer to a different one", async () => {
    const base1 = 'type=cone&from=2026-08-02&to=2026-08-02&pageSize=50';

    const r0 = await get(base1);
    expect(r0.xCache).toBe('MISS');

    // Different `fromShift`/`toShift` (wire form: `YYYY-MM-DD.shift`, see
    // shiftRangeParam.ts's file header — both must be given together).
    const shiftQs = 'fromShift=2026-08-02.evening&toShift=2026-08-02.night';
    const rShift = await get(`${base1}&${shiftQs}`);
    expect(rShift.xCache).toBe('MISS');

    // Second call with the SAME shift range must now HIT its own entry, not
    // the shift-less one above.
    const rShift2 = await get(`${base1}&${shiftQs}`);
    expect(rShift2.xCache).toBe('HIT');

    // Different `page`.
    const rPage = await get(`${base1}&page=2`);
    expect(rPage.xCache).toBe('MISS');

    // Different `batch`.
    const rBatch = await get(`${base1}&batch=auto`);
    expect(rBatch.xCache).toBe('MISS');
  });

  it('the export route is never cached — every call re-queries and re-audits', async () => {
    const before = exportQueryCount();
    const url = `${base}/api/events/export?type=cone&from=2026-08-02&to=2026-08-02`;
    const first = await fetch(url, { headers: { Cookie: cookie } });
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBeNull();
    const afterFirst = exportQueryCount();
    expect(afterFirst).toBeGreaterThan(before);

    const second = await fetch(url, { headers: { Cookie: cookie } });
    expect(second.status).toBe(200);
    expect(second.headers.get('x-cache')).toBeNull();
    expect(exportQueryCount()).toBeGreaterThan(afterFirst);
  });
});
