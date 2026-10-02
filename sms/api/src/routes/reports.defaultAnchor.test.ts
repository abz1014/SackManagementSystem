/**
 * C-136 part 2 (D-91): when sms.cone_event holds no real rows, a bare report
 * request anchors on "now". It used the SERVER's UTC calendar date; the right
 * answer is the plant production day of now.
 *
 * Derivation: plant = UTC+5, the production day starts 06:00 plant (default
 * shift rule, night belongs to the day it started), so production day =
 * calendar date of (UTC + 5 h - 6 h) = date of (UTC - 1 h). Red case: fake
 * clock 2026-09-03T00:30:00Z = plant 05:30 on 3 Sep, still the night shift of
 * 2 Sep, so the production day is 2026-09-02 (the UTC date, 2026-09-03, is
 * wrong). Controls: 2026-09-02T20:00:00Z (plant 01:00 on 3 Sep, night shift of
 * 2 Sep) -> 2026-09-02 and 2026-09-03T02:00:00Z (plant 07:00) -> 2026-09-03.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
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

// Real generation: epoch_id 1, ordinal 1, source_db DATA_TP1U2_SEP07 — its
// newest cone day is 2026-09-07. Simulator generation: epoch_id 2, ordinal
// 2 (newer), source_db DATA_TP1U2_SIM — its newest cone day is 2026-09-22,
// after the real generation's.

class FakeDb {
  statements: Stmt[] = [];
  hash = '';
  sessions = new Map<string, number>();

  request(): FakeRequest { return new FakeRequest(this); }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const row = (r: Record<string, unknown>) => ({ recordset: [r as T], rowsAffected: [1] });
    const rows = (rs: Record<string, unknown>[]) => ({ recordset: rs as T[], rowsAffected: [rs.length] });
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
    if (sql.includes('FROM sms.line l')) {
      return row({
        line_id: 1, line_code: 'L3', line_name: 'Line 3', display_name: 'TP1 · Line 3 · Unit 2', is_active: true,
        unit_id: 1, unit_code: 'U2', unit_name: 'Unit 2', plant_id: 1, plant_code: 'TP1', plant_name: 'TP1',
      });
    }
    // resolveGenerationScope's own "what's present" query — both
    // generations carry cone_event rows.
    if (sql.includes("AS tbl") && sql.includes('FROM sms.cone_event WHERE')) {
      return rows([
        { tbl: 'cone_event', epoch_id: 1, n: 500 },
        { tbl: 'cone_event', epoch_id: 2, n: 500 },
      ]);
    }
    // resolveGenerationScope's own epoch catalogue query.
    if (sql.includes('FROM sms.source_epoch WHERE line_id')) {
      return rows([
        { epoch_id: 1, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 1, provenance: 'ifl_copy', label: null },
        { epoch_id: 2, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 2, provenance: 'simulator', label: null },
      ]);
    }
    // newestProductionDay's own MAX(shift_date) query, now scoped by
    // source_epoch via epochFragment's own bound params (prefix 'ge',
    // cone_event's own letter 'c' — see generation.ts's epochFragment).
    if (sql.includes('MAX(shift_date)')) return row({ d: null });
    return none();
  }
}

const PASSWORD = 'reports-newest-day-test-password-not-real';
let server: Server;
let base: string;
let db: FakeDb;
let cookie: string;

function fixture(): DailyReportData {
  return {
    period: { period: 'custom', from: '2000-01-01', to: '2000-01-01' },
    shift: null,
    coverage: { daysInPeriod: 1, daysWithData: 1, firstDayWithData: '2000-01-01', lastDayWithData: '2000-01-01', complete: true },
    totals: { group: 'total', cones: 0, rejectedCones: 0, rejectRatePct: null, conesInRangePct: null, sacks: 0, sackWeightKg: 0, avgSackKg: null, conesPerSack: null },
    byShift: [],
    byDay: [],
    downtime: null,
    readings: null,
    shiftCheck: null,
    generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
    rejectPopulations: { byScale: 0, byScalePct: null, atInspection: 0, atInspectionPct: null, note: 'test fixture' },
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
  vi.mocked(getDailyReport).mockResolvedValue(fixture());
});

async function anchorFor(utcIso: string): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(utcIso));
  try {
    const res = await fetch(`${base}/api/reports/daily?period=day`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only response shape
    const b = await res.json() as any;
    return b.data.header.period.to as string;
  } finally {
    vi.useRealTimers();
  }
}

describe('newestProductionDay fallback uses the plant production day of now (C-136)', () => {
  it('00:30 UTC (plant 05:30, still the 2 Sep night shift) -> 2026-09-02, not the UTC date', async () => {
    expect(await anchorFor('2026-09-03T00:30:00Z')).toBe('2026-09-02');
  });
  it('control: 2026-09-02T20:00:00Z -> 2026-09-02', async () => {
    expect(await anchorFor('2026-09-02T20:00:00Z')).toBe('2026-09-02');
  });
  it('control: 2026-09-03T02:00:00Z -> 2026-09-03', async () => {
    expect(await anchorFor('2026-09-03T02:00:00Z')).toBe('2026-09-03');
  });
});
