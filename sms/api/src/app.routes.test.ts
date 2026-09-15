/**
 * Behavioural tests for the write routes app.rbac.test.ts only gates: what
 * each one actually sends to the database, and what it refuses. Same shape
 * as that file — the REAL createApp, a hand-rolled fake pool, Node's fetch —
 * but this fake RECORDS every statement and its bound parameters, so a test
 * can assert "the UPDATE bound setPass = false" rather than only "200".
 *
 * Each case here pins a defect found on 14 Sep 2026 (Wave A of the roadmap
 * gap analysis) or a behaviour the Setup screen relies on and nothing tested:
 *  - renaming a reject code wiped its pass flag;
 *  - `active: "false"` re-activated a product instead of retiring it;
 *  - the three admin rule routes were tested for their gate and nothing else;
 *  - /api/product-at grew a server-side verdict and the sheet now trusts it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

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

const ADMIN = { userId: 4, username: 'admin', role: 'admin', rank: 4 };
const MANAGER = { userId: 3, username: 'manager', role: 'manager', rank: 3 };

/** Stands in for mssql.Transaction; records begin/commit/rollback on the db. */
class FakeTransaction {
  constructor(private readonly db: FakeDb) {}
  async begin(): Promise<this> { this.db.txLog.push('begin'); return this; }
  async commit(): Promise<void> { this.db.txLog.push('commit'); }
  async rollback(): Promise<void> { this.db.txLog.push('rollback'); }
  request(): FakeRequest { return new FakeRequest(this.db); }
}

class FakeDb {
  statements: Stmt[] = [];
  txLog: string[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction(): FakeTransaction {
    return new FakeTransaction(this);
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = [ADMIN, MANAGER].find((x) => x.username === inputs.get('u'));
      if (!u) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const uid = this.sessions.get(inputs.get('id') as string);
      const u = [ADMIN, MANAGER].find((x) => x.userId === uid);
      if (!u) return none();
      return row({ user_id: u.userId, username: u.username, display_name: u.username, role: u.role, rank: u.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();

    // /api/product-at: a line-wide timeline with one product, a catalogue
    // with one version of its limits, and a newest cone at 12:00.
    if (sql.includes('FROM sms.product_timeline t')) {
      return row({
        product_id: 21, effective_from: new Date('2026-08-01T00:00:00Z'),
        setpoint_weight_g: 1960, weight_offset_minus_g: 50, weight_offset_plus_g: 50,
        description: '205-IL0-SD', lot_code: null,
      });
    }
    if (sql.includes('FROM sms.product_limit_version')) {
      return row({
        product_id: 21, setpoint_g: 1960, offset_minus_g: 50, offset_plus_g: 50,
        effective_from: new Date('2026-08-01T00:00:00Z'), effective_is_lower_bound: false, source: 'pdas_observed',
      });
    }
    if (sql.includes('SELECT product_id, description, lot_code, active_flag FROM sms.product')) {
      return row({ product_id: 21, description: '205-IL0-SD', lot_code: null, active_flag: true });
    }
    if (sql.includes('MAX(production_ts_utc_ms)')) return row({ ms: Date.UTC(2026, 8, 7, 12, 0, 0) });

    if (/\bOUTPUT\b/i.test(sql)) {
      return row({ id: 1, timeline_id: 1, old_label: 'old name', old_is_pass: true, old_active: true, old_role: 1, old_name: null });
    }
    return none();
  }
}

const PASSWORD = 'routes-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  // The API logs every refused request and every 500 as a JSON line on
  // stdout (api/src/log.ts, 14 Sep 2026); quiet it here, as app.rbac.test.ts does.
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
  for (const u of [ADMIN, MANAGER]) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`fixture login failed for ${u.username}: ${res.status}`);
    cookies[u.role] = res.headers.get('set-cookie')!.split(';')[0]!;
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

async function call(role: 'admin' | 'manager', method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookies[role]!, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // audit() is fire-and-forget; give its INSERT a tick to land in the log.
  await new Promise((r) => setTimeout(r, 10));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field
  const json: any = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

const stmt = (needle: string) => db.statements.find((s) => s.sql.includes(needle));
const audits = () => db.statements.filter((s) => s.sql.includes('INSERT INTO sms.audit_log'));

describe('PUT /api/reject-codes/:id — renaming must not touch the pass flag', () => {
  it('a rename alone binds setPass = false, so is_pass keeps its value', async () => {
    const r = await call('manager', 'PUT', '/api/reject-codes/12', { label: 'Tube damaged' });
    expect(r.status).toBe(200);
    const u = stmt('UPDATE sms.reject_code')!;
    expect(u).toBeDefined();
    expect(u.inputs.get('label')).toBe('Tube damaged');
    expect(u.inputs.get('setPass')).toBe(false);
    expect(u.inputs.get('pass')).toBeNull();
    // The SQL itself must leave the column alone when setPass is off.
    expect(u.sql).toMatch(/is_pass = CASE WHEN @setPass = 1 THEN @pass ELSE is_pass END/);
    // Audit says what changed and does not claim a pass-flag change.
    const a = audits()[0]!;
    expect(a.inputs.get('detail')).toBe('label "old name" -> "Tube damaged"');
  });

  it('an explicit isPass binds setPass = true and the value, and the audit names both', async () => {
    const r = await call('manager', 'PUT', '/api/reject-codes/12', { label: 'Tube damaged', isPass: false });
    expect(r.status).toBe(200);
    const u = stmt('UPDATE sms.reject_code')!;
    expect(u.inputs.get('setPass')).toBe(true);
    expect(u.inputs.get('pass')).toBe(false);
    expect(audits()[0]!.inputs.get('detail')).toBe('label "old name" -> "Tube damaged", is_pass true -> false');
  });

  it('an explicit null clears the flag deliberately', async () => {
    await call('manager', 'PUT', '/api/reject-codes/12', { label: null, isPass: null });
    const u = stmt('UPDATE sms.reject_code')!;
    expect(u.inputs.get('setPass')).toBe(true);
    expect(u.inputs.get('pass')).toBeNull();
    expect(u.inputs.get('label')).toBeNull();
  });

  it('rejects a non-integer id and a label over 128 characters', async () => {
    expect((await call('manager', 'PUT', '/api/reject-codes/abc', { label: 'x' })).status).toBe(400);
    expect((await call('manager', 'PUT', '/api/reject-codes/12', { label: 'x'.repeat(129) })).status).toBe(400);
    expect(stmt('UPDATE sms.reject_code')).toBeUndefined();
  });
});

describe('POST /api/products/:id/active — booleans are booleans', () => {
  const reason = 'retiring after the trial run ended';

  it('refuses the string "false" instead of coercing it to true', async () => {
    const r = await call('manager', 'POST', '/api/products/21/active', { active: 'false', reason });
    expect(r.status).toBe(400);
  });

  it('refuses 0/1 as well — the client sends JSON booleans', async () => {
    expect((await call('manager', 'POST', '/api/products/21/active', { active: 0, reason })).status).toBe(400);
    expect((await call('manager', 'POST', '/api/products/21/active', { active: 1, reason })).status).toBe(400);
  });

  it('accepts a real boolean and reaches the (disabled) write path, which answers 503', async () => {
    const r = await call('manager', 'POST', '/api/products/21/active', { active: false, reason });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('DISABLED');
  });

  it('POST /api/products applies the same rule to fields.active', async () => {
    const body = {
      blendId: 1, countId: 2, tubeTypeId: 3, reason: 'new material for the October run',
      fields: { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, active: 'true' },
    };
    expect((await call('manager', 'POST', '/api/products', body)).status).toBe(400);
    body.fields.active = true as unknown as string;
    expect((await call('manager', 'POST', '/api/products', body)).status).toBe(503);
  });
});

describe('POST /api/admin/rules/* — what reaches the database', () => {
  it('weight: inserts a new version with the admin as changed_by and the reason', async () => {
    const r = await call('admin', 'POST', '/api/admin/rules/weight', {
      basis: 'net', coneTubeWeightG: 62.5, sackTareKg: 0.35, reason: 'IFL confirmed net weights',
    });
    expect(r.status).toBe(200);
    const ins = stmt('INSERT INTO sms.weight_rule')!;
    expect(ins).toBeDefined();
    expect(ins.inputs.get('line')).toBe(1);
    expect(ins.inputs.get('b')).toBe('net');
    expect(ins.inputs.get('tube')).toBe(62.5);
    expect(ins.inputs.get('tare')).toBe(0.35);
    expect(ins.inputs.get('by')).toBe(ADMIN.userId);
    expect(ins.inputs.get('reason')).toBe('IFL confirmed net weights');
    // Versioned, never overwritten: the route must INSERT, not UPDATE.
    expect(stmt('UPDATE sms.weight_rule')).toBeUndefined();
    expect(audits()[0]!.inputs.get('action')).toBe('rule.weight');
  });

  it('weight: refuses an unknown basis and a negative tube weight', async () => {
    expect((await call('admin', 'POST', '/api/admin/rules/weight', { basis: 'tare', coneTubeWeightG: 1, sackTareKg: 1 })).status).toBe(400);
    expect((await call('admin', 'POST', '/api/admin/rules/weight', { basis: 'net', coneTubeWeightG: -1, sackTareKg: 1 })).status).toBe(400);
    expect(stmt('INSERT INTO sms.weight_rule')).toBeUndefined();
  });

  it('shift: inserts the three start times as PARAMETERS and says a rebuild is due', async () => {
    // Until 14 Sep 2026 the INSERT carried '06:00','14:00','22:00' as
    // literals; roadmap Phase 1 makes the boundaries a rule, not a constant.
    const r = await call('admin', 'POST', '/api/admin/rules/shift', {
      morningStart: '06:00', eveningStart: '14:00', nightStart: '22:00', mode: 'corrected', nightBelongsTo: 'calendar_day',
    });
    expect(r.status).toBe(200);
    expect(r.json.rebuildRequired).toBe(true);
    const ins = stmt('INSERT INTO sms.shift_rule')!;
    expect(ins.inputs.get('ms')).toBe('06:00');
    expect(ins.inputs.get('es')).toBe('14:00');
    expect(ins.inputs.get('ns')).toBe('22:00');
    expect(ins.inputs.get('mode')).toBe('corrected');
    expect(ins.inputs.get('nb')).toBe('calendar_day');
    expect(ins.inputs.get('by')).toBe(ADMIN.userId);
    expect(ins.inputs.get('reason')).toBeNull();
    expect(ins.sql).not.toMatch(/'06:00'|'14:00'|'22:00'/);
    expect(audits()[0]!.inputs.get('action')).toBe('rule.shift');
  });

  it('shift: refuses a value outside the two enums', async () => {
    expect((await call('admin', 'POST', '/api/admin/rules/shift', {
      morningStart: '06:00', eveningStart: '14:00', nightStart: '22:00', mode: 'corrected', nightBelongsTo: 'next_day',
    })).status).toBe(400);
    expect(stmt('INSERT INTO sms.shift_rule')).toBeUndefined();
  });

  it('plausibility: refuses an inverted window, naming the field', async () => {
    const r = await call('admin', 'POST', '/api/admin/rules/plausibility', { coneLoG: 2100, coneHiG: 1500, sackLoKg: 40, sackHiKg: 60 });
    expect(r.status).toBe(400);
    expect(r.json.detail).toContain('coneLoG must be less than coneHiG');
    expect(stmt('INSERT INTO sms.plausibility_rule')).toBeUndefined();
  });

  it('plausibility: inserts all four bounds and applies at read time (no rebuild flag)', async () => {
    const r = await call('admin', 'POST', '/api/admin/rules/plausibility', {
      coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60, reason: 'baseline confirmed with the process engineer',
    });
    expect(r.status).toBe(200);
    expect(r.json.rebuildRequired).toBeUndefined();
    const ins = stmt('INSERT INTO sms.plausibility_rule')!;
    expect([ins.inputs.get('cl'), ins.inputs.get('ch'), ins.inputs.get('sl'), ins.inputs.get('sh')]).toEqual([1500, 2100, 40, 60]);
    expect(ins.inputs.get('by')).toBe(ADMIN.userId);
    expect(audits()[0]!.inputs.get('action')).toBe('rule.plausibility');
  });
});

describe('GET /api/product-at — the verdict is computed server-side', () => {
  it('with a weight: judges it against the limits in force then, from the versioned history', async () => {
    const r = await call('manager', 'GET', '/api/product-at?at=2026-09-07T11:35:00Z&productId=21&weightG=1768');
    expect(r.status).toBe(200);
    expect(r.json.attribution).toBe('row');
    expect(r.json.limits).toMatchObject({ targetG: 1960, loG: 1910, hiG: 2010 });
    // roadmap Phase 4: the one classification rides beside the older facts; no scale bit was sent.
    expect(r.json.verdict).toEqual({ inside: false, outsideByG: -142, reason: null, state: 'low', scalePassed: null, unknownReason: null });
    expect(r.json.limitsAreLowerBound).toBe(false);
  });

  it('inside the limits: outsideByG is 0', async () => {
    const r = await call('manager', 'GET', '/api/product-at?at=2026-09-07T11:35:00Z&productId=21&weightG=1965');
    expect(r.json.verdict).toEqual({ inside: true, outsideByG: 0, reason: null, state: 'within', scalePassed: null, unknownReason: null });
  });

  it('without a weight: no verdict, and the rest of the shape is unchanged', async () => {
    const r = await call('manager', 'GET', '/api/product-at?at=2026-09-07T11:35:00Z&productId=21');
    expect(r.json.verdict).toBeNull();
    expect(r.json.product.label).toBe('205-IL0-SD');
    expect(r.json.limits.label).toBe('1,960 ± 50 g');
  });

  it('without a productId: falls back to the line-wide timeline and says so', async () => {
    const r = await call('manager', 'GET', '/api/product-at?at=2026-09-07T11:35:00Z&weightG=2020');
    expect(r.json.attribution).toBe('timeline');
    expect(r.json.verdict).toEqual({ inside: false, outsideByG: 10, reason: null, state: 'high', scalePassed: null, unknownReason: null });
  });

  it('refuses a non-numeric weight', async () => {
    expect((await call('manager', 'GET', '/api/product-at?weightG=heavy')).status).toBe(400);
  });
});

describe('GET /api/weight-stations — `to` resolves `from` without asking for the newest production day (T3)', () => {
  it('to=2026-08-31&trailingDays=14 resolves from=2026-08-18 and never issues the MAX(shift_date) query', async () => {
    const r = await call('manager', 'GET', '/api/weight-stations?to=2026-08-31&trailingDays=14');
    expect(r.status).toBe(200);
    expect(r.json.data.from).toBe('2026-08-18');
    expect(r.json.data.to).toBe('2026-08-31');
    // Before the fix this ran unconditionally and threw its answer away
    // whenever `to` was already given — a wasted round trip on every call
    // that names an explicit window, including every report.
    expect(db.statements.some((s) => s.sql.includes('MAX(shift_date)'))).toBe(false);
  });
});
