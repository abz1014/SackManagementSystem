/**
 * POST /api/dq-findings/:id/ack — Task W2-B (29 Sep 2026, failure analysis
 * F-24). Lets an engineer (rank >= 2) record that a standing DATA-FACT DQ
 * finding has been looked at and does not need Health to stay amber over
 * it. See services/dqAck.ts and shared/src/dqAck.ts for the allow-list and
 * the finding-level (not check-level) semantics.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { requireRole, type AuthedRequest } from '../auth.js';
import { acknowledgeDqFinding } from '../services/dqAck.js';

// Matches app.ts's own ENGINEER_RANK-equivalent gate for writes an engineer
// (not just a manager/admin) may make — the same rank changeover.ts's own
// PDAS_WRITE_RANK constant documents borrowing independently, per that
// file's comment on why it is not imported from app.ts.
const ENGINEER_RANK = 2;

const ackBody = z.object({ reason: z.string().min(10).max(500) });

export function mountDqAckRoutes(ctx: RouteContext): void {
  const { app, pool, audit } = ctx;

  app.post('/api/dq-findings/:id/ack', requireRole(ENGINEER_RANK), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.coerce.number().int().positive().safeParse(req.params.id);
      const body = ackBody.safeParse(req.body);
      if (!id.success || !body.success) {
        audit(req, 'dq_finding.ack', 'dq_finding', req.params.id ?? null,
          'Rejected: invalid request — a finding id and a reason of at least 10 characters are required');
        res.status(400).json({ error: 'a finding id and a reason of at least 10 characters are required' });
        return;
      }
      const actorId = (req as AuthedRequest).user!.userId;
      const r = await acknowledgeDqFinding(pool, { findingId: id.data, actorId, reason: body.data.reason });
      if (!r.ok) {
        const status = r.code === 'NOT_FOUND' ? 404 : 409;
        audit(req, 'dq_finding.ack', 'dq_finding', id.data, `Rejected: ${r.message}`);
        res.status(status).json({ error: r.message, code: r.code });
        return;
      }
      audit(req, 'dq_finding.ack', 'dq_finding', r.findingId, `Acknowledged: ${r.reason}`);
      res.json({ findingId: r.findingId, acknowledgedUtc: r.acknowledgedUtc, reason: r.reason });
    } catch (err) {
      next(err);
    }
  });
}
