/**
 * Routes added by roadmap Phase 4 (cone weight module, 14 Sep 2026) —
 * mounted from createApp after the shared auth gate, so every route here is
 * already behind "signed in"; requireRole raises the bar where the contract
 * says so.
 *
 *   GET /api/products/limits/history   rank 1   the versioned limits, per product
 *   GET /api/reconciliation            rank 3   weight totals by state and plausibility, for a period
 *   GET /api/machines/running          rank 1   the product on each machine, from its newest cones
 *   GET /api/shift-check               rank 1   plant-stored shift vs SMS-derived shift, per day
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { envelope } from '../envelope.js';
import type { RouteContext } from './context.js';
import { listLimitHistory } from '../services/productLimits.js';
import { getReconciliation } from '../services/reconcile.js';
import { getMachinesRunning } from '../services/machinesRunning.js';
import { getShiftCheck } from '../services/shiftCheck.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoTs = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
  .optional();

// Same cap as app.ts's analytics routes: a period query over years would
// scan without bound once the record is years long.
const MAX_RANGE_DAYS = 366;
function rangeProblem(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

export function mountConeRoutes({ app, pool, cfg }: RouteContext): void {
  // The limits history: every product, every version, newest first. Read-only
  // — changing a limit is the PDAS write path (§5), and only when IFL
  // authorises it in writing.
  app.get('/api/products/limits/history', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ products: await listLimitHistory(pool) });
    } catch (err) {
      next(err);
    }
  });

  const periodQuery = z.object({
    from: dateStr,
    to: dateStr,
    shift: z.enum(['morning', 'evening', 'night']).optional(),
  });

  // Manager+: it is the reconciliation figure, not a screen figure.
  app.get('/api/reconciliation', requireRole(3), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = periodQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required', detail: q.error.flatten().fieldErrors });
        return;
      }
      const bad = rangeProblem(q.data.from, q.data.to);
      if (bad) {
        res.status(400).json({ error: bad });
        return;
      }
      const data = await getReconciliation(pool, cfg.lineId, q.data.from, q.data.to, q.data.shift ?? null);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // `at` caps the window for a replay (?at=); it is honoured only when the
  // server allows replays, exactly as /api/live does.
  app.get('/api/machines/running', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z.object({ at: isoTs }).safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const asOfMs = q.data.at && cfg.liveAllowAsOf ? new Date(q.data.at).getTime() : null;
      const data = await getMachinesRunning(pool, cfg.lineId, { asOfMs });
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/shift-check', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z.object({ from: dateStr, to: dateStr }).safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required', detail: q.error.flatten().fieldErrors });
        return;
      }
      const bad = rangeProblem(q.data.from, q.data.to);
      if (bad) {
        res.status(400).json({ error: bad });
        return;
      }
      const data = await getShiftCheck(pool, cfg.lineId, q.data.from, q.data.to);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });
}
