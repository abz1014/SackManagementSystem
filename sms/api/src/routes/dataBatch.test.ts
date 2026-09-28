/**
 * GET /api/data-batch (Task D, 28 Sep 2026) — HTTP-level tests, real Express
 * app (`createApp`), fake pool. Mirrors the harness shape
 * `reports.generation.test.ts` already uses for the same reason: proving the
 * route, not just the service underneath it.
 *
 * Three things pinned here:
 *  1. Rank 1 (any signed-in account, including a viewer) can call it.
 *  2. An impossible calendar date is rejected with 400, not silently
 *     normalized (dates.ts's own `isoDate` reasoning).
 *  3. The answer does NOT move under `setLiveScopeIncludesSimulator` — this
 *     route calls `resolveGenerationScope` directly, never `resolveLiveScope`,
 *     so the dev-only live policy (`live.ts`) must have no effect on it. The
 *     period banner and the live banner are two different questions; this
 *     test is what keeps them from being accidentally wired together.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';
import { setLiveScopeIncludesSimulator } from '../services/live.js';
import type { DataBatchData } from './ops.js';

interface DataBatchResponse { data: DataBatchData }

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
const ROLES: User[] = [
  { userId: 1, username: 'viewer', role: 'viewer', rank: 1 },
  { userId: 3, username: 'manager', role: 'manager', rank: 3 },
];

interface PresentRow { tbl: string; epoch_id: number | null; n: number }
interface EpochRow {
  epoch_id: number;
  source_db: string | null;
  generation_ordinal: number | null;
  provenance: string | null;
  label: string | null;
}

const SEPT: EpochRow = {
  epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3,
  provenance: 'ifl_copy', label: 'September copy - cones',
};
const SIM: EpochRow = {
  epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4,
  provenance: 'simulator', label: 'pack1_TP1U2 gen 4 (simulator)',
};

class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();
  present: PresentRow[] = [{ tbl: 'cone_event', epoch_id: 9, n: 500 }];
  epochs: EpochRow[] = [SEPT, SIM];

  request(): FakeRequest { return new FakeRequest(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = ROLES.find((x) => x.username === inputs.get('u'));
      if (!u) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const u = ROLES.find((x) => x.userId === this.sessions.get(inputs.get('id') as string));
      if (!u) return none();
      return row({ user_id: u.userId, username: u.username, display_name: u.username, role: u.role, rank: u.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();
    if (sql.includes('INSERT INTO sms.audit_log')) return none();
    if (sql.includes('MAX(shift_date)')) return row({ d: '2026-09-07' });
    if (sql.includes('FROM sms.line l')) {
      return row({
        line_id: 1, line_code: 'L3', line_name: 'Line 3', display_name: 'TP1 · Line 3 · Unit 2', is_active: true,
        unit_id: 1, unit_code: 'U2', unit_name: 'Unit 2', plant_id: 1, plant_code: 'TP1', plant_name: 'TP1',
      });
    }
    // resolveGenerationScope's own two queries — see generation.ts.
    if (sql.includes('AS tbl, source_epoch AS epoch_id, COUNT(*) AS n')) {
      return rows(this.present as unknown as Record<string, unknown>[]);
    }
    if (sql.includes('FROM sms.source_epoch WHERE line_id = @line')) {
      return rows(this.epochs as unknown as Record<string, unknown>[]);
    }
    return none();
  }
}

const PASSWORD = 'data-batch-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let viewerCookie: string;

beforeAll(async () => {
  db = new FakeDb();
  db.hash = await argon2.hash(PASSWORD);
  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    lineName: 'Test line',
    liveAllowAsOf: true,
    cacheTtlSeconds: 0,
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
    body: JSON.stringify({ username: 'viewer', password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  viewerCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(() => {
  setLiveScopeIncludesSimulator(false);
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.statements = [];
  db.present = [{ tbl: 'cone_event', epoch_id: 9, n: 500 }];
  db.epochs = [SEPT, SIM];
  setLiveScopeIncludesSimulator(false);
});

describe('GET /api/data-batch', () => {
  it('rank 1 (a viewer) can call it', async () => {
    const res = await fetch(`${base}/api/data-batch?from=2026-08-21&to=2026-09-07`, { headers: { Cookie: viewerCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBatchResponse;
    expect(body.data.batches).toHaveLength(1);
    expect(body.data.batches[0]).toMatchObject({ sourceDb: 'DATA_TP1U2_SEP07', ordinal: 3, simulator: false });
  });

  it('an unsigned-in caller is refused', async () => {
    const res = await fetch(`${base}/api/data-batch?from=2026-08-21&to=2026-09-07`);
    expect(res.status).toBe(401);
  });

  it('an impossible calendar date gives 400, not a silently rolled-over range', async () => {
    const res = await fetch(`${base}/api/data-batch?from=2026-02-30&to=2026-03-01`, { headers: { Cookie: viewerCookie } });
    expect(res.status).toBe(400);
  });

  it('from without to (or the reverse) gives 400', async () => {
    const res = await fetch(`${base}/api/data-batch?from=2026-08-21`, { headers: { Cookie: viewerCookie } });
    expect(res.status).toBe(400);
  });

  it('a range beyond MAX_RANGE_DAYS gives 400', async () => {
    const res = await fetch(`${base}/api/data-batch?from=2020-01-01&to=2026-09-07`, { headers: { Cookie: viewerCookie } });
    expect(res.status).toBe(400);
  });

  it('with no window given, resolves the newest generation overall', async () => {
    const res = await fetch(`${base}/api/data-batch`, { headers: { Cookie: viewerCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBatchResponse;
    expect(body.data.batches).toHaveLength(1);
  });

  it('reports a simulator generation as simulator when it is the only one present', async () => {
    db.present = [{ tbl: 'cone_event', epoch_id: 13, n: 200 }];
    db.epochs = [SIM];
    const res = await fetch(`${base}/api/data-batch?from=2026-09-15&to=2026-09-22`, { headers: { Cookie: viewerCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataBatchResponse;
    expect(body.data.batches[0]).toMatchObject({ sourceDb: 'DATA_TP1U2_SIM', simulator: true });
  });

  it('gives the same answer whether the dev-only live-scope simulator policy is off or on', async () => {
    setLiveScopeIncludesSimulator(false);
    const off = (await (await fetch(`${base}/api/data-batch?from=2026-08-21&to=2026-09-07`, { headers: { Cookie: viewerCookie } })).json()) as DataBatchResponse;
    setLiveScopeIncludesSimulator(true);
    const on = (await (await fetch(`${base}/api/data-batch?from=2026-08-21&to=2026-09-07`, { headers: { Cookie: viewerCookie } })).json()) as DataBatchResponse;
    expect(on.data.batches).toEqual(off.data.batches);
    setLiveScopeIncludesSimulator(false);
  });
});
