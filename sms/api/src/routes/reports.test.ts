/**
 * Roadmap Phase 8 (15 Sep 2026): the report routes over the REAL createApp
 * with a fake pool and four fixture accounts — the shape rejects.test.ts
 * and ops.test.ts use, kept in its own file because three phases add routes
 * in this wave and one shared RBAC file would collide.
 *
 * Pinned here:
 *  - the RBAC rows: every report type at rank 1, the management summary and
 *    every export at rank 3, the header at rank 1; unauthenticated 401;
 *  - the response shape (header + report inside the envelope);
 *  - a filter a report type cannot honour is refused with 400, not ignored;
 *  - an unknown type is 404; a bad range is 400;
 *  - the export answers text/csv with an attachment filename, the trailing
 *    attribution rows, and writes the `export.csv` audit row naming the
 *    report and its window;
 *  - `/api/report` (app.ts) binds `shift` through to the SQL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import argon2 from 'argon2';
import { createApp } from '../app.js';
import type { ApiConfig } from '../config.js';
import { REPORT_TYPES } from '../services/reports/common.js';
import { XLSX_CONTENT_TYPE } from '../services/reports/index.js';

// format=pdf never launches a real browser here — that would make this file
// need Edge on whatever machine runs `npx vitest run`, including CI. The two
// functions the route calls are mocked so the tests below can drive both of
// pdf.ts's own failure shapes (Edge missing → 503; the render itself failing
// → 502) without touching Puppeteer or Edge at all. Real Edge + real
// puppeteer-core + real generated PDFs are exercised separately, outside the
// vitest suite (see this change's own report for that run's output).
vi.mock('../services/reports/edge.js', () => ({ locateEdge: vi.fn() }));
vi.mock('../services/reports/pdf.js', () => ({ renderReportPdf: vi.fn() }));

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
    // the newest production day, for a period resolved against an anchor
    if (sql.includes('MAX(shift_date)')) return row({ d: '2026-09-07' });
    // An aggregate without GROUP BY answers ONE row on SQL Server even over
    // an empty table; weights.ts reads it as such. Return that row.
    if (/SELECT COUNT\(\*\) n, AVG\(/.test(sql)) return row({ n: 0, avg: null, mn: null, mx: null, sd: null, excluded: 0 });
    // the line's identity, for the header
    if (sql.includes('FROM sms.line l')) {
      return row({
        line_id: 1, line_code: 'L3', line_name: 'Line 3', display_name: 'TP1 · Line 3 · Unit 2', is_active: true,
        unit_id: 1, unit_code: 'U2', unit_name: 'Unit 2', plant_id: 1, plant_code: 'TP1', plant_name: 'TP1',
      });
    }
    return none();
  }
}

const PASSWORD = 'reports-test-password-not-real';
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
  for (const r of ROLES) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: r.username, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`fixture login failed for ${r.role}: ${res.status}`);
    cookies[r.role] = res.headers.get('set-cookie')!.split(';')[0]!;
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.statements = [];
});

async function get(path: string, role: string | null = 'manager') {
  const res = await fetch(`${base}${path}`, { headers: role ? { Cookie: cookies[role]! } : {} });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bodies are asserted field by field
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, json, text, headers: res.headers };
}

const Q = 'from=2026-09-01&to=2026-09-07';

/* -------------------------------------------------------------------- RBAC */

interface RouteCase { path: string; minRank: number }
const ROUTES: RouteCase[] = [
  { path: `/api/reports/header?${Q}`, minRank: 1 },
  ...REPORT_TYPES.filter((t) => t !== 'management-summary').map((t) => ({ path: `/api/reports/${t}?${Q}`, minRank: 1 })),
  { path: `/api/reports/management-summary?${Q}`, minRank: 3 },
  ...REPORT_TYPES.map((t) => ({ path: `/api/reports/${t}/export?${Q}`, minRank: 3 })),
];

describe('RBAC — every report route, all four roles, against the real app', () => {
  it.each(ROUTES)('GET $path (needs rank $minRank)', async (route) => {
    expect((await get(route.path, null)).status).toBe(401);
    for (const r of ROLES) {
      const { status } = await get(route.path, r.role);
      if (r.rank < route.minRank) {
        expect(status, `${r.role} should be refused ${route.path}`).toBe(403);
      } else {
        // 200, not merely "not 401/403": every report composes cleanly over
        // an empty database, which is what a fresh installation is.
        expect(status, `${r.role} should be answered on ${route.path}`).toBe(200);
      }
    }
  });
});

/**
 * The regression this wave closes: the manager-only gate on management-summary
 * used to be a literal route registered ahead of the generic `/api/reports/:type`
 * route, so it only fired when the path string matched exactly. A percent-encoded
 * hyphen (`%2D`) still decodes to `management-summary` by the time Express hands
 * `req.params.type` to the handler, missed the literal route, fell through to the
 * rank-1 generic route, and was served to a viewer. The gate now lives in `parse()`,
 * keyed off the decoded type, so no encoding of the same type string can bypass it.
 */
describe('the percent-encoding bypass on management-summary is closed', () => {
  it('GET /api/reports/management%2Dsummary as a viewer (rank 1) is refused, not served', async () => {
    const r = await get(`/api/reports/management%2Dsummary?${Q}`, 'viewer');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'insufficient role' });
  });

  it('GET /api/reports/management%2Dsummary signed out is 401, not 403 or 200', async () => {
    const r = await get(`/api/reports/management%2Dsummary?${Q}`, null);
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: 'authentication required' });
  });

  it('GET /api/reports/management%2Dsummary as a manager (rank 3) still serves the report', async () => {
    const r = await get(`/api/reports/management%2Dsummary?${Q}`, 'manager');
    expect(r.status).toBe(200);
    expect(r.json.data.header.reportType).toBe('management-summary');
  });
});

describe('every rank-1 report type is actually reachable at rank 1', () => {
  const rank1Types = REPORT_TYPES.filter((t) => t !== 'management-summary');
  it.each(rank1Types)('GET /api/reports/%s as viewer (rank 1) is not refused', async (t) => {
    const r = await get(`/api/reports/${t}?${Q}`, 'viewer');
    expect(r.status).not.toBe(403);
    expect(r.status).not.toBe(401);
    expect(r.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ shapes */

describe('GET /api/reports/:type', () => {
  it('answers the header and the report inside the envelope, stamped for the caller', async () => {
    const r = await get(`/api/reports/daily?${Q}`, 'viewer');
    expect(r.status).toBe(200);
    expect(r.json.metadata).toBeDefined();
    expect(r.json.data.header).toMatchObject({
      reportType: 'daily', title: 'Daily production report', lineName: 'TP1 · Line 3 · Unit 2', plantName: 'TP1',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 }, filters: {}, generatedBy: 'viewer',
      definitions: 'KPI-DEFINITIONS.md', approval: 'awaiting',
    });
    expect(r.json.data.report.rejectPopulations).toBeDefined();
    expect(r.json.data.report.coverage.daysWithData).toBe(0);
  });

  it('resolves a named period against the newest production day, like /api/report', async () => {
    const r = await get('/api/reports/reject?period=week');
    expect(r.status).toBe(200);
    expect(r.json.data.header.period).toMatchObject({ period: 'week', from: '2026-09-07', to: '2026-09-13' });
  });

  it('refuses a filter the report type cannot honour, and names what it accepts', async () => {
    const cw = await get(`/api/reports/cone-weight?${Q}&shift=night`);
    expect(cw.status).toBe(400);
    expect(cw.json.error).toMatch(/does not accept a shift filter/);
    const st = await get(`/api/reports/station?${Q}&product=21`);
    expect(st.status).toBe(400);
    const ok = await get(`/api/reports/reject?${Q}&shift=night&station=7&product=21`);
    expect(ok.status).toBe(200);
    expect(ok.json.data.header.filters).toEqual({ shift: 'night', station: 7, product: 21 });
    expect(db.statements.some((s) => s.inputs.get('shift') === 'night' && s.inputs.get('station') === 7 && s.inputs.get('product') === 21)).toBe(true);
  });

  it('management-summary carries the prior period of equal length and the KPI rows, each awaiting approval', async () => {
    const r = await get(`/api/reports/management-summary?${Q}`);
    expect(r.status).toBe(200);
    expect(r.json.data.report.prior).toEqual({ from: '2026-08-25', to: '2026-08-31' });
    expect(r.json.data.report.kpis.length).toBeGreaterThan(10);
    for (const k of r.json.data.report.kpis) expect(k.approval).toBe('awaiting');
  });

  it('404 on an unknown type, 400 on a bad range or a custom period without both ends', async () => {
    expect((await get(`/api/reports/oee?${Q}`)).status).toBe(404);
    expect((await get('/api/reports/daily?from=2026-09-07&to=2026-09-01')).status).toBe(400);
    expect((await get('/api/reports/daily?from=2025-01-01&to=2026-01-02')).status).toBe(400);
    expect((await get('/api/reports/daily?from=2026-09-01')).status).toBe(400);
    expect((await get(`/api/reports/daily?${Q}&shift=day`)).status).toBe(400);
  });
});

describe('GET /api/reports/header', () => {
  it('is the print header on its own, for the register', async () => {
    const r = await get(`/api/reports/header?${Q}`, 'viewer');
    expect(r.status).toBe(200);
    expect(r.json.header).toMatchObject({ reportType: 'register', title: 'Register', lineName: 'TP1 · Line 3 · Unit 2', generatedBy: 'viewer' });
    expect(typeof r.json.header.smsVersion).toBe('string');
  });
});

describe('GET /api/reports/:type/export', () => {
  it('answers CSV with an attachment filename, the trailing attribution, and audits export.csv naming the report and its window', async () => {
    const r = await get(`/api/reports/reject/export?${Q}&shift=night`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="sms-report-reject-2026-09-01_to_2026-09-07.csv"');
    const lines = r.text.split('\n');
    expect(lines[0]).toBe('section,day,reject_type,tube_code,material_code,label,count,pct,cumulative_pct,cones,inspected,rate_pct,ucl_pct,lcl_pct,out_of_control');
    expect(r.text).toContain('\n\nreport,Reject report\n');
    expect(r.text).toContain('\nfilters,shift=night\n');
    expect(r.text).toContain('\ngenerated_by,manager\n');
    expect(r.text).toContain('\nifl_approval,awaiting');
    // fire-and-forget audit: give the event loop one turn
    await new Promise((resolve) => setTimeout(resolve, 20));
    const audit = db.statements.find((s) => s.sql.includes('INSERT INTO sms.audit_log'))!;
    expect(audit).toBeDefined();
    expect([...audit.inputs.values()]).toEqual(expect.arrayContaining(['export.csv', 'report', 'reject', '2026-09-01 to 2026-09-07 (shift=night)']));
  });

  it('every type exports with its own column header', async () => {
    for (const t of REPORT_TYPES) {
      const r = await get(`/api/reports/${t}/export?${Q}`);
      expect(r.status, t).toBe(200);
      expect(r.text.split('\n')[0]!.length, t).toBeGreaterThan(0);
    }
  });

  it('no format param still answers CSV and still audits export.csv (no-regression pin)', async () => {
    const r = await get(`/api/reports/reject/export?${Q}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="sms-report-reject-2026-09-01_to_2026-09-07.csv"');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const auditRows = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.audit_log'));
    expect(auditRows.some((s) => [...s.inputs.values()].includes('export.csv'))).toBe(true);
    expect(auditRows.some((s) => [...s.inputs.values()].includes('export.xlsx'))).toBe(false);
  });

  describe('format=xlsx', () => {
    it('as rank 3 (manager) answers the workbook content type, an .xlsx filename, and exactly one export.xlsx audit row', async () => {
      const r = await get(`/api/reports/reject/export?${Q}&shift=night&format=xlsx`, 'manager');
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(new RegExp(`^${XLSX_CONTENT_TYPE.replace(/[.+]/g, '\\$&')}`));
      const disposition = r.headers.get('content-disposition')!;
      expect(disposition).toBe('attachment; filename="sms-report-reject-2026-09-01_to_2026-09-07.xlsx"');
      expect(disposition.endsWith('.xlsx"')).toBe(true);
      // The zip's local-file-header magic survives fetch's text() decoding for these leading ASCII/control bytes.
      expect(r.text.slice(0, 2)).toBe('PK');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const auditRows = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.audit_log'));
      const xlsxRows = auditRows.filter((s) => [...s.inputs.values()].includes('export.xlsx'));
      expect(xlsxRows.length).toBe(1);
      expect([...xlsxRows[0]!.inputs.values()]).toEqual(
        expect.arrayContaining(['export.xlsx', 'report', 'reject', '2026-09-01 to 2026-09-07 (shift=night)']),
      );
      expect(auditRows.some((s) => [...s.inputs.values()].includes('export.csv'))).toBe(false);
    });

    it('as rank 1 (viewer) is refused with 403, same as the CSV export', async () => {
      const r = await get(`/api/reports/reject/export?${Q}&format=xlsx`, 'viewer');
      expect(r.status).toBe(403);
    });

    it('an invalid format value is a 400, not silently treated as csv', async () => {
      const r = await get(`/api/reports/reject/export?${Q}&format=json`);
      expect(r.status).toBe(400);
    });
  });

  describe('format=pdf', () => {
    beforeEach(async () => {
      const { locateEdge } = await import('../services/reports/edge.js');
      const { renderReportPdf } = await import('../services/reports/pdf.js');
      vi.mocked(locateEdge).mockReset();
      vi.mocked(renderReportPdf).mockReset();
    });

    it('as rank 3 (manager), with Edge present, answers application/pdf, a .pdf filename, and exactly one export.pdf audit row naming the page count', async () => {
      const { locateEdge } = await import('../services/reports/edge.js');
      const { renderReportPdf } = await import('../services/reports/pdf.js');
      vi.mocked(locateEdge).mockReturnValue({ ok: true, path: 'C:\\fake\\msedge.exe', reason: null });
      const buffer = Buffer.from('%PDF-1.4 fake pdf body');
      vi.mocked(renderReportPdf).mockResolvedValue({ buffer, pageCount: 3 });

      const r = await get(`/api/reports/reject/export?${Q}&shift=night&format=pdf`, 'manager');
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/^application\/pdf/);
      expect(r.headers.get('content-disposition')).toBe('attachment; filename="sms-report-reject-2026-09-01_to_2026-09-07.pdf"');
      expect(r.text).toBe(buffer.toString());

      // renderReportPdf was actually asked for the type/period/filters this
      // request named, and for the caller who made it — not some default.
      const call = vi.mocked(renderReportPdf).mock.calls[0]![0];
      expect(call.type).toBe('reject');
      expect(call.resolved).toMatchObject({ from: '2026-09-01', to: '2026-09-07' });
      expect(call.filters).toMatchObject({ shift: 'night' });
      expect(call.user.role).toBe('manager');
      expect(call.edgePath).toBe('C:\\fake\\msedge.exe');
      expect(call.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      await new Promise((resolve) => setTimeout(resolve, 20));
      const auditRows = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.audit_log'));
      const pdfRows = auditRows.filter((s) => [...s.inputs.values()].includes('export.pdf'));
      expect(pdfRows.length).toBe(1);
      expect([...pdfRows[0]!.inputs.values()]).toEqual(
        expect.arrayContaining(['export.pdf', 'report', 'reject', '2026-09-01 to 2026-09-07 (shift=night) (3 pages)']),
      );
      expect(auditRows.some((s) => [...s.inputs.values()].includes('export.csv'))).toBe(false);
      expect(auditRows.some((s) => [...s.inputs.values()].includes('export.xlsx'))).toBe(false);
    });

    it('as rank 1 (viewer) is refused with 403 before Edge is ever probed, same as CSV/XLSX', async () => {
      const { locateEdge } = await import('../services/reports/edge.js');
      const r = await get(`/api/reports/reject/export?${Q}&format=pdf`, 'viewer');
      expect(r.status).toBe(403);
      expect(locateEdge).not.toHaveBeenCalled();
    });

    it('Edge missing on the host answers 503 with the named, actionable reason — not a 500, and never invokes the renderer', async () => {
      const { locateEdge } = await import('../services/reports/edge.js');
      const { renderReportPdf } = await import('../services/reports/pdf.js');
      vi.mocked(locateEdge).mockReturnValue({
        ok: false, path: null, reason: 'Microsoft Edge was not found in any known Windows install location.',
      });

      const r = await get(`/api/reports/reject/export?${Q}&format=pdf`, 'manager');
      expect(r.status).toBe(503);
      expect(r.json).toEqual({
        error: 'pdf export unavailable',
        detail: 'Microsoft Edge was not found in any known Windows install location.',
      });
      expect(renderReportPdf).not.toHaveBeenCalled();
    });

    it('a render that throws (timeout, crashed page, …) answers 502, distinct from the Edge-missing 503', async () => {
      const { locateEdge } = await import('../services/reports/edge.js');
      const { renderReportPdf } = await import('../services/reports/pdf.js');
      vi.mocked(locateEdge).mockReturnValue({ ok: true, path: 'C:\\fake\\msedge.exe', reason: null });
      vi.mocked(renderReportPdf).mockRejectedValue(new Error('waiting for selector `.print-head` failed: timeout 30000ms exceeded'));

      const r = await get(`/api/reports/reject/export?${Q}&format=pdf`, 'manager');
      expect(r.status).toBe(502);
      expect(r.json.error).toBe('pdf render failed');
      expect(r.json.detail).toMatch(/print-head/);
    });
  });
});

describe('GET /api/report gains shift (app.ts)', () => {
  it('binds shift_code = @shift on the production queries and drops downtime', async () => {
    const r = await get('/api/report?period=custom&from=2026-09-01&to=2026-09-07&shift=evening', 'viewer');
    expect(r.status).toBe(200);
    expect(r.json.data.shift).toBe('evening');
    expect(r.json.data.downtime).toBeNull();
    const prod = db.statements.filter((s) => s.sql.includes('FROM sms.cone_event') && s.sql.includes('shift_code = @shift'));
    expect(prod.length).toBeGreaterThan(0);
    for (const s of prod) expect(s.inputs.get('shift')).toBe('evening');
    expect(db.statements.some((s) => s.sql.includes('COUNT(DISTINCT shift_date)') && s.sql.includes('shift_code = @shift'))).toBe(true);
  });
  it('without a shift, downtime is computed and the shift is null', async () => {
    const r = await get('/api/report?period=custom&from=2026-09-01&to=2026-09-07', 'viewer');
    expect(r.status).toBe(200);
    expect(r.json.data.shift).toBeNull();
    expect(r.json.data.downtime).toEqual({ stoppageCount: 0, stoppedSeconds: 0, thresholdSeconds: 120 });
  });
});
