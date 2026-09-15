/**
 * Routes added by roadmap Phase 7 (sack management and stock ledger, 15 Sep
 * 2026) — mounted from createApp after the shared auth gate, so every route
 * here is rank 1 (any signed-in account) unless it says otherwise.
 *
 *   GET  /api/sacks/summary    — count, kg, average, in-range share, cones per
 *                                sack (approximate), by shift and by product.
 *   GET  /api/sacks/stock      — the line-level stock ledger for a period:
 *                                opening · receipts · issues · consumption ·
 *                                adjustments · closing, per day and per
 *                                material. Phase 8's Sack report reads this
 *                                exact path and shape.
 *   GET  /api/sacks/movements  — the manual movements in a period, with who
 *                                recorded each, when and why (the stock sheet).
 *   POST /api/sacks/movements  — record one manual movement. Rank 2
 *                                (engineer) since 15 Sep 2026: IFL's answer
 *                                to Q43 puts sack adjustments with the
 *                                process engineer on the floor. Was rank 3,
 *                                the developer's default while Q43 was open.
 *                                Written through auditedWrite.
 *
 * NO ROUTE HERE ACCEPTS OR SETS A MACHINE. The request schema has no machine
 * field, the INSERT has no machine column, and migration 033's CHECK refuses
 * one — see that file's header for why (no machine column at any layer of
 * the sack record; roadmap rule 6; the question to IFL unsent).
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { envelope } from '../envelope.js';
import { requireRole, type AuthedRequest } from '../auth.js';
import { loadShiftRule } from '../services/live.js';
import { getSackSummary } from '../services/sacks.js';
import {
  getStockLedger, insertMovement, listMovements, productExists, validateMovement,
} from '../services/sackStock.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Same cap as app.ts's validateRange and routes/rejects.ts: 366 days, 400 otherwise. */
const MAX_RANGE_DAYS = 366;
function rangeError(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

const periodQuery = z.object({
  from: z.string().regex(DATE, 'expected YYYY-MM-DD'),
  to: z.string().regex(DATE, 'expected YYYY-MM-DD'),
  product: z.coerce.number().int().positive().optional(),
  tsTo: z.string().regex(ISO_TS, 'expected ISO timestamp').optional(),
});

const summaryQuery = periodQuery.extend({
  shift: z.enum(['morning', 'evening', 'night']).optional(),
});

/** Parse + range-check a period query, answering 400 itself when it cannot. */
function period<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const q = schema.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
    return null;
  }
  const rangeErr = rangeError(q.data.from, q.data.to);
  if (rangeErr) {
    res.status(400).json({ error: rangeErr });
    return null;
  }
  return q.data;
}

export function mountSacksRoutes(ctx: RouteContext): void {
  const { app, pool, cfg } = ctx;

  app.get('/api/sacks/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = period(summaryQuery, req, res);
      if (!q) return;
      const data = await getSackSummary(pool, cfg.lineId, q);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // The ledger. `basis: 'line'` and `machineLevel.enabled: false` are on
  // every response so a consumer that wants per-machine stock reads why it
  // is not there rather than finding a column missing.
  app.get('/api/sacks/stock', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = period(periodQuery, req, res);
      if (!q) return;
      const data = await getStockLedger(pool, cfg.lineId, q);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/sacks/movements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = period(periodQuery, req, res);
      if (!q) return;
      const data = await listMovements(pool, cfg.lineId, { from: q.from, to: q.to, product: q.product });
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sacks/movements', requireRole(2), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const v = validateMovement(req.body);
      if (!v.ok) {
        res.status(400).json({ error: 'invalid request', detail: v.error });
        return;
      }
      // Same class of gate as the calibration ledger's station check: no FK
      // backs material_id (a material the mirror has not seen must not refuse
      // a SACK reading), so an unknown product would land here unchallenged.
      if (v.value.materialId != null && !(await productExists(pool, v.value.materialId))) {
        res.status(400).json({ error: 'invalid request', detail: `no product ${v.value.materialId} in the product master` });
        return;
      }
      const user = (req as AuthedRequest).user!;
      // The production day is derived under the rule in force NOW, the same
      // rule the transform stamps on today's sacks (live.ts loadShiftRule).
      const rule = await loadShiftRule(pool, cfg.lineId);
      const out = await insertMovement(pool, cfg.lineId, user.userId, v.value, rule);
      res.status(201).json({
        ...out,
        movement: {
          ...v.value,
          occurredAtPlant: v.value.occurredAtPlant.toISOString(),
          machineId: null,
          source: 'manual' as const,
        },
      });
    } catch (err) {
      next(err);
    }
  });
}
