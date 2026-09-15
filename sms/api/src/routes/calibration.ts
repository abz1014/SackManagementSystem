/**
 * Routes added by roadmap Phase 9 (calibration analytics, 15 Sep 2026) —
 * mounted from createApp after the shared auth gate.
 *
 * The ledger routes (`/api/calibration/adjustments`, GET and POST) and the
 * drift view (`/api/calibration`) predate this module and stay in app.ts,
 * where Phase 9 extended them in place (from/to/station on the list, the
 * reference readings and product on the write, the restart on the view).
 * Only what is NEW lives here.
 */
import type { NextFunction, Request, Response } from 'express';
import type { RouteContext } from './context.js';
import { nelsonRuleTable, rulesThatCannotFire } from '../services/nelson.js';

export function mountCalibrationRoutes(ctx: RouteContext): void {
  const { app } = ctx;

  /**
   * The pattern rules the drift test runs, with the run length each needs.
   *
   * The labels lived only in the API (`NELSON_RULE_LABEL`) and never reached
   * a screen: the chart's hover said "non-random pattern" and the station
   * sheet said nothing. The web bundle does not import from the api package,
   * so the table is served, and `?points=N` answers which rules a series of
   * N consecutive days could never complete — what the Details block prints
   * for the 14-day window ("rules 4 and 7 cannot fire on this series").
   * Every signed-in account (rank 1): it is documentation, not data.
   */
  app.get('/api/calibration/rules', (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = typeof req.query.points === 'string' ? Number(req.query.points) : null;
      const points = raw != null && Number.isInteger(raw) && raw >= 0 ? raw : null;
      res.json({
        rules: nelsonRuleTable(),
        points,
        cannotFire: points == null ? null : rulesThatCannotFire(points),
        // The method has not been approved by IFL (gap analysis §11): which
        // of the eight rules, and day-level application, are a clarification.
        approvedByIfl: false,
      });
    } catch (err) {
      next(err);
    }
  });
}
