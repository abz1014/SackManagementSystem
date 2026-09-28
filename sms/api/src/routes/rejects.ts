/**
 * Routes added by roadmap Phase 5 (reject management, 14 Sep 2026) — mounted
 * from createApp after the shared auth gate, so every route here is rank 1
 * (any signed-in account) unless it says otherwise. Reads only.
 *
 * The gap analysis (§7) found five drilldown dimensions named in the
 * requirement and a sixth — per day, per code — that no query answered. The
 * two routes here are that sixth dimension:
 *
 *   GET /api/rejects/by-day-code  — the breakdown a manager scans;
 *   GET /api/rejects/reason       — one day's rejects of one code, for the
 *                                   reason sheet.
 *
 * Both take the filter set /api/rejects and /api/reject-spc take (app.ts),
 * parsed by the same schema below, so a filter that means one thing on the
 * Pareto cannot mean another on the breakdown.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { envelope } from '../envelope.js';
import { MAX_RANGE_DAYS } from '../config.js';
import { getRejectsByDayCode, listRejectsOfDayCode, parseCodeParam, type RejectFilters } from '../services/rejects.js';
import { isoDate, isoTimestamp } from '../dates.js';

/**
 * Same cap as app.ts's validateRange (MAX_RANGE_DAYS, config.ts: 366 days,
 * 400 otherwise): these aggregate over the whole range in one pass, so an
 * accidental multi-year query must be refused, not attempted.
 */
function rangeError(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

const filterSchema = {
  shift: z.enum(['morning', 'evening', 'night']).optional(),
  tsTo: isoTimestamp.optional(),
  station: z.coerce.number().int().positive().optional(),
  product: z.coerce.number().int().positive().optional(),
  /** `weight`, or `<tube>-<material>` with `null` for a missing half. */
  code: z.string().max(24).optional(),
};

const byDayCodeQuery = z.object({
  from: isoDate,
  to: isoDate,
  ...filterSchema,
});

const reasonQuery = z.object({
  day: isoDate,
  code: z.string().max(24),
  shift: filterSchema.shift,
  station: filterSchema.station,
  product: filterSchema.product,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});

export function mountRejectsRoutes(ctx: RouteContext): void {
  const { app, pool, cfg } = ctx;

  // Rejects per production day per code, each with that day's cone count and
  // rate. `dayBasis` says the axis is the production day (06:00-06:00 under
  // the line's shift rule); IFL has not confirmed production day vs calendar
  // date for their reject reporting, and the screen prints that.
  app.get('/api/rejects/by-day-code', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = byDayCodeQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const rangeErr = rangeError(q.data.from, q.data.to);
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const code = q.data.code == null ? undefined : parseCodeParam(q.data.code);
      if (code === null) {
        res.status(400).json({ error: 'invalid code — expected weight or <tube>-<material>' });
        return;
      }
      const f: RejectFilters = { ...q.data, code };
      const data = await getRejectsByDayCode(pool, cfg.lineId, f);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // One day's rejects of one code — the reason sheet's list. Carries the
  // code's dictionary row (id, label, pass flag) so the sheet can offer the
  // existing PUT /api/reject-codes/:id rename without a second request.
  app.get('/api/rejects/reason', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = reasonQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const code = parseCodeParam(q.data.code);
      if (code === null) {
        res.status(400).json({ error: 'invalid code — expected weight or <tube>-<material>' });
        return;
      }
      const data = await listRejectsOfDayCode(pool, cfg.lineId, {
        day: q.data.day,
        code,
        shift: q.data.shift,
        station: q.data.station,
        product: q.data.product,
        page: q.data.page,
        pageSize: q.data.pageSize,
      });
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });
}
