/**
 * Routes added by roadmap Phase 8 (dashboards and reports, 15 Sep 2026) —
 * mounted from createApp after the shared auth gate, so every route here is
 * already behind "signed in"; requireRole raises the bar where the contract
 * says so.
 *
 *   GET /api/reports/header                  rank 1        the print header (line, plant time, who, version)
 *   GET /api/reports/:type                    REPORT_RANK[type]  one composed report (services/reports/*)
 *   GET /api/reports/:type/export            rank 3        the same report as one CSV, audited `export.csv`
 *
 * There is no per-type route: every type, including management-summary,
 * is served by the single parameterised handler. The gate lives in `parse()`,
 * which checks the caller's rank against `REPORT_RANK[type]` for EVERY type
 * before it does anything else — not in route registration order. A gate
 * that depends on Express reaching one literal route before the generic
 * `:type` route is defeated by any path encoding that still decodes to the
 * same type string (e.g. `management%2Dsummary`); checking the rank inside
 * the handler that already knows the decoded type closes that off by
 * construction.
 */
import type { NextFunction, Request, Response } from 'express';
import mssql from 'mssql';
import { z } from 'zod';
import { requireRole, type AuthedRequest } from '../auth.js';
import { TtlCache } from '../cache.js';
import { envelope } from '../envelope.js';
import { plantNowMs } from '../services/plantClock.js';
import { resolvePeriod, REPORT_PERIODS, type ReportPeriod, type ResolvedPeriod } from '../services/report.js';
import {
  buildHeader, buildReport, csvDocument, csvFilename, reportCsv,
  EXPORT_RANK, FILTERS_BY_TYPE, REPORT_RANK, isReportType,
  type AnyReportData, type ReportFilters, type ReportHeader, type ReportType,
} from '../services/reports/index.js';
import type { RouteContext } from './context.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional();
const isoTs = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
  .optional();

// Same cap as app.ts's analytics routes and the /api/report route.
const MAX_RANGE_DAYS = 366;
function rangeProblem(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

const reportQuery = z.object({
  period: z.enum(REPORT_PERIODS).default('custom'),
  anchor: dateStr,
  from: dateStr,
  to: dateStr,
  shift: z.enum(['morning', 'evening', 'night']).optional(),
  product: z.coerce.number().int().positive().optional(),
  station: z.coerce.number().int().positive().optional(),
  /** Replay: the plant instant the header is stamped with (honoured only when the server allows replays). */
  at: isoTs,
});
type ReportQuery = z.infer<typeof reportQuery>;

interface Parsed {
  type: ReportType;
  resolved: ResolvedPeriod;
  filters: ReportFilters;
  atMs: number | null;
}

export function mountReportsRoutes({ app, pool, cfg, audit }: RouteContext): void {
  const cache = new TtlCache<AnyReportData>(cfg.cacheTtlSeconds * 1000);

  /** The newest production day — the anchor a bare request resolves against (app.ts does the same). */
  async function newestProductionDay(): Promise<string> {
    const r = await pool
      .request()
      .input('line', mssql.Int, cfg.lineId)
      .query<{ d: string | null }>('SELECT CONVERT(varchar(10), MAX(shift_date), 120) AS d FROM sms.cone_event WHERE line_id=@line');
    return r.recordset[0]?.d ?? new Date().toISOString().slice(0, 10);
  }

  /**
   * Validate the type, the period and the filters. Answers the 400 itself
   * and returns null, so each handler is one line of composition.
   */
  async function parse(req: Request, res: Response, fixedType?: ReportType): Promise<Parsed | null> {
    const raw = fixedType ?? String(req.params.type ?? '');
    if (!isReportType(raw)) {
      res.status(404).json({ error: `unknown report type "${raw}"` });
      return null;
    }
    // The rank gate for EVERY report type, management-summary included. This
    // runs before any query validation or DB read, and it is keyed off the
    // already-decoded `raw` type — so `management%2Dsummary` is judged the
    // same as `management-summary`, unlike a route registered on the literal
    // path string. Same status codes and body shapes as requireRole so a
    // client sees one error shape regardless of which gate answered.
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'authentication required' });
      return null;
    }
    if (user.rank < REPORT_RANK[raw]) {
      res.status(403).json({ error: 'insufficient role' });
      return null;
    }
    const q = reportQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
      return null;
    }
    const resolved = await resolveQuery(q.data, res);
    if (!resolved) return null;
    const allowed = FILTERS_BY_TYPE[raw];
    const filters: ReportFilters = {};
    for (const name of ['shift', 'product', 'station'] as const) {
      const v = q.data[name];
      if (v == null) continue;
      if (!allowed.includes(name)) {
        res.status(400).json({
          error: `the ${raw} report does not accept a ${name} filter`,
          detail: allowed.length ? `it accepts: ${allowed.join(', ')}` : 'it accepts no filters',
        });
        return null;
      }
      (filters as Record<string, unknown>)[name] = v;
    }
    const atMs = q.data.at && cfg.liveAllowAsOf ? new Date(q.data.at).getTime() : null;
    return { type: raw, resolved, filters, atMs };
  }

  async function resolveQuery(q: ReportQuery, res: Response): Promise<ResolvedPeriod | null> {
    if (q.period === 'custom' && (!q.from || !q.to)) {
      res.status(400).json({ error: 'custom period requires from and to' });
      return null;
    }
    const anchor = q.anchor ?? (await newestProductionDay());
    const resolved = resolvePeriod(q.period as ReportPeriod, anchor, q.from, q.to);
    const bad = rangeProblem(resolved.from, resolved.to);
    if (bad) {
      res.status(400).json({ error: bad });
      return null;
    }
    return resolved;
  }

  function headerFor(p: Parsed, req: Request): Promise<ReportHeader> {
    return buildHeader(pool, cfg.lineId, {
      reportType: p.type,
      period: p.resolved,
      filters: p.filters,
      user: (req as AuthedRequest).user,
      lineNameFallback: cfg.lineName,
      plantNowMsOverride: p.atMs,
    });
  }

  // The print header on its own, for the Readings register's Print button
  // (gap analysis: "prints whatever 100 rows are on screen with no header,
  // period, line name or printed-by line"). Cheap: one line-identity read.
  app.get('/api/reports/header', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z.object({ from: dateStr, to: dateStr, at: isoTs }).safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const atMs = q.data.at && cfg.liveAllowAsOf ? new Date(q.data.at).getTime() : null;
      const day = new Date(atMs ?? plantNowMs()).toISOString().slice(0, 10);
      const header = await buildHeader(pool, cfg.lineId, {
        reportType: 'daily',
        period: { period: 'custom', from: q.data.from ?? day, to: q.data.to ?? q.data.from ?? day },
        filters: {},
        user: (req as AuthedRequest).user,
        lineNameFallback: cfg.lineName,
        plantNowMsOverride: atMs,
      });
      res.json({ header: { ...header, reportType: 'register', title: 'Register' } });
    } catch (err) {
      next(err);
    }
  });

  const serveReport = (fixedType?: ReportType) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const p = await parse(req, res, fixedType);
      if (!p) return;
      // The header carries who asked and when, so it is built per request;
      // only the composed report — the expensive part — is cached.
      const key = `reports:${p.type}:${JSON.stringify(p.resolved)}:${JSON.stringify(p.filters)}`;
      let data = cache.get(key);
      const hit = data != null;
      if (data == null) {
        data = await buildReport(pool, cfg.lineId, p.type, p.resolved, p.filters);
        cache.set(key, data);
      }
      const header = await headerFor(p, req);
      res.setHeader('X-Cache', hit ? 'HIT' : 'MISS').json(await envelope(pool, cfg.lineId, { header, report: data }));
    } catch (err) {
      next(err);
    }
  };

  app.get('/api/reports/:type', serveReport());

  // Rank 3 like the register export, and audited the same way: which report
  // left the building, for what window (roadmap Phase 11's `export.csv`).
  app.get('/api/reports/:type/export', requireRole(EXPORT_RANK), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const p = await parse(req, res);
      if (!p) return;
      const [header, data] = await Promise.all([headerFor(p, req), buildReport(pool, cfg.lineId, p.type, p.resolved, p.filters)]);
      const table = reportCsv(p.type, data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(header)}"`);
      res.send(csvDocument(table.headers, table.rows, header));
      const filters = Object.entries(p.filters).map(([k, v]) => `${k}=${String(v)}`).join(' ');
      audit(req, 'export.csv', 'report', p.type, `${p.resolved.from} to ${p.resolved.to}${filters ? ` (${filters})` : ''}`);
    } catch (err) {
      next(err);
    }
  });
}
