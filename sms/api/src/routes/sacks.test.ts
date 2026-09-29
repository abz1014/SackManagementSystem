/**
 * The Phase 7 sack routes against the REAL createApp (roadmap Phase 7, 15 Sep
 * 2026): the RBAC boundary of each, what the manual-movement route refuses,
 * and what a successful movement puts in the database. Same fixture shape as
 * routes/ops.test.ts — a recording fake pool with four accounts, argon2
 * credentials, Node's fetch — in its own file because three phases add routes
 * at once.
 *
 * Pinned here:
 *  - the three reads are rank 1, the write is rank 3 (the developer's default
 *    until IFL sets the rank);
 *  - /api/sacks/stock answers the exact path and shape Phase 8's report
 *    reads: basis 'line', machineLevel.enabled false with a reason, days;
 *  - the period queries validate from/to and cap the range at 366 days;
 *  - POST refuses a negative non-adjustment, a missing occurredAtPlant, an
 *    unknown product, a body with no reason on an adjustment — and a body
 *    that names a machine is written WITHOUT one (the schema has no field);
 *  - a successful POST is one transaction: the INSERT (no machine column)
 *    and the audit row 'stock.movement'.
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

class FakeTransaction {
  constructor(private readonly db: FakeDb) {}
  async begin(): Promise<this> { this.db.txLog.push('begin'); return this; }
  async commit(): Promise<void> { this.db.txLog.push('commit'); }
  async rollback(): Promise<void> { this.db.txLog.push('rollback'); }
  request(): FakeRequest { return new FakeRequest(this.db); }
}

interface User { userId: number; username: string; role: string; rank: number }
const USERS: User[] = [
  { userId: 1, username: 'viewer', role: 'viewer', rank: 1 },
  { userId: 2, username: 'engineer', role: 'engineer', rank: 2 },
  { userId: 3, username: 'manager', role: 'manager', rank: 3 },
  { userId: 4, username: 'admin', role: 'admin', rank: 4 },
];

class FakeDb {
  statements: Stmt[] = [];
  txLog: string[] = [];
  hash = '';
  sessions = new Map<string, number>();
  /** Products the mirror knows. */
  products = new Set<number>([21]);

  request(): FakeRequest { return new FakeRequest(this); }
  transaction(): FakeTransaction { return new FakeTransaction(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = USERS.find((x) => x.username === inputs.get('u'));
      if (!u) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const u = USERS.find((x) => x.userId === this.sessions.get(inputs.get('id') as string));
      if (!u) return none();
      return row({ user_id: u.userId, username: u.username, display_name: u.username, role: u.role, rank: u.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();
    if (sql.includes('SELECT COUNT(*) n FROM sms.product WHERE product_id = @id')) {
      return row({ n: this.products.has(inputs.get('id') as number) ? 1 : 0 });
    }
    if (sql.includes('sms.shift_rule')) return row({ ms: '06:00', es: '14:00', ns: '22:00', night_belongs_to: 'start_day' });
    if (sql.includes('sms.weight_rule')) return row({ basis: 'as_recorded', tare: 0.5 });
    if (sql.includes('sms.plausibility_rule')) return row({ cl: 1500, ch: 2100, sl: 40, sh: 60 });
    if (sql.includes('INSERT INTO sms.sack_stock_movement')) return row({ movement_id: 9, recorded_at_utc: new Date('2026-09-15T05:00:00Z') });
    return none();
  }
}

const PASSWORD = 'sacks-routes-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
const cookies: Record<string, string> = {};

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
  for (const u of USERS) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`fixture login failed for ${u.username}: ${res.status}`);
    cookies[u.username] = res.headers.get('set-cookie')!.split(';')[0]!;
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.statements = [];
  db.txLog = [];
});

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(who ? { Cookie: cookies[who]! } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

const MOVE = { movementType: 'issue', quantitySacks: 5, occurredAtPlant: '2026-09-14T10:30', reason: 'to warehouse' };

describe('RBAC rows for the Phase 7 routes', () => {
  it.each([
    { method: 'GET', path: '/api/sacks/summary?from=2026-09-01&to=2026-09-07', minRank: 1 },
    { method: 'GET', path: '/api/sacks/stock?from=2026-09-01&to=2026-09-07', minRank: 1 },
    { method: 'GET', path: '/api/sacks/movements?from=2026-09-01&to=2026-09-07', minRank: 1 },
    // rank 2 since 15 Sep 2026 (IFL Q43: the process engineer makes sack adjustments)
    { method: 'POST', path: '/api/sacks/movements', minRank: 2, body: MOVE },
  ])('$method $path (needs rank $minRank)', async (route) => {
    expect((await call(null, route.method, route.path, route.body)).status).toBe(401);
    for (const u of USERS) {
      const r = await call(u.username, route.method, route.path, route.body);
      if (u.rank < route.minRank) expect(r.status, `${u.username} on ${route.path}`).toBe(403);
      else {
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(401);
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(403);
      }
    }
  });
});

describe('the period reads', () => {
  it('/api/sacks/stock answers the shape the report reads: basis line, no machine level, a day per day', async () => {
    const r = await call('viewer', 'GET', '/api/sacks/stock?from=2026-09-01&to=2026-09-03');
    expect(r.status).toBe(200);
    expect(r.json.data.basis).toBe('line');
    expect(r.json.data.machineLevel).toEqual({ enabled: false, reason: expect.stringMatching(/no machine or station/) });
    expect(r.json.data.days.map((d: { day: string }) => d.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(r.json.data.opening).toEqual({ sacks: 0, kg: 0 });
    expect(r.json.data.closing).toEqual({ sacks: 0, kg: 0 });
    expect(r.json.metadata).toBeDefined();
  });

  it('validates from/to and caps the range at 366 days', async () => {
    expect((await call('viewer', 'GET', '/api/sacks/stock?from=2026-09-01')).status).toBe(400);
    expect((await call('viewer', 'GET', '/api/sacks/summary?from=2026-09-07&to=2026-09-01')).status).toBe(400);
    const wide = await call('viewer', 'GET', '/api/sacks/movements?from=2025-01-01&to=2026-09-01');
    expect(wide.status).toBe(400);
    expect(wide.json.error).toMatch(/range too large/);
    expect((await call('viewer', 'GET', '/api/sacks/summary?from=2026-09-01&to=2026-09-07&shift=day')).status).toBe(400);
  });

  it('/api/sacks/summary carries the caveats every consumer prints', async () => {
    const r = await call('viewer', 'GET', '/api/sacks/summary?from=2026-09-01&to=2026-09-07');
    expect(r.status).toBe(200);
    expect(r.json.data.sackTimeIsInsertTime).toBe(true);
    expect(r.json.data.conesPerSackApproximate).toBe(true);
    expect(r.json.data.machineLevel.enabled).toBe(false);
  });
});

/**
 * Chart overhaul wave 2, Task TD (29 Sep 2026) — gap 3, over the real route:
 * `/api/sacks/movements` now honours `fromShift`/`toShift` (services/
 * sackStock.ts's `listMovements`); `/api/sacks/stock` deliberately does not
 * (it is a running-balance snapshot, not a period listing).
 */
describe('Task TD (29 Sep 2026) — /api/sacks/movements honours a shift range; /api/sacks/stock does not', () => {
  it('fromShift/toShift bind occurred_at_plant BETWEEN the shift edges into the movements query', async () => {
    // fromShift/toShift's own dates must match from/to exactly — the same
    // "fromShift date does not match from" rule decodeShiftRangeParam
    // enforces for every route it wires into (shiftRangeParam.ts).
    const r = await call('viewer', 'GET', '/api/sacks/movements?from=2026-09-02&to=2026-09-02&fromShift=2026-09-02.evening&toShift=2026-09-02.evening');
    expect(r.status).toBe(200);
    const q = db.statements.find((s) => s.sql.includes('sms.sack_stock_movement m') && s.sql.includes('SELECT'))!;
    expect(q.sql).toMatch(/AND m\.occurred_at_plant BETWEEN @srFromTs AND @srToTs/);
    // 06:00/14:00/22:00 (the fake db's own sms.shift_rule row): evening is 14:00-22:00.
    expect((q.inputs.get('srFromTs') as Date).toISOString()).toBe('2026-09-02T14:00:00.000Z');
    expect((q.inputs.get('srToTs') as Date).toISOString()).toBe('2026-09-02T22:00:00.000Z');
  });

  it('with no fromShift/toShift, the movements query binds no instant window — unchanged', async () => {
    const r = await call('viewer', 'GET', '/api/sacks/movements?from=2026-09-01&to=2026-09-07');
    expect(r.status).toBe(200);
    const q = db.statements.find((s) => s.sql.includes('sms.sack_stock_movement m') && s.sql.includes('SELECT'))!;
    expect(q.sql).not.toMatch(/occurred_at_plant BETWEEN/);
  });

  it('a mismatched fromShift date is refused 400, the same shape decodeShiftRangeParam already gives other routes', async () => {
    const r = await call('viewer', 'GET', '/api/sacks/movements?from=2026-09-01&to=2026-09-07&fromShift=2026-09-03.evening&toShift=2026-09-02.evening');
    expect(r.status).toBe(400);
  });

  it('/api/sacks/stock ignores fromShift/toShift (a snapshot, not a range narrowing) — no instant window bound, still 200', async () => {
    const r = await call('viewer', 'GET', '/api/sacks/stock?from=2026-09-01&to=2026-09-03&fromShift=2026-09-02.evening&toShift=2026-09-02.evening');
    expect(r.status).toBe(200);
    expect(db.statements.some((s) => s.inputs.has('srFromTs'))).toBe(false);
  });
});

describe('POST /api/sacks/movements', () => {
  it('refuses a negative quantity on anything but an adjustment, and a zero', async () => {
    const neg = await call('manager', 'POST', '/api/sacks/movements', { ...MOVE, quantitySacks: -5 });
    expect(neg.status).toBe(400);
    expect(neg.json.detail).toMatch(/only an adjustment may be negative/);
    expect((await call('manager', 'POST', '/api/sacks/movements', { ...MOVE, quantitySacks: 0 })).status).toBe(400);
    expect(db.statements.some((s) => s.sql.includes('INSERT INTO sms.sack_stock_movement'))).toBe(false);
  });

  it('requires occurredAtPlant', async () => {
    const { occurredAtPlant: _x, ...without } = MOVE;
    void _x;
    const r = await call('manager', 'POST', '/api/sacks/movements', without);
    expect(r.status).toBe(400);
    expect(r.json.detail).toMatch(/occurredAtPlant/);
  });

  it('refuses an unknown product and an adjustment without a reason', async () => {
    const unknown = await call('manager', 'POST', '/api/sacks/movements', { ...MOVE, materialId: 999 });
    expect(unknown.status).toBe(400);
    expect(unknown.json.detail).toMatch(/no product 999/);
    const adj = await call('manager', 'POST', '/api/sacks/movements', { movementType: 'adjustment', quantitySacks: -1, occurredAtPlant: '2026-09-14T10:30' });
    expect(adj.status).toBe(400);
    expect(adj.json.detail).toMatch(/reason/);
  });

  it('writes the movement and its audit row in one transaction, never a machine — even when the body names one', async () => {
    const r = await call('manager', 'POST', '/api/sacks/movements', { ...MOVE, materialId: 21, quantityKg: 250, machineId: 3 });
    expect(r.status).toBe(201);
    expect(r.json.movementId).toBe(9);
    expect(r.json.productionDay).toBe('2026-09-14');
    expect(r.json.movement.machineId).toBeNull();
    expect(r.json.movement.source).toBe('manual');

    expect(db.txLog).toEqual(['begin', 'commit']);
    const insert = db.statements.find((s) => s.sql.includes('INSERT INTO sms.sack_stock_movement'))!;
    expect(insert).toBeDefined();
    expect(insert.sql).not.toMatch(/machine/i);
    expect([...insert.inputs.keys()]).not.toContain('machine');
    expect(insert.inputs.get('by')).toBe(3); // the manager
    expect(insert.inputs.get('material')).toBe(21);
    expect(insert.inputs.get('day')).toBe('2026-09-14');
    const audit = db.statements.find((s) => s.sql.includes('INSERT INTO sms.audit_log'))!;
    expect(audit.inputs.get('action')).toBe('stock.movement');
    expect(audit.inputs.get('actor')).toBe(3);
    expect(audit.inputs.get('target')).toBe('9');
    // the audit INSERT came after the movement INSERT, on the same transaction
    expect(db.statements.indexOf(audit)).toBeGreaterThan(db.statements.indexOf(insert));
  });
});
