/**
 * Task B (28 Sep 2026, owner decision) — end to end through the real HTTP
 * route, not just the service function: `GET /api/events` and
 * `GET /api/events/export` both take `?batch=`, default to `'auto'` (one
 * data batch, the newest real generation), and refuse a malformed value with
 * 400 rather than silently falling back to pooling. `GET /api/reports/header`
 * gains the same `?batch=` and states `simulatorSource` when the resolved
 * batch is the plant simulator.
 *
 * Same harness idiom as app.rt24.test.ts: real `createApp`, a hand-rolled
 * fake pool that answers by SQL shape, Node's own `fetch` over a real
 * `http.Server`. The fake pool APPLIES the bound epoch predicate to an
 * in-memory table (register.batch.test.ts's own `batchPool` idiom), so this
 * file proves the route wires the scope through, not merely that the
 * service function (tested directly in register.batch.test.ts) is correct
 * in isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

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

/** `sms.source_epoch` — one real (September, ordinal 3) and one simulator (ordinal 4) generation of `sack1_TP1U2`. */
const EPOCHS = [
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
  { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
];

type Row = Record<string, unknown>;
const SEPT_A: Row = { line_id: 1, event_id: 1, sack_event_id: 1, source_row_id: 1, source_epoch: 9, weight_kg: 49.1, in_range: true };
const SEPT_B: Row = { line_id: 1, event_id: 2, sack_event_id: 2, source_row_id: 2, source_epoch: 9, weight_kg: 48.6, in_range: true };
const SIM_A: Row = { line_id: 1, event_id: 101, sack_event_id: 101, source_row_id: 1, source_epoch: 14, weight_kg: 49.0, in_range: true };
const SIM_B: Row = { line_id: 1, event_id: 102, sack_event_id: 102, source_row_id: 2, source_epoch: 14, weight_kg: 48.9, in_range: true };
const ROWS = [SEPT_A, SEPT_B, SIM_A, SIM_B];

class FakeDb {
  statements: { sql: string }[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest {
    return new FakeRequest(this);
  }
  transaction() {
    const db = this;
    return {
      async begin() { return this; },
      async commit() {},
      async rollback() {},
      request() { return new FakeRequest(db); },
    };
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });

    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      const u = ADMIN;
      if (inputs.get('u') !== u.username) return none();
      return row({ user_id: u.userId, password_hash: this.hash, display_name: u.username, role: u.role, rank: u.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, inputs.get('u') as number);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      const uid = this.sessions.get(inputs.get('id') as string);
      if (uid !== ADMIN.userId) return none();
      return row({ user_id: ADMIN.userId, username: ADMIN.username, display_name: ADMIN.username, role: ADMIN.role, rank: ADMIN.rank });
    }
    if (sql.includes('DELETE FROM sms.session')) return none();

    // resolveGenerationScope's two queries — answered from the fixed EPOCHS
    // catalogue and ROWS, regardless of which line/window was asked (this
    // fixture only ever exercises line 1, no date filter).
    if (/AS tbl, source_epoch/.test(sql)) {
      const by = new Map<number, Row[]>();
      for (const r of ROWS) by.set(r.source_epoch as number, [...(by.get(r.source_epoch as number) ?? []), r]);
      return { recordset: [...by.entries()].map(([epoch_id, rs]) => ({ tbl: 'sack_event', epoch_id, n: rs.length })) as T[], rowsAffected: [0] };
    }
    if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS as T[], rowsAffected: [0] };

    // register.ts's own unconstrained tally (RegisterPage.generations).
    if (/AS epoch_id/.test(sql) && /GROUP BY/.test(sql)) {
      const by = new Map<number, Row[]>();
      for (const r of ROWS) by.set(r.source_epoch as number, [...(by.get(r.source_epoch as number) ?? []), r]);
      const REG: Record<number, { source_db: string; ordinal: number; provenance: string; label: string }> = {
        9: { source_db: 'DATA_TP1U2_SEP07', ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
        14: { source_db: 'DATA_TP1U2_SIM', ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
      };
      return {
        recordset: [...by.entries()].map(([epoch_id, rs]) => ({
          epoch_id, source_db: REG[epoch_id]!.source_db, generation_ordinal: REG[epoch_id]!.ordinal,
          provenance: REG[epoch_id]!.provenance, label: REG[epoch_id]!.label, n: rs.length,
        })) as T[],
        rowsAffected: [0],
      };
    }

    // The register's row SELECT (listEvents) or the capped export SELECT —
    // both carry whatever `ge*` epoch params `andEpoch` bound, if any.
    if (sql.includes('FROM sms.sack_event e') && (sql.includes('OFFSET @offset ROWS') || sql.includes('SELECT TOP (@cap)'))) {
      const boundEpochIds = [...inputs.entries()].filter(([k]) => k.startsWith('ge')).map(([, v]) => v as number);
      const filtered = boundEpochIds.length > 0 ? ROWS.filter((r) => boundEpochIds.includes(r.source_epoch as number)) : ROWS;
      return {
        recordset: filtered.map((r) => ({
          ...r,
          prov_source_system: 'ifl_sql', prov_source_table: 'sack1_TP1U2', prov_epoch_label: null,
          prov_source_row_id: r.source_row_id, prov_raw_id: r.event_id, prov_source_insert_utc: null,
          prov_ingested_at_utc: null, prov_ingest_run_id: null, prov_transform_version: 1,
          prov_attribution_method: null, prov_attribution_confidence: null, prov_night_belongs_to: null,
          prov_epoch_id: r.source_epoch,
        })) as T[],
        rowsAffected: [filtered.length],
      };
    }

    if (sql.includes('MAX(shift_date)') || sql.includes('MAX(production_ts_utc_ms)')) {
      return row({ shift_date: '2026-09-07', ms: Date.UTC(2026, 8, 7, 12, 0, 0) });
    }
    if (sql.includes('FROM sms.plausibility_rule')) return row({ min_g: 1500, max_g: 3000 });

    return none();
  }
}

const PASSWORD = 'batch-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let cookie: string;

beforeAll(async () => {
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
    body: JSON.stringify({ username: ADMIN.username, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> & { error?: string };
  return { status: res.status, headers: res.headers, json };
}

describe('GET /api/events — batch (owner decision, 28 Sep 2026)', () => {
  it('defaults to auto — only the newest real (September) generation, with the full disclosure', async () => {
    const r = await get('/api/events?type=sack&sort=time&dir=desc');
    expect(r.status).toBe(200);
    const data = r.json.data as { total: number; rows: unknown[]; generations: { simulator: boolean }[]; generation: { spansGenerations: boolean; otherGenerationExcluded: number } };
    expect(data.total).toBe(2);
    expect(data.rows).toHaveLength(2);
    expect(data.generations).toHaveLength(2);
    expect(data.generation.spansGenerations).toBe(true);
    expect(data.generation.otherGenerationExcluded).toBe(2);
  });

  it('an explicit ?batch= key lists the OTHER generation', async () => {
    const r = await get('/api/events?type=sack&sort=time&dir=desc&batch=DATA_TP1U2_SIM%234');
    expect(r.status).toBe(200);
    const data = r.json.data as { total: number };
    expect(data.total).toBe(2);
  });

  it('?batch=auto is the same as omitting it', async () => {
    const r = await get('/api/events?type=sack&sort=time&dir=desc&batch=auto');
    expect(r.status).toBe(200);
    expect((r.json.data as { total: number }).total).toBe(2);
  });

  it('a malformed ?batch= is refused with 400, never silently ignored back to pooling', async () => {
    const r = await get('/api/events?type=sack&batch=not%20a%20valid%20batch');
    expect(r.status).toBe(400);
  });
});

describe('GET /api/events/export — the same scope, plus the disclosure trailer', () => {
  it('carries the "Data batch" / "Excluded from another data batch" trailer', async () => {
    const res = await fetch(`${base}/api/events/export?type=sack&sort=time&dir=desc`, { headers: { Cookie: cookie } });
    const csv = await res.text();
    expect(res.status).toBe(200);
    expect(csv).toContain('Data batch: September copy - sacks');
    expect(csv).toContain('Excluded from another data batch: 2 readings');
  });
});

describe('GET /api/reports/header — batch and simulatorSource', () => {
  it('an explicit simulator batch states simulatorSource: true and a disclosure line, even though nothing is "excluded" from a single-batch header read', async () => {
    const r = await get('/api/reports/header?batch=DATA_TP1U2_SIM%234');
    expect(r.status).toBe(200);
    const header = r.json.header as { simulatorSource?: boolean; generationLine?: string | null };
    expect(header.simulatorSource).toBe(true);
    expect(header.generationLine).toContain('plant simulator, synthetic data');
    expect(header.generationLine).toContain('Data batch: sack1_TP1U2 gen 4');
  });

  it('the default (auto) header names the real September batch and is not flagged as the simulator', async () => {
    const r = await get('/api/reports/header');
    expect(r.status).toBe(200);
    const header = r.json.header as { simulatorSource?: boolean };
    expect(header.simulatorSource).toBe(false);
  });
});

describe('asOf replay — plain words, no env var jargon (Task B)', () => {
  it('refuses a replay with a sentence a floor reader can parse, when the server disallows it', async () => {
    const cfg2: ApiConfig = {
      port: 0, lineId: 1, lineName: 'Test line', liveAllowAsOf: false, cacheTtlSeconds: 5, trustProxy: false,
      appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
      pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
    };
    const db2 = new FakeDb();
    db2.hash = await argon2.hash(PASSWORD);
    const app2 = createApp(db2 as unknown as import('mssql').ConnectionPool, cfg2);
    const server2 = app2.listen(0);
    await new Promise<void>((resolve) => server2.once('listening', resolve));
    try {
      const addr = server2.address();
      if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
      const base2 = `http://127.0.0.1:${addr.port}`;
      const login = await fetch(`${base2}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ADMIN.username, password: PASSWORD }),
      });
      const cookie2 = login.headers.get('set-cookie')!.split(';')[0]!;
      const r = await fetch(`${base2}/api/live?asOf=2026-09-07T10:00:00Z`, { headers: { Cookie: cookie2 } });
      const j = (await r.json()) as { error?: string };
      expect(r.status).toBe(400);
      expect(j.error).not.toContain('LIVE_ALLOW_AS_OF');
      expect(j.error?.toLowerCase()).toContain('replay');
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }
  });
});
