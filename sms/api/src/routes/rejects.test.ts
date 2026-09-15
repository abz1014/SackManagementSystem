/**
 * The Phase 5 reject routes against the REAL createApp (roadmap Phase 5, 14
 * Sep 2026): what each accepts, what it refuses, and what reaches the
 * database. Same shape as app.routes.test.ts — a recording fake pool, argon2
 * fixture accounts, Node's fetch — kept in its own file because three phases
 * are adding routes at once and one shared test file would collide.
 *
 * Pinned here:
 *  - the range cap (366 days, 400 otherwise) on /api/rejects, which had none;
 *  - `shift` and `tsTo` reaching the SQL of /api/rejects and /api/reject-spc;
 *  - /api/rejects/by-day-code and /api/rejects/reason exist, are gated at
 *    rank 1 like every read, validate their query, and are REACHABLE — the
 *    first route-module stub was mounted after the /api 404 handler, so
 *    every route in routes/*.ts answered "not found".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';

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

const OPERATOR = { userId: 1, username: 'viewer', role: 'viewer', rank: 1 };

class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      if (inputs.get('u') !== OPERATOR.username) return none();
      return row({ user_id: OPERATOR.userId, password_hash: this.hash, display_name: OPERATOR.username, role: OPERATOR.role, rank: OPERATOR.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      if (this.sessions.get(inputs.get('id') as string) !== OPERATOR.userId) return none();
      return row({ user_id: OPERATOR.userId, username: OPERATOR.username, display_name: OPERATOR.username, role: OPERATOR.role, rank: OPERATOR.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();
    // the reason sheet's dictionary row
    if (sql.includes('FROM sms.reject_code') && sql.includes('@tube')) {
      return row({ reject_code_id: 11, label: 'Tube damaged', is_pass: false });
    }
    if (sql.includes('SELECT COUNT(*) n FROM sms.reject_event')) return row({ n: 0 });
    return none();
  }
}

const PASSWORD = 'routes-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let cookie = '';

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
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: OPERATOR.username, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.statements = [];
});

async function get(path: string, withCookie = true) {
  const res = await fetch(`${base}${path}`, { headers: withCookie ? { Cookie: cookie } : {} });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

const stmt = (needle: string) => db.statements.find((s) => s.sql.includes(needle));

describe('range cap — 366 days, 400 otherwise', () => {
  it('/api/rejects refuses 367 days and a backwards range', async () => {
    expect((await get('/api/rejects?from=2025-01-01&to=2026-01-02')).status).toBe(400);
    expect((await get('/api/rejects?from=2026-09-07&to=2026-09-01')).status).toBe(400);
    expect(stmt('FROM sms.reject_event')).toBeUndefined();
  });
  it('/api/rejects accepts exactly 366 days', async () => {
    expect((await get('/api/rejects?from=2025-01-01&to=2026-01-01')).status).toBe(200);
  });
  it('/api/reject-spc and /api/rejects/by-day-code refuse the same range', async () => {
    expect((await get('/api/reject-spc?from=2025-01-01&to=2026-01-02')).status).toBe(400);
    expect((await get('/api/rejects/by-day-code?from=2025-01-01&to=2026-01-02')).status).toBe(400);
  });
});

describe('shift and tsTo reach the SQL', () => {
  it('/api/rejects binds shift_code = @shift and the replay instant', async () => {
    const r = await get('/api/rejects?from=2026-09-07&to=2026-09-07&shift=night&tsTo=2026-09-07T09:30:00Z');
    expect(r.status).toBe(200);
    const s = stmt('FROM sms.reject_event')!;
    expect(s.sql).toContain('re.shift_code = @shift');
    expect(s.inputs.get('shift')).toBe('night');
    expect(s.sql).toContain('re.production_ts_utc_ms <= @tsTo');
    expect(s.inputs.get('tsTo')).toBe(Date.UTC(2026, 8, 7, 9, 30, 0));
    expect(r.json.data.unattributed).toBeNull();
  });

  it('/api/reject-spc binds shift on cones AND rejects, so numerator and denominator move together', async () => {
    const r = await get('/api/reject-spc?from=2026-09-07&to=2026-09-07&bucket=day&rejectType=quality&shift=morning&tsTo=2026-09-07T09:30:00Z&station=3');
    expect(r.status).toBe(200);
    const cones = stmt('FROM sms.cone_event')!;
    const rejects = db.statements.filter((s) => s.sql.includes('FROM sms.reject_event'));
    expect(rejects).toHaveLength(2); // numerator (quality) + denominator (all)
    for (const s of [cones, ...rejects]) {
      expect(s.sql).toContain('shift_code = @shift');
      expect(s.sql).toContain('production_ts_utc_ms <= @tsTo');
      expect(s.sql).toContain('source_station = @station');
      expect(s.inputs.get('shift')).toBe('morning');
      expect(s.inputs.get('station')).toBe(3);
    }
    expect(rejects[0]!.sql).toContain('@rejType');
    expect(rejects[1]!.sql).not.toContain('@rejType');
  });

  it('refuses an unknown shift and a malformed tsTo', async () => {
    expect((await get('/api/rejects?shift=day')).status).toBe(400);
    expect((await get('/api/rejects?tsTo=yesterday')).status).toBe(400);
    expect((await get('/api/reject-spc?from=2026-09-07&to=2026-09-07&shift=day')).status).toBe(400);
  });

  it('code: weight and tube-material are accepted, anything else is 400', async () => {
    expect((await get('/api/rejects?code=weight')).status).toBe(200);
    expect(stmt('FROM sms.reject_event')!.inputs.get('codeType')).toBe('weight');
    db.statements = [];
    expect((await get('/api/reject-spc?from=2026-09-07&to=2026-09-07&code=1-3')).status).toBe(200);
    expect(db.statements.some((s) => s.inputs.get('codeTube') === 1 && s.inputs.get('codeMaterial') === 3)).toBe(true);
    expect((await get('/api/rejects?code=1-3-5')).status).toBe(400);
    expect((await get('/api/reject-spc?from=2026-09-07&to=2026-09-07&code=tube')).status).toBe(400);
  });
});

describe('GET /api/rejects/by-day-code', () => {
  it('is reachable, gated at rank 1, and answers the shape the screen reads', async () => {
    expect((await get('/api/rejects/by-day-code?from=2026-09-01&to=2026-09-07', false)).status).toBe(401);
    const r = await get('/api/rejects/by-day-code?from=2026-09-01&to=2026-09-07');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ dayBasis: 'production_day', denominator: 'cones_plus_rejects', rows: [] });
    expect(r.json.metadata).toBeDefined();
    expect(db.statements.filter((s) => s.sql.includes('FROM sms.reject_event'))).toHaveLength(2);
    expect(stmt('FROM sms.cone_event')).toBeDefined();
  });

  it('requires from and to, and passes every filter through', async () => {
    expect((await get('/api/rejects/by-day-code')).status).toBe(400);
    expect((await get('/api/rejects/by-day-code?from=2026-09-01')).status).toBe(400);
    const r = await get('/api/rejects/by-day-code?from=2026-09-01&to=2026-09-07&shift=evening&station=2&product=21&code=weight');
    expect(r.status).toBe(200);
    const grouped = stmt('rc.reject_code_id')!;
    expect(grouped.inputs.get('shift')).toBe('evening');
    expect(grouped.inputs.get('station')).toBe(2);
    expect(grouped.inputs.get('product')).toBe(21);
    expect(grouped.inputs.get('codeType')).toBe('weight');
  });
});

describe('GET /api/rejects/reason', () => {
  it('is reachable and carries the dictionary row for the inline rename', async () => {
    expect((await get('/api/rejects/reason?day=2026-09-06&code=1-3', false)).status).toBe(401);
    const r = await get('/api/rejects/reason?day=2026-09-06&code=1-3');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({
      day: '2026-09-06', dayBasis: 'production_day', rejectCodeId: 11, label: 'Tube damaged', isPass: false,
      code: { rejectType: 'quality', tubeCode: 1, materialCode: 3 }, total: 0, page: 1, pageSize: 200, rows: [],
    });
    const list = db.statements.find((s) => s.sql.includes('OFFSET @offset'))!;
    expect(list.inputs.get('from')).toBe('2026-09-06');
    expect(list.inputs.get('to')).toBe('2026-09-06');
    expect(list.inputs.get('codeTube')).toBe(1);
  });

  it('refuses a missing day or code, a bad code, and a page size over 500', async () => {
    expect((await get('/api/rejects/reason?code=1-3')).status).toBe(400);
    expect((await get('/api/rejects/reason?day=2026-09-06')).status).toBe(400);
    expect((await get('/api/rejects/reason?day=2026-09-06&code=x')).status).toBe(400);
    expect((await get('/api/rejects/reason?day=2026-09-06&code=1-3&pageSize=501')).status).toBe(400);
  });
});
