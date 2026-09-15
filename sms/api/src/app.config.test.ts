/**
 * Roadmap Phase 1 ("Configurable platform", 14 Sep 2026) — the configuration
 * routes against the REAL createApp, the same way app.routes.test.ts works:
 * a hand-rolled fake pool that records every statement, Node's fetch, real
 * argon2 sessions. This fake is STATEFUL where the contract needs it (a
 * machine added shows up in the next list; a station cannot be created
 * twice), and it can be told to fail the audit INSERT so the transactional
 * guarantee is provable rather than asserted.
 *
 * What each block pins:
 *  - GET /api/config answers the documented shape, machineName joined;
 *  - POST /api/admin/machines with a number creates its station, and the
 *    same number twice is 409 — the roadmap's "adding a second machine does
 *    not require source-code modification", as a test;
 *  - PUT /api/admin/sources/tables/:id returns the exact note and refuses a
 *    table name that is not a plain identifier;
 *  - POST /api/admin/rules/shift refuses out-of-order starts and binds the
 *    accepted ones as parameters;
 *  - auditedWrite: when the audit row cannot be written, the change is rolled
 *    back and the route answers 500 — never a committed change with no record;
 *  - /api/live carries plantName / unitName from sms.line, not from parsing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from './app.js';
import { loadApiConfig, type ApiConfig } from './config.js';
import { invalidateLiveConfigCache } from './services/live.js';

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

/** Stands in for mssql.Transaction; records begin/commit/rollback in order. */
class FakeTransaction {
  constructor(private readonly db: FakeDb) {}
  async begin(): Promise<this> { this.db.txLog.push('begin'); return this; }
  async commit(): Promise<void> { this.db.txLog.push('commit'); }
  async rollback(): Promise<void> { this.db.txLog.push('rollback'); }
  request(): FakeRequest { return new FakeRequest(this.db); }
}

const ADMIN = { userId: 4, username: 'admin', role: 'admin', rank: 4 };
const MANAGER = { userId: 3, username: 'manager', role: 'manager', rank: 3 };

interface Machine { machine_id: number; machine_no: number | null; kind: string; make: string | null; model: string | null; name: string; is_active: boolean; notes: string | null }
interface Station { station_id: number; name: string | null; machine: string | null; description: string | null; machine_id: number | null; link_source: string | null; is_active: boolean }

class FakeDb {
  statements: Stmt[] = [];
  txLog: string[] = [];
  hash = '';
  sessions = new Map<string, number>();
  /** When set, the audit INSERT throws — the "audit row fails" case. */
  failAudit = false;

  // The seed migration 028 leaves on line 1, trimmed to what the tests read.
  line = { line_id: 1, line_code: 'L3', line_name: 'Line 3', display_name: 'TP1 · Line 3 · Unit 2', is_active: true, unit_id: 1, unit_code: 'U2', unit_name: 'Unit 2', plant_id: 1, plant_code: 'TP1', plant_name: 'TP1' };
  machines: Machine[] = [
    { machine_id: 1, machine_no: 1, kind: 'winder', make: 'Rieter', model: null, name: 'Winder 1', is_active: true, notes: null },
    { machine_id: 2, machine_no: 2, kind: 'winder', make: 'Rieter', model: null, name: 'Winder 2', is_active: true, notes: null },
    { machine_id: 15, machine_no: null, kind: 'packer', make: 'Neuenhauser', model: null, name: 'Sack packer', is_active: true, notes: null },
  ];
  stations: Station[] = [
    { station_id: 1, name: null, machine: null, description: null, machine_id: 1, link_source: 'default_by_number', is_active: true },
    { station_id: 2, name: 'East', machine: null, description: null, machine_id: 2, link_source: 'default_by_number', is_active: true },
  ];
  sourceTables = [
    { source_table_id: 1, kind: 'cone', source_table: 'pack1_TP1U2', raw_table: 'sms_raw.cone_raw', is_enabled: true, data_source_id: 1 },
    { source_table_id: 2, kind: 'sack', source_table: 'sack1_TP1U2', raw_table: 'sms_raw.sack_raw', is_enabled: true, data_source_id: 1 },
  ];
  dataSources = [
    { data_source_id: 1, system_code: 'ifl_sql', role: 'acquisition', label: 'IFL weighing acquisition (DATA_TP1U2)', connection_key: 'IFL_DB', is_enabled: true, notes: null },
  ];
  rejectCodes = FakeDb.seedRejectCodes();
  static seedRejectCodes() {
    return [{ reject_code_id: 12, reject_type: 'quality', tube_code: 2, material_code: 0, label: 'old name' as string | null, is_pass: true as boolean | null, severity: null as string | null }];
  }
  private nextMachineId = 100;

  request(): FakeRequest { return new FakeRequest(this); }
  transaction(): FakeTransaction { return new FakeTransaction(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });
    const row = (r: Record<string, unknown>) => rows([r]);
    const none = () => ({ recordset: [] as T[], rowsAffected: [0] });
    const affected = (n: number) => ({ recordset: [] as T[], rowsAffected: [n] });

    // ---- auth ----
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

    // ---- audit ----
    if (sql.includes('INSERT INTO sms.audit_log')) {
      if (this.failAudit) throw Object.assign(new Error('audit_log is unavailable'), { number: 9002 });
      return affected(1);
    }

    // ---- line / unit / plant ----
    if (sql.includes('FROM sms.line l') && sql.includes('JOIN sms.plant_unit u')) return row({ ...this.line });
    if (sql.includes('SELECT line_id, display_name, is_active FROM sms.line')) {
      return row({ line_id: 1, display_name: this.line.display_name, is_active: true });
    }
    if (sql.includes('UPDATE sms.line SET')) {
      this.line.line_name = inputs.get('n') as string;
      this.line.display_name = inputs.get('d') as string;
      return affected(1);
    }
    if (sql.includes('UPDATE sms.plant_unit SET')) { this.line.unit_name = inputs.get('n') as string; return affected(1); }
    if (sql.includes('UPDATE sms.plant SET')) { this.line.plant_name = inputs.get('n') as string; return affected(1); }

    // ---- machines ----
    if (sql.includes('SELECT COUNT(*) AS n FROM sms.machine WHERE line_id = @line AND machine_no = @no')) {
      return row({ n: this.machines.filter((m) => m.machine_no === inputs.get('no')).length });
    }
    if (sql.includes('COUNT(*) n FROM sms.machine WHERE line_id=@line AND machine_id=@id') ||
        sql.includes('SELECT COUNT(*) AS n FROM sms.machine WHERE line_id = @line AND machine_id = @id')) {
      return row({ n: this.machines.filter((m) => m.machine_id === inputs.get('id')).length });
    }
    if (sql.includes('INSERT INTO sms.machine')) {
      const m: Machine = {
        machine_id: this.nextMachineId++, machine_no: inputs.get('no') as number | null, kind: inputs.get('kind') as string,
        make: inputs.get('make') as string | null, model: inputs.get('model') as string | null, name: inputs.get('name') as string,
        is_active: true, notes: inputs.get('notes') as string | null,
      };
      this.machines.push(m);
      return row({ id: m.machine_id });
    }
    if (sql.includes('FROM sms.machine WHERE line_id = @line AND machine_id = @id')) {
      return rows(this.machines.filter((m) => m.machine_id === inputs.get('id')).map((m) => ({ ...m })));
    }
    if (sql.includes('FROM sms.machine WHERE line_id = @line')) return rows(this.machines.map((m) => ({ ...m })));
    if (sql.includes('UPDATE sms.machine SET')) {
      const m = this.machines.find((x) => x.machine_id === inputs.get('id'));
      if (!m) return affected(0);
      m.name = inputs.get('name') as string; m.make = inputs.get('make') as string | null; m.model = inputs.get('model') as string | null;
      m.notes = inputs.get('notes') as string | null; m.is_active = inputs.get('active') as boolean;
      return affected(1);
    }

    // ---- stations ----
    if (sql.includes('INSERT INTO sms.station')) {
      const id = inputs.get('no') ?? inputs.get('id');
      if (this.stations.some((s) => s.station_id === id)) return affected(0);
      this.stations.push({
        station_id: id as number, name: (inputs.get('name') as string | null) ?? null, machine: null, description: null,
        machine_id: (inputs.get('mid') as number | null) ?? null,
        link_source: inputs.has('link') ? (inputs.get('link') as string | null) : 'admin', is_active: true,
      });
      return affected(1);
    }
    if (sql.includes('FROM sms.station s') && sql.includes('LEFT JOIN sms.machine m')) {
      return rows(this.stations.map((s) => {
        const m = this.machines.find((x) => x.machine_id === s.machine_id);
        return { ...s, machine_no: m?.machine_no ?? null, machine_name: m?.name ?? null };
      }));
    }
    if (sql.includes('UPDATE sms.station')) {
      const s = this.stations.find((x) => x.station_id === inputs.get('id'));
      if (!s) return none();
      const out = { old_name: s.name, old_machine_id: s.machine_id, old_is_active: s.is_active };
      s.name = inputs.get('n') as string | null;
      if (inputs.get('setLink')) { s.machine_id = inputs.get('mid') as number | null; s.link_source = 'admin'; }
      if (inputs.get('setActive')) s.is_active = inputs.get('active') as boolean;
      return row(out);
    }

    // ---- sources ----
    if (sql.includes('FROM sms.data_source ORDER BY')) return rows(this.dataSources.map((d) => ({ ...d })));
    if (sql.includes('FROM sms.data_source WHERE data_source_id = @id')) {
      return rows(this.dataSources.filter((d) => d.data_source_id === inputs.get('id')).map((d) => ({ ...d })));
    }
    if (sql.includes('FROM sms.source_table WHERE line_id = @line AND source_table_id = @id')) {
      return rows(this.sourceTables.filter((t) => t.source_table_id === inputs.get('id')).map((t) => ({ ...t })));
    }
    if (sql.includes('FROM sms.source_table WHERE line_id = @line')) return rows(this.sourceTables.map((t) => ({ ...t })));
    if (sql.includes('UPDATE sms.source_table SET')) {
      const t = this.sourceTables.find((x) => x.source_table_id === inputs.get('id'));
      if (!t) return affected(0);
      t.source_table = inputs.get('t') as string; t.is_enabled = inputs.get('enabled') as boolean;
      return affected(1);
    }

    // ---- reject codes ----
    if (sql.includes('FROM sms.reject_code WHERE line_id = @line')) return rows(this.rejectCodes.map((c) => ({ ...c })));
    if (sql.includes('UPDATE sms.reject_code')) {
      const c = this.rejectCodes.find((x) => x.reject_code_id === inputs.get('id'));
      if (!c) return none();
      const out = { old_label: c.label, old_is_pass: c.is_pass, old_severity: c.severity };
      if (inputs.get('setLabel')) c.label = inputs.get('label') as string | null;
      if (inputs.get('setPass')) c.is_pass = inputs.get('pass') as boolean;
      if (inputs.get('setSeverity')) c.severity = inputs.get('severity') as string | null;
      return row(out);
    }

    // ---- shift rule (as /api/live and getRules read it back) ----
    if (sql.includes('FROM sms.shift_rule WHERE line_id = @line ORDER BY effective_from DESC')) {
      return row({ ms: '06:00', es: '14:00', ns: '22:00', night_belongs_to: 'start_day' });
    }
    if (sql.includes('INSERT INTO sms.shift_rule')) return affected(1);

    if (/\bOUTPUT\b/i.test(sql)) return row({ id: 1, old_label: null, old_is_pass: null, old_active: true, old_role: 1, old_name: null });
    return none();
  }
}

const PASSWORD = 'config-test-password-not-real';
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
    // The env fallback — must NOT be what /api/live prints once sms.line exists.
    lineName: 'ENV FALLBACK NAME',
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
  db.failAudit = false;
  // The fake does not undo state on rollback; the one row the failure tests
  // touch is re-seeded so their UPDATE cannot leak into the list assertions.
  db.rejectCodes = FakeDb.seedRejectCodes();
  invalidateLiveConfigCache();
});

async function call(role: 'admin' | 'manager', method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookies[role]!, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field
  const json: any = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

const stmt = (needle: string) => db.statements.find((s) => s.sql.includes(needle));
const audits = () => db.statements.filter((s) => s.sql.includes('INSERT INTO sms.audit_log'));

describe('GET /api/config — the installation as configured', () => {
  it('answers the contract shape, with each station\'s machine joined by name', async () => {
    const r = await call('manager', 'GET', '/api/config');
    expect(r.status).toBe(200);
    expect(r.json.line).toEqual({
      lineId: 1, code: 'L3', name: 'Line 3', displayName: 'TP1 · Line 3 · Unit 2', isActive: true,
      unit: { unitId: 1, code: 'U2', name: 'Unit 2' },
      plant: { plantId: 1, code: 'TP1', name: 'TP1' },
    });
    expect(r.json.lines).toEqual([{ lineId: 1, displayName: 'TP1 · Line 3 · Unit 2', isActive: true }]);
    expect(r.json.machines[0]).toEqual({ machineId: 1, machineNo: 1, kind: 'winder', make: 'Rieter', model: null, name: 'Winder 1', isActive: true, notes: null });
    // The packer: no number, no station.
    expect(r.json.machines.find((m: { kind: string }) => m.kind === 'packer')).toMatchObject({ machineNo: null, name: 'Sack packer' });
    expect(r.json.stations[1]).toEqual({
      stationId: 2, name: 'East', description: null, machineId: 2, machineNo: 2, machineName: 'Winder 2', linkSource: 'default_by_number', isActive: true,
    });
    expect(Object.keys(r.json).sort()).toEqual(['line', 'lines', 'machines', 'stations']);
  });
});

describe('GET /api/live — the line is named from sms.line, not from .env or a parse on "·"', () => {
  it('lines[0] carries lineName = display_name plus plantName and unitName', async () => {
    const r = await call('manager', 'GET', '/api/live');
    expect(r.status).toBe(200);
    const line = r.json.data.lines[0];
    expect(line.lineName).toBe('TP1 · Line 3 · Unit 2');
    expect(line.plantName).toBe('TP1');
    expect(line.unitName).toBe('Unit 2');
  });

  it('a rename through PUT /api/admin/line shows on the next poll (cache invalidated), and is audited old -> new', async () => {
    const put = await call('admin', 'PUT', '/api/admin/line', { displayName: 'TP1 · Line 3', unitName: 'Unit 2' });
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ ok: true });
    const a = audits()[0]!;
    expect(a.inputs.get('action')).toBe('line.rename');
    expect(a.inputs.get('type')).toBe('line');
    expect(a.inputs.get('target')).toBe('1');
    // unitName was sent unchanged, so it is not claimed as a change.
    expect(a.inputs.get('detail')).toBe('displayName "TP1 · Line 3 · Unit 2" -> "TP1 · Line 3"');
    expect(db.txLog).toEqual(['begin', 'commit']);

    const live = await call('manager', 'GET', '/api/live');
    expect(live.json.data.lines[0].lineName).toBe('TP1 · Line 3');
    // put it back for the other tests
    await call('admin', 'PUT', '/api/admin/line', { displayName: 'TP1 · Line 3 · Unit 2' });
  });

  it('PUT /api/admin/line with nothing to change is 400 and writes nothing', async () => {
    expect((await call('admin', 'PUT', '/api/admin/line', {})).status).toBe(400);
    expect((await call('admin', 'PUT', '/api/admin/line', { displayName: '' })).status).toBe(400);
    expect(db.txLog).toEqual([]);
  });
});

describe('POST /api/admin/machines — adding a machine is configuration, not code', () => {
  it('a winder with machine number 15 gets a station 15 linked to it (stationCreated: true)', async () => {
    const r = await call('admin', 'POST', '/api/admin/machines', { machineNo: 15, kind: 'winder', name: 'Winder 15', make: 'Rieter' });
    expect(r.status).toBe(201);
    expect(r.json.stationCreated).toBe(true);
    expect(typeof r.json.machineId).toBe('number');
    const st = stmt('INSERT INTO sms.station')!;
    expect(st.inputs.get('no')).toBe(15);
    expect(st.inputs.get('mid')).toBe(r.json.machineId);
    expect(st.sql).toContain("'admin'");
    const a = audits()[0]!;
    expect(a.inputs.get('action')).toBe('machine.create');
    expect(a.inputs.get('target')).toBe(String(r.json.machineId));
    expect(a.inputs.get('detail')).toContain('station 15 created and linked');
    expect(db.txLog).toEqual(['begin', 'commit']);

    // And it is in the next listing, with its station joined.
    const cfg = await call('manager', 'GET', '/api/config');
    expect(cfg.json.machines.some((m: { machineNo: number | null }) => m.machineNo === 15)).toBe(true);
    expect(cfg.json.stations.find((s: { stationId: number }) => s.stationId === 15)).toMatchObject({ machineName: 'Winder 15', linkSource: 'admin' });
  });

  it('the same number again is 409 with the contract message, and nothing is written or audited', async () => {
    const r = await call('admin', 'POST', '/api/admin/machines', { machineNo: 15, kind: 'winder', name: 'Another 15' });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'machine number 15 already exists on this line' });
    expect(stmt('INSERT INTO sms.machine')).toBeUndefined();
    expect(audits()).toEqual([]);
    expect(db.txLog).toEqual(['begin', 'rollback']);
  });

  it('a packer has no number and gets no station', async () => {
    const r = await call('admin', 'POST', '/api/admin/machines', { machineNo: null, kind: 'packer', name: 'Second packer' });
    expect(r.status).toBe(201);
    expect(r.json.stationCreated).toBe(false);
    expect(stmt('INSERT INTO sms.station')).toBeUndefined();
  });

  it('a machine whose station already exists does not create or re-link it (Q3 is open)', async () => {
    const r = await call('admin', 'POST', '/api/admin/machines', { machineNo: 2, kind: 'other', name: 'Rewinder 2' });
    // number 2 is taken by Winder 2 → 409; use a number whose station exists but whose machine does not
    expect(r.status).toBe(409);
    db.stations.push({ station_id: 40, name: null, machine: null, description: null, machine_id: null, link_source: null, is_active: true });
    const r2 = await call('admin', 'POST', '/api/admin/machines', { machineNo: 40, kind: 'other', name: 'Rewinder 40' });
    expect(r2.status).toBe(201);
    expect(r2.json.stationCreated).toBe(false);
    expect(db.stations.find((s) => s.station_id === 40)!.machine_id).toBeNull();
  });

  it('refuses a non-boolean isActive and an unknown kind', async () => {
    expect((await call('admin', 'POST', '/api/admin/machines', { machineNo: 16, kind: 'robot', name: 'x' })).status).toBe(400);
    expect((await call('admin', 'PUT', '/api/admin/machines/1', { isActive: 'false' })).status).toBe(400);
  });

  it('PUT /api/admin/machines/:id changes only the fields sent, audits old -> new per field, 404 off this line', async () => {
    const r = await call('admin', 'PUT', '/api/admin/machines/1', { name: 'Winder 1 (rebuilt)', isActive: false });
    expect(r.status).toBe(200);
    const u = stmt('UPDATE sms.machine SET')!;
    expect(u.inputs.get('name')).toBe('Winder 1 (rebuilt)');
    expect(u.inputs.get('make')).toBe('Rieter'); // untouched
    expect(u.inputs.get('active')).toBe(false);
    expect(audits()[0]!.inputs.get('detail')).toBe('name "Winder 1" -> "Winder 1 (rebuilt)"; isActive true -> false');
    expect((await call('admin', 'PUT', '/api/admin/machines/999', { name: 'x' })).status).toBe(404);
  });
});

describe('stations — create, and link to a machine', () => {
  it('POST /api/admin/stations creates 30 linked to machine 1; twice is 409; an unknown machine is 400', async () => {
    const r = await call('admin', 'POST', '/api/admin/stations', { stationId: 30, name: 'Rewind', machineId: 1 });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ ok: true });
    expect(audits()[0]!.inputs.get('action')).toBe('station.create');
    expect((await call('admin', 'POST', '/api/admin/stations', { stationId: 30 })).status).toBe(409);
    expect((await call('admin', 'POST', '/api/admin/stations', { stationId: 31, machineId: 999 })).status).toBe(400);
  });

  it('PUT /api/admin/stations/:id with machineId re-links and writes station.rename AND station.link in one transaction', async () => {
    const r = await call('admin', 'PUT', '/api/admin/stations/2', { name: 'East', machine: null, description: null, machineId: 1, isActive: true });
    expect(r.status).toBe(200);
    const u = stmt('UPDATE sms.station')!;
    expect(u.inputs.get('setLink')).toBe(true);
    expect(u.inputs.get('mid')).toBe(1);
    expect(u.sql).toContain("link_source = CASE WHEN @setLink = 1 THEN 'admin'");
    expect(audits().map((a) => a.inputs.get('action'))).toEqual(['station.link', 'station.rename']);
    expect(audits()[0]!.inputs.get('detail')).toBe('machine_id 2 -> 1');
    expect(db.txLog).toEqual(['begin', 'commit']);
  });

  it('PUT without machineId leaves the link alone (setLink = false) and writes only station.rename', async () => {
    await call('admin', 'PUT', '/api/admin/stations/2', { name: 'East end', machine: null, description: null });
    expect(stmt('UPDATE sms.station')!.inputs.get('setLink')).toBe(false);
    expect(audits().map((a) => a.inputs.get('action'))).toEqual(['station.rename']);
  });

  it('PUT on a station that is not this line\'s is 404 with no audit row (the Aug 2026 phantom)', async () => {
    expect((await call('admin', 'PUT', '/api/admin/stations/999', { name: 'x', machine: null, description: null })).status).toBe(404);
    expect(audits()).toEqual([]);
    expect(db.txLog).toEqual(['begin', 'rollback']);
  });
});

describe('PUT /api/admin/sources/tables/:id — the worker reads the table name from here', () => {
  it('returns the exact note and audits kind + old -> new', async () => {
    const r = await call('admin', 'PUT', '/api/admin/sources/tables/1', { sourceTable: 'pack1_TP1U3' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      ok: true,
      note: "Applies on the sync worker's next pass. A different table is a different source generation: the worker will halt on it until `sms epoch:accept` registers it.",
    });
    const u = stmt('UPDATE sms.source_table SET')!;
    expect(u.inputs.get('t')).toBe('pack1_TP1U3');
    expect(u.inputs.get('enabled')).toBe(true);
    expect(audits()[0]!.inputs.get('action')).toBe('source_table.update');
    expect(audits()[0]!.inputs.get('detail')).toBe('cone: sourceTable "pack1_TP1U2" -> "pack1_TP1U3"');
  });

  it('refuses a name that is not a plain identifier, before any statement runs', async () => {
    const r = await call('admin', 'PUT', '/api/admin/sources/tables/1', { sourceTable: 'pack1; DROP TABLE x' });
    expect(r.status).toBe(400);
    expect(stmt('UPDATE sms.source_table')).toBeUndefined();
    expect(db.txLog).toEqual([]);
    expect((await call('admin', 'PUT', '/api/admin/sources/tables/1', { sourceTable: '[pack1]' })).status).toBe(400);
    expect((await call('admin', 'PUT', '/api/admin/sources/tables/1', { sourceTable: 'dbo.pack1' })).status).toBe(400);
  });

  it('a table that is not this line\'s is 404', async () => {
    expect((await call('admin', 'PUT', '/api/admin/sources/tables/77', { isEnabled: false })).status).toBe(404);
  });

  it('GET /api/admin/sources lists sources and the line\'s tables in the contract shape', async () => {
    const r = await call('admin', 'GET', '/api/admin/sources');
    expect(r.status).toBe(200);
    expect(r.json.sources[0]).toEqual({
      dataSourceId: 1, systemCode: 'ifl_sql', role: 'acquisition', label: 'IFL weighing acquisition (DATA_TP1U2)', connectionKey: 'IFL_DB', isEnabled: true, notes: null,
    });
    expect(r.json.tables[1]).toEqual({ sourceTableId: 2, kind: 'sack', sourceTable: 'sack1_TP1U2', rawTable: 'sms_raw.sack_raw', isEnabled: true, dataSourceId: 1 });
  });

  it('PUT /api/admin/sources/:id refuses a coerced boolean and audits a real one', async () => {
    expect((await call('admin', 'PUT', '/api/admin/sources/1', { isEnabled: 'false' })).status).toBe(400);
    const r = await call('admin', 'PUT', '/api/admin/sources/1', { isEnabled: false, notes: 'paused for the cutover' });
    expect(r.status).toBe(200);
    expect(audits()[0]!.inputs.get('action')).toBe('data_source.update');
    expect(audits()[0]!.inputs.get('detail')).toBe('isEnabled true -> false; notes (none) -> "paused for the cutover"');
  });
});

describe('POST /api/admin/rules/shift — the boundaries are a rule', () => {
  it("refuses '14:00','06:00','22:00' (out of order) with a detail, before any INSERT", async () => {
    const r = await call('admin', 'POST', '/api/admin/rules/shift', {
      morningStart: '14:00', eveningStart: '06:00', nightStart: '22:00', mode: 'corrected', nightBelongsTo: 'start_day',
    });
    expect(r.status).toBe(400);
    expect(typeof r.json.detail).toBe('string');
    expect(r.json.detail).toMatch(/strictly increasing/);
    expect(stmt('INSERT INTO sms.shift_rule')).toBeUndefined();
    expect(db.txLog).toEqual([]);
  });

  it("accepts '05:30','13:30','21:30' and the INSERT receives exactly those", async () => {
    const r = await call('admin', 'POST', '/api/admin/rules/shift', {
      morningStart: '05:30', eveningStart: '13:30', nightStart: '21:30', mode: 'corrected', nightBelongsTo: 'start_day', reason: 'IFL moved the shift change',
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, rebuildRequired: true });
    expect(typeof r.json.note).toBe('string');
    const ins = stmt('INSERT INTO sms.shift_rule')!;
    expect(ins.inputs.get('ms')).toBe('05:30');
    expect(ins.inputs.get('es')).toBe('13:30');
    expect(ins.inputs.get('ns')).toBe('21:30');
    expect(ins.inputs.get('reason')).toBe('IFL moved the shift change');
    expect(ins.sql).not.toMatch(/'06:00'|'14:00'|'22:00'/);
    expect(audits()[0]!.inputs.get('detail')).toBe('starts 05:30/13:30/21:30, mode corrected, night belongs to start_day');
    expect(db.txLog).toEqual(['begin', 'commit']);
  });

  it('refuses a malformed time and a missing one', async () => {
    expect((await call('admin', 'POST', '/api/admin/rules/shift', { morningStart: '6:00', eveningStart: '14:00', nightStart: '22:00', mode: 'corrected', nightBelongsTo: 'start_day' })).status).toBe(400);
    expect((await call('admin', 'POST', '/api/admin/rules/shift', { mode: 'corrected', nightBelongsTo: 'start_day' })).status).toBe(400);
  });
});

describe('auditedWrite — the change and its audit row are one transaction', () => {
  it('when the audit INSERT fails, the rule INSERT is rolled back and the route answers 500', async () => {
    db.failAudit = true;
    const r = await call('admin', 'POST', '/api/admin/rules/weight', { basis: 'net', coneTubeWeightG: 62.5, sackTareKg: 0.35 });
    expect(r.status).toBe(500);
    // The work DID run on the transaction — and was then undone with it.
    expect(stmt('INSERT INTO sms.weight_rule')).toBeDefined();
    expect(db.txLog).toEqual(['begin', 'rollback']);
    expect(db.txLog).not.toContain('commit');
  });

  it('the same for a reject-code edit and a user update', async () => {
    db.failAudit = true;
    expect((await call('manager', 'PUT', '/api/reject-codes/12', { severity: 'ERROR' })).status).toBe(500);
    expect(db.txLog).toEqual(['begin', 'rollback']);
    db.txLog = [];
    expect((await call('admin', 'PATCH', '/api/admin/users/3', { active: false })).status).toBe(500);
    expect(db.txLog).toEqual(['begin', 'rollback']);
  });

  it('the statement order is: begin, the work, the audit INSERT, commit', async () => {
    const r = await call('admin', 'POST', '/api/admin/rules/plausibility', { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
    expect(r.status).toBe(200);
    const i = db.statements.findIndex((s) => s.sql.includes('INSERT INTO sms.plausibility_rule'));
    const j = db.statements.findIndex((s) => s.sql.includes('INSERT INTO sms.audit_log'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
    expect(db.txLog).toEqual(['begin', 'commit']);
  });
});

describe('reject codes — list, and per-field update with severity', () => {
  it('GET /api/reject-codes lists the line\'s codes in the contract shape', async () => {
    const r = await call('manager', 'GET', '/api/reject-codes');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      codes: [{ rejectCodeId: 12, rejectType: 'quality', tubeCode: 2, materialCode: 0, label: 'old name', isPass: true, severity: null }],
    });
  });

  it('severity alone changes severity alone, and the audit names it; an unknown level is 400', async () => {
    const r = await call('manager', 'PUT', '/api/reject-codes/12', { severity: 'WARNING' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ updated: 1 });
    const u = stmt('UPDATE sms.reject_code')!;
    expect(u.inputs.get('setLabel')).toBe(false);
    expect(u.inputs.get('setPass')).toBe(false);
    expect(u.inputs.get('setSeverity')).toBe(true);
    expect(u.inputs.get('severity')).toBe('WARNING');
    expect(u.inputs.get('line')).toBe(1);
    expect(audits()[0]!.inputs.get('action')).toBe('reject_code.update');
    expect(audits()[0]!.inputs.get('detail')).toBe('severity (none) -> WARNING');
    expect((await call('manager', 'PUT', '/api/reject-codes/12', { severity: 'FATAL' })).status).toBe(400);
    expect((await call('manager', 'PUT', '/api/reject-codes/12', {})).status).toBe(400);
  });
});

describe('loadApiConfig — the PDAS writer guards (finding H6, 15 Sep 2026 audit)', () => {
  // A minimal but complete env: every field loadApiConfig requires, plus a
  // writer config that would pass the pre-existing "fields present" check,
  // so each test only has to override what it is testing.
  const baseEnv = (overrides: Record<string, string | undefined> = {}) =>
    ({
      APP_DB_SERVER: '.\\SQLEXPRESS',
      APP_DB_PORT: '1433',
      APP_DB_NAME: 'sms',
      APP_DB_USER: 'sms_app',
      APP_DB_PASSWORD: 'x',
      APP_DB_ENCRYPT: 'true',
      APP_DB_TRUST_SERVER_CERTIFICATE: 'true',
      PDAS_WRITE_ENABLED: 'true',
      PDAS_WRITE_SERVER: 'TP1-PDAS\\PDAS',
      PDAS_WRITE_PORT: '1433',
      PDAS_WRITE_DATABASE: 'PDAS_TP1U2',
      PDAS_WRITE_USER: 'sms_pdas_writer',
      PDAS_WRITE_PASSWORD: 'x',
      // The sync worker's own read-only settings, which the two guards below
      // compare the writer against (sync-worker/src/config.ts).
      IFL_DB_NAME_PDAS: 'PDAS_TP1U2',
      IFL_DB_USER: 'sms_readonly',
      ...overrides,
    }) as unknown as NodeJS.ProcessEnv;

  it('a correctly-formed writer config (database matches the reader, login differs) is enabled', () => {
    const cfg = loadApiConfig(baseEnv());
    expect(cfg.pdasWrite.enabled).toBe(true);
    expect(cfg.pdasWrite.disabledReason).toBeNull();
    expect(cfg.pdasWrite.db).toMatchObject({ database: 'PDAS_TP1U2', user: 'sms_pdas_writer' });
  });

  it('writer database ≠ IFL_DB_NAME_PDAS is disabled, naming both keys', () => {
    const cfg = loadApiConfig(baseEnv({ PDAS_WRITE_DATABASE: 'DATA_TP1U2' }));
    expect(cfg.pdasWrite.enabled).toBe(false);
    expect(cfg.pdasWrite.db).toBeNull();
    expect(cfg.pdasWrite.disabledReason).toContain('PDAS_WRITE_DATABASE');
    expect(cfg.pdasWrite.disabledReason).toContain('IFL_DB_NAME_PDAS');
  });

  it('writer user = reader user (IFL_DB_USER) is disabled — the read-only login must never be the writer', () => {
    const cfg = loadApiConfig(baseEnv({ PDAS_WRITE_USER: 'sms_readonly' }));
    expect(cfg.pdasWrite.enabled).toBe(false);
    expect(cfg.pdasWrite.db).toBeNull();
    expect(cfg.pdasWrite.disabledReason).toContain('PDAS_WRITE_USER');
    expect(cfg.pdasWrite.disabledReason).toContain('IFL_DB_USER');
  });

  it('the offline-proof case: writer DB = reader DB = a local _SEP07 value is enabled, deliberately', () => {
    const cfg = loadApiConfig(
      baseEnv({ PDAS_WRITE_DATABASE: 'PDAS_TP1U2_SEP07', IFL_DB_NAME_PDAS: 'PDAS_TP1U2_SEP07' }),
    );
    expect(cfg.pdasWrite.enabled).toBe(true);
    expect(cfg.pdasWrite.disabledReason).toBeNull();
    expect(cfg.pdasWrite.db).toMatchObject({ database: 'PDAS_TP1U2_SEP07' });
  });
});
