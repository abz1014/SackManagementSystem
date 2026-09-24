/**
 * Roadmap: making the changeover workflow (services/changeover.ts) reachable
 * over HTTP — previously 441 lines with zero non-test callers. Against the
 * REAL createApp, same fixture shape as routes/sacks.test.ts (a recording
 * fake pool, four accounts, argon2 credentials, Node's fetch).
 *
 * Pinned here:
 *  - the RBAC row for all three routes: refs and plan are rank 1 (the
 *    one-audience rule — reads are not tiered), execute is rank 2, matching
 *    every other PDAS write route (PDAS_WRITE_RANK in app.ts);
 *  - POST /api/changeover/plan answers 200 with PDAS_WRITE_ENABLED unset —
 *    the dry run working while writes are off is the entire design;
 *  - the plan response carries reachesMachine: false and the operator
 *    sentence verbatim — the honesty contract;
 *  - POST /api/changeover/execute at rank 2 with writes off answers the
 *    `disabled` refusal, NEVER a 500, and writes exactly one
 *    sms.product_change row at outcome='disabled';
 *  - GET /api/changeover/refs returns the mirrored pallets;
 *  - signed out is 401 on all three.
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

interface User { userId: number; username: string; role: string; rank: number }
const USERS: User[] = [
  { userId: 1, username: 'viewer', role: 'viewer', rank: 1 },
  { userId: 2, username: 'engineer', role: 'engineer', rank: 2 },
  { userId: 3, username: 'manager', role: 'manager', rank: 3 },
  { userId: 4, username: 'admin', role: 'admin', rank: 4 },
];

class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest { return new FakeRequest(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    // ---- auth (same shape as routes/sacks.test.ts) ----
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

    // ---- the changeover mirror (services/changeover.ts's readMirror, and routes/changeover.ts's own /refs queries) ----
    // migration 041: both queries now also carry tube_form/tubeForm.
    if (sql.includes('tubeWeightG, tube_form tubeForm FROM sms.tube_type')) return rows([{ id: 3, name: 'PP Tube', tubeWeightG: 12, tubeForm: 2 }]); // /refs
    if (sql.includes('FROM sms.tube_type')) return rows([{ id: 3, name: 'PP Tube', w: 12, form: 2 }]); // readMirror
    if (sql.includes('FROM sms.blend')) return rows([{ id: 1, name: 'PolyBlend' }]);
    if (sql.includes('FROM sms.yarn_count')) return rows([{ id: 2, name: '30s' }]);
    if (sql.includes('FROM sms.pack_schema')) return rows([{ pack_schema_id: 1, description: 'Sack 3x4', cones_per_layer: 20, pack_type_id: 2 }]);
    if (sql.includes('FROM sms.pallet pl')) {
      return rows([
        { pallet_id: 50, product_id: 100, description: '205-IL0-SD', lot_code: null, pack_schema_id: 1, ps_desc: 'Sack 3x4', lot: 'LOT1', active_flag: true, desc1: 'Blue', label_type: 1, steam_prog: 0, routing: 0, pdas_created_at: new Date('2026-09-10T00:00:00Z') },
        { pallet_id: 51, product_id: 101, description: 'Old Retired Lot', lot_code: null, pack_schema_id: 1, ps_desc: 'Sack 3x4', lot: 'LOT-OLD', active_flag: false, desc1: null, label_type: 1, steam_prog: 0, routing: 0, pdas_created_at: new Date('2026-08-01T00:00:00Z') },
      ]);
    }
    // Checked before the generic 'FROM sms.product' match just below, which
    // 'FROM sms.product_change c' would otherwise satisfy as a substring.
    // GET /api/product-changes (services/productChanges.ts) — the row Brief 2's
    // fixture-level disabled-execute test proves gets written, read back here.
    if (sql.includes('FROM sms.product_change c')) {
      return rows([
        {
          change_id: 1, product_id: null, pallet_id: null, proc_name: 'CreateMaterial', operation: 'create',
          outcome: 'disabled', pdas_error_code: null, message: 'PDAS_WRITE_ENABLED is not true.',
          reason: 'Process engineer changeover, ticket 77', changed_by_name: 'engineer',
          changed_at: new Date('2026-09-16T10:00:00Z'), effective_from: null,
        },
      ]);
    }
    if (sql.includes('FROM sms.product')) {
      return rows([{ product_id: 100, blend_id: 1, count_id: 2, tube_type_id: 3, active_flag: true, description: '205-IL0-SD', lot_code: null }]);
    }
    if (sql.includes('sms.plausibility_rule')) return row({ cl: 1500, ch: 2100, sl: 40, sh: 60 });
    if (sql.includes('INSERT INTO sms.product_change')) return none();

    return none();
  }
}

const PASSWORD = 'changeover-routes-test-password-not-real';
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
    // Never set to true anywhere in this file — the whole point of the plan
    // route, and of this fixture, is that the dry run works without it.
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

const CHANGEOVER_BODY = {
  blend: { id: 1 },
  count: { id: 2 },
  tubeType: { id: 3 },
  material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: '205-IL0-SD-NEW', ppColour: 'Blue' },
  pallet: { packSchemaId: 1, lot: null, sackColour: 'Blue' },
  retire: { productIds: [], palletIds: [] },
  reason: 'Process engineer changeover, ticket 77',
};

describe('RBAC rows for the changeover routes', () => {
  it.each([
    { method: 'GET', path: '/api/changeover/refs', minRank: 1 },
    { method: 'POST', path: '/api/changeover/plan', minRank: 1, body: CHANGEOVER_BODY },
    // rank 2 — matches PDAS_WRITE_RANK, the same gate every other PDAS write route uses.
    { method: 'POST', path: '/api/changeover/execute', minRank: 2, body: CHANGEOVER_BODY },
    // rank 1 — a read, the one-audience rule (CLAUDE.md).
    { method: 'GET', path: '/api/product-changes', minRank: 1 },
  ])('$method $path (needs rank $minRank)', async (route) => {
    expect((await call(null, route.method, route.path, route.body)).status).toBe(401);
    for (const u of USERS) {
      const r = await call(u.username, route.method, route.path, route.body);
      if (u.rank < route.minRank) expect(r.status, `${u.username} on ${route.path}`).toBe(403);
      else {
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(401);
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(403);
        expect(r.status, `${u.username} on ${route.path}`).not.toBe(500);
      }
    }
  });
});

describe('GET /api/changeover/refs', () => {
  it('returns the mirrored blends, counts, tube types, pack schemas and pallets', async () => {
    const r = await call('viewer', 'GET', '/api/changeover/refs');
    expect(r.status).toBe(200);
    expect(r.json.blends).toEqual([{ id: 1, name: 'PolyBlend' }]);
    expect(r.json.counts).toEqual([{ id: 2, name: '30s' }]);
    expect(r.json.tubeTypes).toEqual([{ id: 3, name: 'PP Tube', tubeWeightG: 12, tubeForm: 2 }]);
    expect(r.json.packSchemas).toEqual([{ packSchemaId: 1, description: 'Sack 3x4', conesPerLayer: 20, packTypeId: 2 }]);
    // Only the active pallet (50) — the inactive one (51) is not selectable and is filtered out.
    expect(r.json.pallets).toHaveLength(1);
    expect(r.json.pallets[0]).toMatchObject({ palletId: 50, productId: 100, active: true, lot: 'LOT1' });
  });
});

describe('POST /api/changeover/plan', () => {
  it('answers 200 with PDAS_WRITE_ENABLED unset — the dry run working while writes are off is the entire design', async () => {
    const r = await call('viewer', 'POST', '/api/changeover/plan', CHANGEOVER_BODY);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.steps)).toBe(true);
    expect(r.json.writesEnabled).toBe(false);
    // Never opens the writer pool: nothing in the fixture answered a PDAS-only
    // query, and no product_change row was written by a mere plan.
    expect(db.statements.some((s) => s.sql.includes('INSERT INTO sms.product_change'))).toBe(false);
  });

  it('carries the honesty contract: reachesMachine false, and the operator sentence verbatim', async () => {
    const r = await call('viewer', 'POST', '/api/changeover/plan', CHANGEOVER_BODY);
    expect(r.status).toBe(200);
    expect(r.json.reachesMachine).toBe(false);
    expect(r.json.operatorNote).toBe(
      'This makes the product available in PDAS and records what was intended. The operator still selects it on the QCS panel at the machine.',
    );
  });

  it('400s a structurally invalid body rather than 500ing', async () => {
    const r = await call('viewer', 'POST', '/api/changeover/plan', { nonsense: true });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/changeover/execute', () => {
  it('rank 1 -> 403; rank 2 with writes off -> the disabled refusal, never a 500, plus exactly one sms.product_change row at outcome=disabled', async () => {
    const asViewer = await call('viewer', 'POST', '/api/changeover/execute', CHANGEOVER_BODY);
    expect(asViewer.status).toBe(403);

    const asEngineer = await call('engineer', 'POST', '/api/changeover/execute', CHANGEOVER_BODY);
    expect(asEngineer.status).not.toBe(500);
    expect(asEngineer.status).toBe(503);
    expect(asEngineer.json.code).toBe('DISABLED');
    expect(asEngineer.json.reachesMachine).toBe(false);

    const inserts = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.product_change'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.inputs.get('outcome')).toBe('disabled');
    expect(inserts[0]!.inputs.get('by')).toBe(2); // the engineer
  });
});

describe('GET /api/product-changes', () => {
  it('returns the disabled attempt the changeover route recorded', async () => {
    const r = await call('viewer', 'GET', '/api/product-changes');
    expect(r.status).toBe(200);
    expect(r.json.entries).toHaveLength(1);
    expect(r.json.entries[0]).toMatchObject({
      changeId: 1,
      procName: 'CreateMaterial',
      operation: 'create',
      outcome: 'disabled',
      message: 'PDAS_WRITE_ENABLED is not true.',
      reason: 'Process engineer changeover, ticket 77',
      changedByName: 'engineer',
      effectiveFromUtc: null,
    });
    expect(r.json.nextBefore).toBe(null);
  });
});
