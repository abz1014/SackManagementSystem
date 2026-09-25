/**
 * RT24-03 follow-up (24 Sep 2026): `f60e04a` added the generation-disclosure
 * plumbing (`ReportHeader.spansGenerations`/`sourceGeneration`/
 * `otherGenerationExcluded`, `extractGenerationNote` in
 * `services/reports/header.ts`, the CSV trailing rows, the
 * `-partial-generation` filename marker and the XLSX header sheet row — all
 * pinned unit-level in `services/reports/generationDisclosure.test.ts`), but
 * `routes/reports.ts`'s own `headerFor` never passed the already-composed
 * report data through to `buildHeader` as `reportData`. `extractGenerationNote`
 * therefore always read `undefined` and every real export's header carried
 * `spansGenerations: false` regardless of what the report itself found —
 * the disclosure never reached a real response, only its own unit tests.
 *
 * This file drives the real route (real Express app, fake pool — same shape
 * as `reports.test.ts`) with the `daily` report's own builder
 * (`getDailyReport`) mocked to return a fixture whose `generationNote` says
 * the window spans two generations, and proves the disclosure now reaches
 * the CSV body, the CSV filename, and the XLSX header sheet — plus a second,
 * non-spanning fixture proving nothing changes when a report does not span
 * a generation boundary.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import { inflateRawSync } from 'node:zlib';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';
import type { DailyReportData } from '../services/reports/daily.js';

vi.mock('../services/reports/daily.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/reports/daily.js')>();
  return { ...actual, getDailyReport: vi.fn() };
});

import { getDailyReport } from '../services/reports/daily.js';

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
const ROLES: User[] = [{ userId: 3, username: 'manager', role: 'manager', rank: 3 }];

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
    return none();
  }
}

const PASSWORD = 'reports-generation-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let cookie: string;

const REPORT_LINE = {
  group: 'total', cones: 1000, rejectedCones: 20, rejectRatePct: 2, conesInRangePct: 98,
  sacks: 40, sackWeightKg: 1000, avgSackKg: 25, conesPerSack: 25,
};

function fixture(spans: boolean): DailyReportData {
  return {
    period: { period: 'custom', from: '2026-08-21', to: '2026-09-07' },
    shift: null,
    coverage: { daysInPeriod: 18, daysWithData: 18, firstDayWithData: '2026-08-21', lastDayWithData: '2026-09-07', complete: true },
    totals: REPORT_LINE,
    byShift: [],
    byDay: [],
    downtime: null,
    readings: null,
    shiftCheck: null,
    generationNote: spans
      ? { generation: { key: 'DATA_TP1U2_SEP07#2', ordinal: 2, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: 'DATA_TP1U2_SEP07#2', simulator: false }, spansGenerations: true, otherGenerationExcluded: 4321 }
      : { generation: { key: 'DATA_TP1U2_SEP07#2', ordinal: 2, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: null, simulator: false }, spansGenerations: false, otherGenerationExcluded: 0 },
    rejectPopulations: {
      byScale: 15, byScalePct: 1.5, atInspection: 20, atInspectionPct: 2, note: 'test fixture',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DailyReportData may carry fields this fixture does not model
  } as any;
}

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
  vi.mocked(getDailyReport).mockReset();
});

function readZipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const data = inflateRawSync(compressed);
    entries.push({ name, data });
    offset = dataStart + compSize;
  }
  return entries;
}

const Q = 'from=2026-08-21&to=2026-09-07';

describe('generation disclosure reaches real exports (RT24-03 route fix)', () => {
  it('a boundary-spanning report: CSV body carries the disclosure rows and the filename carries -partial-generation', async () => {
    vi.mocked(getDailyReport).mockResolvedValue(fixture(true));
    const res = await fetch(`${base}/api/reports/daily/export?${Q}&format=csv`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition).toContain('-partial-generation');
    expect(disposition).toMatch(/-partial-generation\.csv"$/);
    const text = await res.text();
    expect(text).toContain('Source generation: DATA_TP1U2_SEP07#2');
    expect(text).toContain('Excluded from other generation: 4321 readings');
  });

  it('a boundary-spanning report: the XLSX header sheet carries the disclosure row and the filename carries -partial-generation', async () => {
    vi.mocked(getDailyReport).mockResolvedValue(fixture(true));
    const res = await fetch(`${base}/api/reports/daily/export?${Q}&format=xlsx`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition).toContain('-partial-generation');
    expect(disposition).toMatch(/-partial-generation\.xlsx"$/);
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const sheetXml = entries.find((e) => /sheet1\.xml$/i.test(e.name));
    expect(sheetXml).toBeDefined();
    // The header/report sheet is always the first sheet built by
    // reportSheets/buildXlsx — its shared-strings-free inline text carries
    // the same disclosure wording `headerSheet` (xlsx.ts) writes.
    const allText = entries.filter((e) => e.name.endsWith('.xml')).map((e) => e.data.toString('utf8')).join('\n');
    expect(allText).toContain('Source generation: DATA_TP1U2_SEP07#2');
  });

  it('a boundary-spanning report: the JSON header also carries spansGenerations (the route\'s own primary path)', async () => {
    vi.mocked(getDailyReport).mockResolvedValue(fixture(true));
    const res = await fetch(`${base}/api/reports/daily?${Q}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only response shape
    const body = await res.json() as any;
    expect(body.data.header.spansGenerations).toBe(true);
    expect(body.data.header.sourceGeneration).toBe('DATA_TP1U2_SEP07#2');
    expect(body.data.header.otherGenerationExcluded).toEqual({ count: 4321, percent: null, simulator: 0 });
  });

  it('a non-spanning report: CSV, XLSX and JSON are all unaffected (no -partial-generation, no disclosure text)', async () => {
    vi.mocked(getDailyReport).mockResolvedValue(fixture(false));
    const csv = await fetch(`${base}/api/reports/daily/export?${Q}&format=csv`, { headers: { Cookie: cookie } });
    expect(csv.headers.get('content-disposition')).not.toContain('-partial-generation');
    const csvText = await csv.text();
    expect(csvText).not.toContain('Source generation');

    vi.mocked(getDailyReport).mockResolvedValue(fixture(false));
    const xlsx = await fetch(`${base}/api/reports/daily/export?${Q}&format=xlsx`, { headers: { Cookie: cookie } });
    expect(xlsx.headers.get('content-disposition')).not.toContain('-partial-generation');

    vi.mocked(getDailyReport).mockResolvedValue(fixture(false));
    const json = await fetch(`${base}/api/reports/daily?${Q}`, { headers: { Cookie: cookie } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only response shape
    const body = await json.json() as any;
    expect(body.data.header.spansGenerations).toBe(false);
    expect(body.data.header.sourceGeneration).toBeNull();
  });
});
