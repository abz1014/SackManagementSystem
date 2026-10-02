/**
 * C-120 — the register CSV export (`GET /api/events/export`) must start with a
 * UTF-8 BOM, exactly as the report CSVs do (CSV_BOM in services/reports/csv.ts),
 * or Excel on Windows misreads non-ASCII text. Same harness idiom as
 * app.register.batch.test.ts: real createApp, fake pool, real http.Server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

const ADMIN = { userId: 4, username: 'admin', role: 'admin', rank: 4 };
const EPOCHS = [{ epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' }];
const ROW = { line_id: 1, event_id: 1, sack_event_id: 1, source_row_id: 1, source_epoch: 9, weight_kg: 49.1, in_range: true };

class FakeDb {
  hash = '';
  sessions = new Map<string, number>();
  request() {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (n: string, _t: unknown, v: unknown) => { inputs.set(n, v); return req; },
      query: async (sql: string) => this.handle(sql, inputs),
    };
    return req;
  }
  async handle(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: unknown[]; rowsAffected: number[] }> {
    const row = (r: unknown) => ({ recordset: [r], rowsAffected: [1] });
    const none = () => ({ recordset: [] as unknown[], rowsAffected: [0] });
    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      if (inputs.get('u') !== ADMIN.username) return none();
      return row({ user_id: ADMIN.userId, password_hash: this.hash, display_name: ADMIN.username, role: ADMIN.role, rank: ADMIN.rank, active: true });
    }
    if (sql.includes('INSERT INTO sms.session')) { this.sessions.set(inputs.get('id') as string, inputs.get('u') as number); return none(); }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      if (this.sessions.get(inputs.get('id') as string) !== ADMIN.userId) return none();
      return row({ user_id: ADMIN.userId, username: ADMIN.username, display_name: ADMIN.username, role: ADMIN.role, rank: ADMIN.rank });
    }
    if (/AS tbl, source_epoch/.test(sql)) return { recordset: [{ tbl: 'sack_event', epoch_id: 9, n: 1 }], rowsAffected: [0] };
    if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS, rowsAffected: [0] };
    if (sql.includes('FROM sms.sack_event e') && sql.includes('SELECT TOP (@cap)')) {
      return {
        recordset: [{ ...ROW, prov_source_system: 'ifl_sql', prov_source_table: 'sack1_TP1U2', prov_epoch_label: null, prov_epoch_id: 9 }],
        rowsAffected: [1],
      };
    }
    return none();
  }
}

let server: Server;
let base: string;
let cookie: string;

beforeAll(async () => {
  const db = new FakeDb();
  db.hash = await argon2.hash('bom-test-password-not-real');
  const cfg: ApiConfig = {
    port: 0, lineId: 1, lineName: 'Test line', liveAllowAsOf: true, cacheTtlSeconds: 5, trustProxy: false,
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
  };
  server = createApp(db as unknown as import('mssql').ConnectionPool, cfg).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.username, password: 'bom-test-password-not-real' }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('GET /api/events/export — UTF-8 BOM (C-120)', () => {
  it('the body starts with the three BOM bytes EF BB BF', async () => {
    const res = await fetch(`${base}/api/events/export?type=sack&sort=time&dir=desc`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});
