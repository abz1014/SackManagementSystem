/**
 * C-043 / D-85 (2 Oct 2026): POST /api/admin/rules/plausibility used to answer
 * "applies immediately to every SPC/weight query". After C-018 every period
 * reader reads the rule AS OF the period's end (ruleAsOf.ts, RT24-04), so an
 * edit applies only to periods that end after it; earlier periods keep the
 * rule in force at their own end. Setup shows this note verbatim
 * (RulesBlock.tsx), so it must say that.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

const PASSWORD = 'rules-note-test-password-not-real';
const ADMIN = { user_id: 4, username: 'admin', display_name: 'admin', role: 'admin', rank: 4, active: true };

class FakeRequest {
  private inputs = new Map<string, unknown>();
  constructor(private readonly db: FakeDb) {}
  input(name: string, _t: unknown, v: unknown): this {
    this.inputs.set(name, v);
    return this;
  }
  async query(sql: string) {
    return this.db.handle(sql, this.inputs);
  }
}
class FakeTransaction {
  constructor(private readonly db: FakeDb) {}
  async begin() { return this; }
  async commit() {}
  async rollback() {}
  request() { return new FakeRequest(this.db); }
}
class FakeDb {
  hash = '';
  sessions = new Map<string, number>();
  request() { return new FakeRequest(this); }
  transaction() { return new FakeTransaction(this); }
  async handle(sql: string, inputs: Map<string, unknown>) {
    const row = (r: Record<string, unknown>) => ({ recordset: [r], rowsAffected: [1] });
    const none = () => ({ recordset: [] as Record<string, unknown>[], rowsAffected: [0] });
    if (sql.includes('SELECT 1 AS ok')) return row({ ok: 1 });
    if (sql.includes('FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id') && sql.includes('WHERE u.username = @u')) {
      return row({ ...ADMIN, password_hash: this.hash });
    }
    if (sql.includes('INSERT INTO sms.session')) {
      this.sessions.set(inputs.get('id') as string, ADMIN.user_id);
      return none();
    }
    if (sql.includes('FROM sms.session s') && sql.includes('JOIN sms.app_user u')) {
      return this.sessions.has(inputs.get('id') as string) ? row({ ...ADMIN, user_id: ADMIN.user_id }) : none();
    }
    return none();
  }
}

let server: Server;
let base: string;
let cookie = '';

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  const db = new FakeDb();
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
  server = createApp(db as unknown as import('mssql').ConnectionPool, cfg).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`fixture login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/admin/rules/plausibility — the note tells the truth about when an edit applies', () => {
  it('says an edit applies to periods ending after it, not to every query', async () => {
    const res = await fetch(`${base}/api/admin/rules/plausibility`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { note: string };
    expect(json.note).not.toMatch(/every SPC\/weight query/);
    expect(json.note).toMatch(/periods that end after/);
    expect(json.note).toMatch(/earlier periods keep/);
  });
});
