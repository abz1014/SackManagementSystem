/**
 * Routes added by roadmap Phase 4 (cone weight module, 14 Sep 2026) —
 * mounted from createApp after the shared auth gate, so every route here is
 * already behind "signed in"; requireRole raises the bar where the contract
 * says so.
 *
 *   GET  /api/products/limits/history   rank 1   the versioned limits, per product
 *   POST /api/products/limits/local     rank 2   append an SMS-local limit version — NEVER touches PDAS (roadmap Phase 4 item 2, 15 Sep 2026)
 *   GET  /api/reconciliation            rank 1   weight totals by state and plausibility, for a period
 *   GET  /api/machines/running          rank 1   the product on each machine, from its newest cones
 *   GET  /api/shift-check               rank 1   plant-stored shift vs SMS-derived shift, per day
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { requireRole, type AuthedRequest } from '../auth.js';
import { envelope } from '../envelope.js';
import { MAX_RANGE_DAYS } from '../config.js';
import type { RouteContext } from './context.js';
import { listLimitHistory, setLocalLimitVersion } from '../services/productLimits.js';
import { getPlausibilityRule } from '../services/admin.js';
import { getReconciliation } from '../services/reconcile.js';
import { getMachinesRunning } from '../services/machinesRunning.js';
import { getShiftCheck } from '../services/shiftCheck.js';
import { isoDate } from '../dates.js';

const dateStr = isoDate;
const isoTs = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
  .optional();

// Same cap as app.ts's analytics routes (MAX_RANGE_DAYS, config.ts): a
// period query over years would scan without bound once the record is
// years long.
function rangeProblem(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

export function mountConeRoutes({ app, pool, cfg }: RouteContext): void {
  // The limits history: every product, every version, newest first. Two ways
  // a version can be added: the PDAS write path (§5, off until IFL
  // authorises it in writing) and the SMS-local path below (POST .../local,
  // which never touches PDAS) — this GET reads both back the same way.
  app.get('/api/products/limits/history', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ products: await listLimitHistory(pool) });
    } catch (err) {
      next(err);
    }
  });

  // Append an SMS-local limit version — engineer rank (2), same rank as
  // /api/current-product and the PDAS write path (IFL Q19/Q41: the process
  // engineer on the floor). Requires no PDAS write access at all: this NEVER
  // opens a PDAS connection and works whether or not PDAS_WRITE_ENABLED is
  // set (roadmap Phase 4 item 2, 15 Sep 2026 — IFL wants limits editable in
  // Setup and nothing may write to PDAS yet). See productLimits.ts's
  // setLocalLimitVersion for what this appends and why it cannot reclassify
  // a past reading.
  const localLimitBody = z.object({
    productId: z.coerce.number().int().positive(),
    setpointG: z.coerce.number().positive(),
    offsetMinusG: z.coerce.number().positive(),
    offsetPlusG: z.coerce.number().positive(),
    effectiveFrom: z.string().datetime().optional(),
    reason: z.string().max(255).nullable().optional().transform((v) => v ?? null),
  });
  app.post('/api/products/limits/local', requireRole(2), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = localLimitBody.safeParse(req.body);
      if (!b.success) {
        res.status(400).json({ error: 'invalid request', detail: b.error.flatten().fieldErrors });
        return;
      }
      const user = (req as AuthedRequest).user!;
      const p = await getPlausibilityRule(pool, cfg.lineId);
      const r = await setLocalLimitVersion(
        pool,
        user.userId,
        { setpointLoG: p.coneLoG, setpointHiG: p.coneHiG },
        {
          productId: b.data.productId,
          setpointG: b.data.setpointG,
          offsetMinusG: b.data.offsetMinusG,
          offsetPlusG: b.data.offsetPlusG,
          effectiveFromUtc: b.data.effectiveFrom ? new Date(b.data.effectiveFrom) : new Date(),
          reason: b.data.reason,
        },
      );
      if (!r.ok) {
        const status = r.code === 'UNKNOWN_PRODUCT' ? 404 : 400;
        res.status(status).json({ error: r.message, code: r.code });
        return;
      }
      res.json({ versionId: r.versionId, label: r.label, products: await listLimitHistory(pool) });
    } catch (err) {
      next(err);
    }
  });

  const periodQuery = z.object({
    from: dateStr,
    to: dateStr,
    shift: z.enum(['morning', 'evening', 'night']).optional(),
  });

  // UX Phase 6 Brief 4 (16 Sep 2026): was requireRole(3) — wrong under the
  // one-audience rule (CLAUDE.md, "roles gate WRITES only"). This is a READ
  // of SMS's own canonical aggregates (sms.cone_event, grouped), strictly
  // less sensitive than /api/production which sits at the blanket rank 1.
  // Falls through to the app's shared signed-in gate.
  app.get('/api/reconciliation', async (req: Request, res: Response, next: NextFunction) => {
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
