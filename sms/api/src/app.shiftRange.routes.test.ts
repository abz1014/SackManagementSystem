/**
 * Chart overhaul wave 2, Task TC (28 Sep 2026): HTTP-level pin, per route
 * group, that the wire-form `fromShift`/`toShift` (or `periodFromShift`/
 * `periodToShift` on /api/weight-stations) — the `"YYYY-MM-DD.shift"` form
 * `web/src/lib/period.ts`'s `encodeShiftRef` produces — is decoded and
 * reaches the underlying service's own `shiftRange`/`period.shiftRange`
 * field. `shiftRangeParam.test.ts` already covers the decode function
 * itself in isolation; this file is the RED-then-GREEN HTTP pin per group:
 *
 *   - a bad or unpaired range -> 400
 *   - a valid range reaches the service with the right shiftRange
 *   - no range -> unchanged (service called with shiftRange undefined)
 *
 * Real Express app (`createApp`), a hand-rolled fake pool (same shape as
 * `app.routes.test.ts`/`routes/reports.generation.test.ts`), the target
 * service functions replaced with `vi.fn()` via `vi.mock` so a test can
 * assert on the exact object passed rather than on database output.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import type { ApiConfig } from './config.js';

vi.mock('./services/production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/production.js')>();
  return { ...actual, getProduction: vi.fn(actual.getProduction) };
});
vi.mock('./services/attention.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/attention.js')>();
  return { ...actual, getAttention: vi.fn(actual.getAttention) };
});
vi.mock('./services/weightStations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/weightStations.js')>();
  return { ...actual, getWeightStations: vi.fn(actual.getWeightStations) };
});
vi.mock('./services/spc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/spc.js')>();
  // getWeightSpc's real implementation needs SQL fixtures this file's fake
  // pool does not model (it's a full-population I-MR/Cp-Cpk computation) —
  // fully replaced rather than wrapped, so this test asserts on the call
  // arguments only, same as the task brief's "spy on the service function".
  return { ...actual, getWeightSpc: vi.fn(), getSpec: vi.fn(actual.getSpec) };
});
vi.mock('./services/rejectSpc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/rejectSpc.js')>();
  return { ...actual, getRejectSpc: vi.fn(actual.getRejectSpc) };
});
vi.mock('./services/rejects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/rejects.js')>();
  return { ...actual, getRejectPareto: vi.fn(actual.getRejectPareto), getRejectsByDayCode: vi.fn(actual.getRejectsByDayCode) };
});
vi.mock('./services/weights.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/weights.js')>();
  // Same reason as getWeightSpc above: getWeights's real implementation
  // needs a weight-rule row this file's fake pool does not model.
  return { ...actual, getWeights: vi.fn() };
});
vi.mock('./services/register.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/register.js')>();
  return { ...actual, listEvents: vi.fn(actual.listEvents) };
});
vi.mock('./services/reconcile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/reconcile.js')>();
  return { ...actual, getReconciliation: vi.fn(actual.getReconciliation) };
});
vi.mock('./services/sacks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/sacks.js')>();
  return { ...actual, getSackSummary: vi.fn(actual.getSackSummary) };
});

import { createApp } from './app.js';
import { getProduction } from './services/production.js';
import { getAttention } from './services/attention.js';
import { getWeightStations } from './services/weightStations.js';
import { getWeightSpc } from './services/spc.js';
import { getRejectSpc } from './services/rejectSpc.js';
import { getRejectPareto, getRejectsByDayCode } from './services/rejects.js';
import { getWeights } from './services/weights.js';
import { listEvents } from './services/register.js';
import { getReconciliation } from './services/reconcile.js';
import { getSackSummary } from './services/sacks.js';

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
const MANAGER: User = { userId: 3, username: 'manager', role: 'manager', rank: 3 };

class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest { return new FakeRequest(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = inputs.get('u') === MANAGER.username ? MANAGER : null;
      if (!u) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const uid = this.sessions.get(inputs.get('id') as string);
      if (uid !== MANAGER.userId) return none();
      return row({ user_id: MANAGER.userId, username: MANAGER.username, display_name: MANAGER.username, role: MANAGER.role, rank: MANAGER.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();
    if (sql.includes('MAX(shift_date)')) return row({ d: '2026-09-07' });
    return none();
  }
}

const PASSWORD = 'shift-range-routes-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let cookie: string;

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
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
    body: JSON.stringify({ username: 'manager', password: PASSWORD }),
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
  vi.mocked(getProduction).mockClear();
  vi.mocked(getAttention).mockClear();
  vi.mocked(getWeightStations).mockClear();
  vi.mocked(getWeightSpc).mockClear();
  vi.mocked(getRejectSpc).mockClear();
  vi.mocked(getRejectPareto).mockClear();
  vi.mocked(getRejectsByDayCode).mockClear();
  vi.mocked(getWeights).mockClear();
  vi.mocked(listEvents).mockClear();
  vi.mocked(getReconciliation).mockClear();
  vi.mocked(getSackSummary).mockClear();
});

function get(path: string): Promise<Response> {
  return fetch(`${base}${path}`, { headers: { Cookie: cookie } });
}

const RANGE_FROM = '2026-09-02.morning';
const RANGE_TO = '2026-09-03.night';
const EXPECT_RANGE = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('/api/production — shift range', () => {
  it('rejects an unpaired fromShift with 400', async () => {
    const res = await get('/api/production?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.morning');
    expect(res.status).toBe(400);
  });

  it('rejects a malformed shift name with 400', async () => {
    const res = await get('/api/production?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.midday&toShift=2026-09-03.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getProduction as shiftRange', async () => {
    const res = await get(`/api/production?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getProduction).mock.calls[0]!;
    expect(call[2]!.shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — getProduction receives shiftRange undefined, unchanged', async () => {
    const res = await get('/api/production?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getProduction).mock.calls[0]!;
    expect(call[2]!.shiftRange).toBeUndefined();
  });
});

describe('/api/attention — shift range (the selected period only, never the trailing window)', () => {
  it('start after end -> 400', async () => {
    const res = await get(
      '/api/attention?from=2026-09-02&to=2026-09-02&fromShift=2026-09-02.night&toShift=2026-09-02.morning',
    );
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getAttention\'s period argument, not the trailing one', async () => {
    const res = await get(`/api/attention?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getAttention).mock.calls[0]!;
    expect(call[3].shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/attention?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getAttention).mock.calls[0]!;
    expect(call[3].shiftRange).toBeUndefined();
  });
});

describe('/api/weight-stations — periodFromShift/periodToShift reach period.shiftRange, never the trailing from/to', () => {
  it('unpaired periodToShift -> 400', async () => {
    const res = await get('/api/weight-stations?to=2026-09-07&periodFrom=2026-09-02&periodTo=2026-09-03&periodToShift=2026-09-03.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getWeightStations\' 6th argument (period), leaving from/to (args 3/4) untouched', async () => {
    const res = await get(
      `/api/weight-stations?to=2026-09-07&periodFrom=2026-09-02&periodTo=2026-09-03&periodFromShift=${RANGE_FROM}&periodToShift=${RANGE_TO}`,
    );
    expect(res.status).toBe(200);
    const call = vi.mocked(getWeightStations).mock.calls[0]!;
    expect(call[5]).toEqual({ from: '2026-09-02', to: '2026-09-03', shiftRange: EXPECT_RANGE });
  });

  it('no periodFromShift/periodToShift — period.shiftRange is undefined', async () => {
    const res = await get('/api/weight-stations?to=2026-09-07&periodFrom=2026-09-02&periodTo=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getWeightStations).mock.calls[0]!;
    expect(call[5]).toEqual({ from: '2026-09-02', to: '2026-09-03', shiftRange: undefined });
  });
});

describe('/api/spc — shift range', () => {
  it('mismatched fromShift date vs from -> 400', async () => {
    const res = await get('/api/spc?from=2026-09-02&to=2026-09-03&fromShift=2026-09-01.morning&toShift=2026-09-03.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getWeightSpc\'s last argument', async () => {
    const res = await get(`/api/spc?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getWeightSpc).mock.calls[0]!;
    expect(call[9]).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/spc?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getWeightSpc).mock.calls[0]!;
    expect(call[9]).toBeUndefined();
  });
});

describe('/api/reject-spc — shift range', () => {
  it('malformed toShift -> 400', async () => {
    const res = await get('/api/reject-spc?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.morning&toShift=not-a-ref');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getRejectSpc\'s filters.shiftRange', async () => {
    const res = await get(`/api/reject-spc?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getRejectSpc).mock.calls[0]!;
    expect(call[6]!.shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/reject-spc?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getRejectSpc).mock.calls[0]!;
    expect(call[6]!.shiftRange).toBeUndefined();
  });
});

describe('/api/rejects (Pareto) — shift range', () => {
  it('only toShift given -> 400', async () => {
    const res = await get('/api/rejects?from=2026-09-02&to=2026-09-03&toShift=2026-09-03.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getRejectPareto\'s filters.shiftRange', async () => {
    const res = await get(`/api/rejects?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getRejectPareto).mock.calls[0]!;
    expect(call[2]!.shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/rejects?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getRejectPareto).mock.calls[0]!;
    expect(call[2]!.shiftRange).toBeUndefined();
  });
});

describe('/api/rejects/by-day-code — shift range', () => {
  it('start after end -> 400', async () => {
    const res = await get(
      '/api/rejects/by-day-code?from=2026-09-02&to=2026-09-02&fromShift=2026-09-02.night&toShift=2026-09-02.morning',
    );
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getRejectsByDayCode\'s filters.shiftRange', async () => {
    const res = await get(`/api/rejects/by-day-code?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getRejectsByDayCode).mock.calls[0]!;
    expect(call[2]!.shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/rejects/by-day-code?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getRejectsByDayCode).mock.calls[0]!;
    expect(call[2]!.shiftRange).toBeUndefined();
  });
});

describe('/api/weights — shift range', () => {
  it('malformed fromShift -> 400', async () => {
    const res = await get('/api/weights?from=2026-09-02&to=2026-09-03&fromShift=bad&toShift=2026-09-03.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getWeights\' last argument', async () => {
    const res = await get(`/api/weights?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getWeights).mock.calls[0]!;
    expect(call[5]).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/weights?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getWeights).mock.calls[0]!;
    expect(call[5]).toBeUndefined();
  });
});

describe('/api/events — shift range (resolved into RegisterFilters.shiftRange; listEvents/withShiftRangeEdges fold it into tsFrom/tsTo itself)', () => {
  it('both sides required -> 400 when only one given', async () => {
    const res = await get('/api/events?type=cone&from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.morning');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches listEvents\' query object as shiftRange', async () => {
    const res = await get(`/api/events?type=cone&from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(listEvents).mock.calls[0]!;
    expect(call[3].shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/events?type=cone&from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(listEvents).mock.calls[0]!;
    expect(call[3].shiftRange).toBeUndefined();
  });
});

describe('/api/reconciliation — shift range', () => {
  it('bad shift name -> 400', async () => {
    const res = await get('/api/reconciliation?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.midday&toShift=2026-09-03.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getReconciliation\'s last argument', async () => {
    const res = await get(`/api/reconciliation?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getReconciliation).mock.calls[0]!;
    expect(call[6]).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/reconciliation?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getReconciliation).mock.calls[0]!;
    expect(call[6]).toBeUndefined();
  });
});

describe('/api/sacks/summary — shift range', () => {
  it('toShift date disagrees with to -> 400', async () => {
    const res = await get('/api/sacks/summary?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.morning&toShift=2026-09-04.night');
    expect(res.status).toBe(400);
  });

  it('a valid range reaches getSackSummary\'s query.shiftRange', async () => {
    const res = await get(`/api/sacks/summary?from=2026-09-02&to=2026-09-03&fromShift=${RANGE_FROM}&toShift=${RANGE_TO}`);
    expect(res.status).toBe(200);
    const call = vi.mocked(getSackSummary).mock.calls[0]!;
    expect(call[2]!.shiftRange).toEqual(EXPECT_RANGE);
  });

  it('no range — unchanged', async () => {
    const res = await get('/api/sacks/summary?from=2026-09-02&to=2026-09-03');
    expect(res.status).toBe(200);
    const call = vi.mocked(getSackSummary).mock.calls[0]!;
    expect(call[2]!.shiftRange).toBeUndefined();
  });
});

describe('routes this task deliberately does NOT wire (accepted, safely ignored, or out of scope — see the task report for why)', () => {
  it('/api/shift-check ignores fromShift/toShift rather than 400ing (zod strips unknown keys)', async () => {
    const res = await get('/api/shift-check?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.morning&toShift=2026-09-03.night');
    expect(res.status).toBe(200);
  });

  it('/api/calibration/adjustments ignores fromShift/toShift the same way', async () => {
    const res = await get('/api/calibration/adjustments?from=2026-09-02&to=2026-09-03&fromShift=2026-09-02.morning&toShift=2026-09-03.night');
    expect(res.status).toBe(200);
  });

  it('/api/machines/running ignores fromShift/toShift (no period param at all — asOf is the only time input)', async () => {
    const res = await get('/api/machines/running?fromShift=2026-09-02.morning&toShift=2026-09-03.night');
    expect(res.status).toBe(200);
  });

  it('/api/product-changes ignores fromShift/toShift (keyset-paged by change_id, not period-scoped)', async () => {
    const res = await get('/api/product-changes?fromShift=2026-09-02.morning&toShift=2026-09-03.night');
    expect(res.status).toBe(200);
  });
});
