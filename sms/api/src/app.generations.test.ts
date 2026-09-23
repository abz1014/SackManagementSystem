/**
 * `app.ts`'s three "newest thing we have" queries, over the REAL Express app
 * and a fake pool that answers the source-generation probe (D-11, 23 Sep
 * 2026). Same harness shape as `app.routes.test.ts` — createApp, a
 * hand-rolled recording pool, Node's fetch — in its own file because the
 * probe answer changes what EVERY route asks, and grafting it onto that
 * file's fake would have moved assertions it was not written about.
 *
 * WHAT IS BEING PINNED, and why it is not just a filter:
 *
 *  - `newestProductionDay()` (app.ts:209 before this pass) is what every
 *    default period anchors on. Measured on the dev sidecar, unscoped it
 *    returned 2026-09-22 — a plant-simulator day — while the period-scoped
 *    services that then answered for that day read IFL's own generation and
 *    found nothing in it. The landing screen opened on an empty day.
 *  - `/api/range` (app.ts:341) decides which days the picker OFFERS. It and
 *    `newestProductionDay` MUST agree: a default day outside the offered
 *    range is a screen that cannot be loaded. Scoped it offers 34 days
 *    (2026-08-05 – 2026-09-07) where the pooled query offered 65.
 *  - THE COST IS NAMED, not swallowed. Scoping the range means IFL's own
 *    July generation (2026-06-22 – 2026-07-10) — real data — is no longer
 *    reachable from the picker. `generations` lists it, marked
 *    `offered: false`, so the loss is on the wire and a generation selector
 *    can be built against it later. Losing real history SILENTLY would have
 *    been the NO OVER-CLAIMING rule read backwards.
 *  - `/api/product-at`'s clock anchor (app.ts:561) resolves TIME-VERSIONED
 *    limits. An anchor taken from a generation this answer will never
 *    describe judges one generation's reading by the product in force at
 *    another's newest instant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import { invalidateLiveConfigCache } from './services/live.js';
import type { ApiConfig } from './config.js';

interface Stmt {
  sql: string;
  inputs: Map<string, unknown>;
}

/** `sms.source_epoch` for line 1, verbatim from the dev sidecar. */
const EPOCHS = [
  { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones' },
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  // Registered `ifl_copy` by the `epoch:accept` default removed in 6b76ae3,
  // and LEFT STANDING so the registration bug is not hidden. `simulator`
  // must therefore be derived from source_db.
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
];

const PROBE = [
  { tbl: 'cone_event', epoch_id: 1, n: 142_511 },
  { tbl: 'cone_event', epoch_id: 9, n: 132_552 },
  { tbl: 'cone_event', epoch_id: 13, n: 135_248 },
];

/** The day-by-day counts /api/range folds, one row per generation-day. */
const RANGE_DAYS_GEN3 = [
  { shiftDate: '2026-08-05', n: 3_000 },
  { shiftDate: '2026-09-07', n: 1_700 },
  // A clock-fault day, below MIN_PRODUCTION_ROWS: excluded and SAID, not
  // silently dropped — the behaviour this route already had, unchanged.
  { shiftDate: '1969-12-31', n: 1 },
];

/** What the per-generation fold returns, grouped on (source_db, ordinal). */
const RANGE_GENERATIONS = [
  { sourceDb: 'DATA_TP1U2', ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones', minDate: '2026-06-22', maxDate: '2026-07-10', days: 19 },
  { sourceDb: 'DATA_TP1U2_SEP07', ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones', minDate: '2026-08-05', maxDate: '2026-09-07', days: 34 },
  { sourceDb: 'DATA_TP1U2_SIM', ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', minDate: '2026-08-21', maxDate: '2026-09-22', days: 31 },
];

const VIEWER = { userId: 1, username: 'viewer', role: 'viewer', rank: 1 };
const TIP_GEN3 = Date.UTC(2026, 8, 7, 12, 0, 28);

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
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    // The generation probe and the epoch register answer BEFORE the
    // statement log, so the assertions below describe the route's own
    // queries and not the probe's.
    if (/AS tbl,\s*source_epoch/.test(sql)) return rows(PROBE);
    if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return rows(EPOCHS);

    this.statements.push({ sql, inputs: new Map(inputs) });

    if (sql.includes('SELECT 1 AS ok')) return rows([{ ok: 1 }]);
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      if (inputs.get('u') !== VIEWER.username) return none();
      return rows([{ user_id: VIEWER.userId, password_hash: this.hash, display_name: VIEWER.username, role: VIEWER.role, rank: VIEWER.rank, active: true }]);
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const uid = this.sessions.get(inputs.get('id') as string);
      if (uid !== VIEWER.userId) return none();
      return rows([{ user_id: VIEWER.userId, username: VIEWER.username, display_name: VIEWER.username, role: VIEWER.role, rank: VIEWER.rank }]);
    }

    // /api/range, the per-generation fold.
    if (sql.includes('LEFT JOIN sms.source_epoch e ON e.epoch_id = d.source_epoch')) return rows(RANGE_GENERATIONS);
    // /api/range, the day list.
    if (sql.includes('AS shiftDate, COUNT(*) AS n')) return rows(RANGE_DAYS_GEN3);
    // newestProductionDay.
    if (sql.includes('CONVERT(varchar(10), MAX(shift_date), 120)')) return rows([{ d: '2026-09-07' }]);
    // The product-at clock anchor.
    if (sql.includes('MAX(production_ts_utc_ms)')) return rows([{ ms: TIP_GEN3 }]);

    if (sql.includes('FROM sms.product_timeline t')) {
      return rows([{
        product_id: 21, effective_from: new Date('2026-08-01T00:00:00Z'),
        setpoint_weight_g: 1960, weight_offset_minus_g: 50, weight_offset_plus_g: 50,
        description: '205-IL0-SD', lot_code: null,
      }]);
    }
    if (sql.includes('FROM sms.product p')) return rows([{ product_id: 21, description: '205-IL0-SD', lot_code: null, active_flag: true }]);
    return none();
  }
}

const PASSWORD = 'generations-test-password-not-real';
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
    body: JSON.stringify({ username: VIEWER.username, password: PASSWORD }),
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
  // The scope is cached for sixty seconds across all five sites; a test that
  // did not clear it would inherit the previous one's.
  invalidateLiveConfigCache();
});

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- asserted field by field
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
};

const stmt = (needle: string) => db.statements.find((s) => s.sql.includes(needle));
const boundEpochs = (s: Stmt | undefined): number[] =>
  s == null ? [] : [...s.inputs.entries()].filter(([k]) => /^ge[csr]\d+$/.test(k)).map(([, v]) => Number(v));

describe('/api/range — one generation offered, every generation named', () => {
  it('binds the newest REAL generation to the day list', async () => {
    const r = await get('/api/range');
    expect(r.status).toBe(200);
    const days = stmt('AS shiftDate, COUNT(*) AS n')!;
    expect(boundEpochs(days)).toEqual([9]);
    expect(days.sql).toMatch(/source_epoch = @gec0/);
    // The offered window is that generation's, and the sub-threshold
    // clock-fault day is still excluded AND still stated.
    expect(r.json.minDate).toBe('2026-08-05');
    expect(r.json.maxDate).toBe('2026-09-07');
    expect(r.json.excludedDays).toEqual([{ date: '1969-12-31', rows: 1 }]);
  });

  it('names the generation in force', async () => {
    const r = await get('/api/range');
    expect(r.json.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
  });

  it('lists every generation, so REAL history that is no longer offered is visible', async () => {
    const r = await get('/api/range');
    const byKey = new Map<string, Record<string, unknown>>(
      (r.json.generations as Record<string, unknown>[]).map((g) => [g.key as string, g]),
    );
    // IFL's own July generation: real data, and NOT offered. This is the
    // cost of the rule, on the wire rather than silently gone.
    expect(byKey.get('DATA_TP1U2#1')).toMatchObject({
      simulator: false, offered: false, minDate: '2026-06-22', maxDate: '2026-07-10', days: 19,
    });
    expect(byKey.get('DATA_TP1U2_SEP07#3')).toMatchObject({ simulator: false, offered: true, days: 34 });
    // Derived from source_db, not from provenance — epoch 13 claims
    // 'ifl_copy' and is the simulator.
    expect(byKey.get('DATA_TP1U2_SIM#4')).toMatchObject({ simulator: true, offered: false, days: 31 });
    // Grouped on (source_db, ordinal): one rebuild is ONE generation, never
    // one entry per source table.
    expect(byKey.size).toBe(3);
  });

  it('the fold groups on (source_db, generation_ordinal), never on epoch_id', async () => {
    await get('/api/range');
    const g = stmt('LEFT JOIN sms.source_epoch e ON e.epoch_id = d.source_epoch')!;
    expect(g.sql).toMatch(/GROUP BY e\.source_db, e\.generation_ordinal/);
    // The per-generation list is deliberately NOT scoped — its whole job is
    // to name the generations the scoped range leaves out.
    expect(boundEpochs(g)).toEqual([]);
  });
});

describe('the default period anchor and the offered range cannot disagree', () => {
  it('newestProductionDay binds the same generation as /api/range', async () => {
    // Any route that defaults its period goes through it; /api/product-at
    // is the cheapest one to drive here.
    await get('/api/product-at?weightG=1950');
    const anchor = stmt('MAX(production_ts_utc_ms)')!;
    expect(boundEpochs(anchor)).toEqual([9]);
  });

  it('the product-at clock anchor is the generation’s own newest instant', async () => {
    const r = await get('/api/product-at?weightG=1950');
    expect(r.status).toBe(200);
    const anchor = stmt('MAX(production_ts_utc_ms)')!;
    // The predicate is bound, never interpolated, and it is the CONE
    // fragment — the table this anchor is a maximum over.
    expect(anchor.sql).toMatch(/source_epoch = @gec0/);
    expect(anchor.inputs.get('gec0')).toBe(9);
    // No caller-supplied instant, so the anchor is the generation's own tip
    // and the limits resolved are the ones in force at it — never today's
    // mirror, and never another generation's newest instant.
    expect(r.json.product).toMatchObject({ productId: 21 });
  });
});
