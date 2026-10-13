/**
 * GET /api/station-status (redesign task D2b) — rank 1, open to every
 * signed-in account (a read; roles gate writes only, CLAUDE.md).
 *
 * Same period parameters as /api/attention minus `tsTo` and the trailing
 * window: from / to (required), optional shift, optional fromShift / toShift
 * (decodeShiftRangeParam). `tsTo` is deliberately NOT accepted — the services
 * underneath cannot cap by instant (see services/stationStatus.ts header).
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { envelope, type Envelope } from '../envelope.js';
import { MAX_RANGE_DAYS } from '../config.js';
import { TtlCache } from '../cache.js';
import { isoDate } from '../dates.js';
import type { RouteContext } from './context.js';
import { decodeShiftRangeParam, isShiftRangeError } from './shiftRangeParam.js';
import { getStationStatus } from '../services/stationStatus.js';

const shiftRefParam = z.string().max(40).optional();

const query = z.object({
  from: isoDate,
  to: isoDate,
  shift: z.enum(['morning', 'evening', 'night']).optional(),
  fromShift: shiftRefParam,
  toShift: shiftRefParam,
});

/** Same cap as app.ts's validateRange (MAX_RANGE_DAYS). */
function rangeProblem(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

export function mountStationStatusRoutes(ctx: RouteContext): void {
  const { app, pool, cfg } = ctx;
  const cache = new TtlCache<Envelope<unknown>>(cfg.cacheTtlSeconds * 1000);

  app.get('/api/station-status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = query.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required', detail: q.error.flatten().fieldErrors });
        return;
      }
      const { from, to } = q.data;
      const bad = rangeProblem(from, to);
      if (bad) {
        res.status(400).json({ error: bad });
        return;
      }
      const shiftRange = decodeShiftRangeParam({ from, to, fromShift: q.data.fromShift, toShift: q.data.toShift });
      if (isShiftRangeError(shiftRange)) {
        res.status(400).json({ error: shiftRange.error });
        return;
      }
      const key = `station-status:${from}:${to}:${q.data.shift ?? 'all'}${shiftRange ? `:${shiftRange.fromShift}:${shiftRange.toShift}` : ''}`;
      const { value: env, hit } = await cache.getOrLoad(key, async () => {
        const data = await getStationStatus(pool, cfg.lineId, { from, to, shift: q.data.shift ?? null, shiftRange });
        return await envelope(pool, cfg.lineId, data);
      });
      res.setHeader('X-Cache', hit ? 'HIT' : 'MISS').json(env);
    } catch (err) {
      next(err);
    }
  });
}
