/**
 * Routes for the changeover workflow (services/changeover.ts) — IFL's single
 * most important requirement, per Hassan sb's 15 Sep 2026 answers (per-machine
 * product changeover per shift). The service — planChangeover / executeChangeover,
 * with the dry run, blockers, warnings, NO_ROLLBACK and the partial-failure
 * outcome all modelled — has existed since roadmap Wave F with zero non-test
 * callers; this file is what makes it reachable over HTTP.
 *
 *   GET  /api/changeover/refs    — rank 1. Blends, counts, tube types, pack
 *                                  schemas and active pallets, read from the
 *                                  sidecar mirror, for the form's pickers.
 *                                  Reference data every signed-in account may
 *                                  read (the one-audience rule: reads are not
 *                                  tiered — CLAUDE.md, "⚠️ The user base is
 *                                  ONE audience").
 *   POST /api/changeover/plan    — rank 1. The dry run. planChangeover reads
 *                                  the sidecar mirror only and NEVER opens the
 *                                  PDAS writer pool (changeover.ts:36-39
 *                                  originally, now just above executeChangeover's
 *                                  disabled branch) — that is what makes it
 *                                  safe to exercise with PDAS_WRITE_ENABLED
 *                                  false, which is the normal and current
 *                                  state. Every response carries
 *                                  `reachesMachine: false` and the operator
 *                                  sentence: a changeover makes a product
 *                                  selectable in PDAS, it does not select it
 *                                  on a machine.
 *   POST /api/changeover/execute — rank 2, PDAS_WRITE_RANK below, matching the
 *                                  other PDAS write routes (app.ts). With the
 *                                  flag false, executeChangeover's own early
 *                                  return answers `{ refused }` (after
 *                                  recording one sms.product_change row at
 *                                  outcome='disabled' — see changeover.ts's
 *                                  recordDisabledAttempt) and this route turns
 *                                  that into 503, never a 500. With blockers
 *                                  but the flag on, 409. Only once both are
 *                                  clear does it call the vendor's procs.
 *   GET  /api/product-changes    — rank 1. Its FIRST reader (UX Phase 6 Brief
 *                                  3, 16 Sep 2026): the table is written by
 *                                  this file's own recordDisabledAttempt and
 *                                  by pdasWrite.ts's recordChange, but until
 *                                  now nothing ever read it back. A read of
 *                                  SMS's own attempt log, keyset-paged on
 *                                  change_id — see services/productChanges.ts.
 *
 * No route here can set PDAS_WRITE_ENABLED — that is a startup-time env var
 * (config.ts), read once into cfg.pdasWrite / the shared PdasWriter (app.ts).
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { requireRole, type AuthedRequest } from '../auth.js';
import { getPlausibilityRule } from '../services/admin.js';
import { listPackSchemas, listPallets } from '../services/pallets.js';
import { planChangeover, executeChangeover, type ChangeoverRequest } from '../services/changeover.js';
import { listProductChangePage } from '../services/productChanges.js';

// Matches app.ts's own PDAS_WRITE_RANK (both gate every write that reaches a
// vendor proc); kept as a separate literal because app.ts's is local to its
// createApp() closure and this module has no other way to read it.
const PDAS_WRITE_RANK = 2;

const refChoice = z.union([
  z.object({ id: z.coerce.number().int().positive() }),
  z.object({ name: z.string().min(1).max(255) }),
]);

const tubeChoice = z.union([
  z.object({ id: z.coerce.number().int().positive() }),
  z.object({
    name: z.string().min(1).max(255),
    tubeWeightG: z.coerce.number(),
    tubeForm: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
]);

// Deliberately loose on business rules (setpoint bounds, reason length, id
// existence): planChangeover reports those as blockers in a 200 response, per
// its own header — that is the point of a dry run. Zod's job here is only
// shape: reject a body that cannot be turned into a ChangeoverRequest at all.
const changeoverBody = z.object({
  blend: refChoice,
  count: refChoice,
  tubeType: tubeChoice,
  material: z.object({
    setpointG: z.coerce.number(),
    offsetMinusG: z.coerce.number(),
    offsetPlusG: z.coerce.number(),
    lot: z.string(),
    ppColour: z.string().nullable().optional().transform((v) => v ?? null),
  }),
  pallet: z.object({
    packSchemaId: z.coerce.number().int(),
    lot: z.string().nullable().optional().transform((v) => v ?? null),
    sackColour: z.string().nullable().optional().transform((v) => v ?? null),
  }),
  retire: z
    .object({
      productIds: z.array(z.coerce.number().int().positive()).default([]),
      palletIds: z.array(z.coerce.number().int().positive()).default([]),
    })
    .default({ productIds: [], palletIds: [] }),
  reason: z.string(),
});

export function mountChangeoverRoutes(ctx: RouteContext): void {
  const { app, pool, cfg, pdas } = ctx;

  const setpointBounds = async () => {
    const p = await getPlausibilityRule(pool, cfg.lineId);
    return { setpointLoG: p.coneLoG, setpointHiG: p.coneHiG };
  };
  const actorOf = (req: Request) => {
    const u = (req as AuthedRequest).user!;
    return { userId: u.userId, username: u.username };
  };
  const parseBody = (req: Request, res: Response): ChangeoverRequest | null => {
    const b = changeoverBody.safeParse(req.body);
    if (!b.success) {
      res.status(400).json({ error: 'invalid changeover request', detail: b.error.flatten().fieldErrors });
      return null;
    }
    return b.data as ChangeoverRequest;
  };

  // The form's pickers. Rank 1 (the blanket app.use('/api', requireRole(1))
  // above already covers this — no gate repeated here — see the header note
  // on the one-audience rule).
  app.get('/api/changeover/refs', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [b, c, t, packSchemas, pallets] = await Promise.all([
        pool.request().query<{ id: number; name: string }>(`SELECT blend_id id, blend name FROM sms.blend ORDER BY blend`),
        pool.request().query<{ id: number; name: string }>(`SELECT count_id id, count_text name FROM sms.yarn_count ORDER BY count_val, count_text`),
        pool
          .request()
          // tubeForm added (migration 041) so the picker can show it —
          // AddTubeType's own duplicate check is name AND form together
          // (resolveTube's header), so an engineer choosing a tube type by
          // name benefits from seeing which form each one already is.
          .query<{ id: number; name: string; tubeWeightG: number | null; tubeForm: number | null }>(
            `SELECT tube_type_id id, tube_type name, tube_weight_g tubeWeightG, tube_form tubeForm FROM sms.tube_type ORDER BY tube_type`,
          ),
        listPackSchemas(pool),
        listPallets(pool),
      ]);
      res.json({
        blends: b.recordset,
        counts: c.recordset,
        tubeTypes: t.recordset,
        packSchemas,
        // "active pallets" (the task's own words): what CreateMaterial's
        // retire step and the QCS panel itself both care about is which
        // pallets are currently selectable, not the full history.
        pallets: pallets.filter((p) => p.active === true),
      });
    } catch (err) {
      next(err);
    }
  });

  // The dry run. Also rank 1 — see the refs route's comment above.
  app.post('/api/changeover/plan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(req, res);
      if (!body) return;
      const plan = await planChangeover({ pool, writer: pdas, bounds: await setpointBounds() }, body);
      res.json(plan);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/changeover/execute', requireRole(PDAS_WRITE_RANK), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(req, res);
      if (!body) return;
      const outcome = await executeChangeover({ pool, writer: pdas, bounds: await setpointBounds() }, body, actorOf(req));
      if ('refused' in outcome) {
        // Two distinct refusals share the same shape: the flag is off
        // (503 — matches writeStatus('DISABLED') on the /api/products routes),
        // or the flag is on but the plan itself has blockers (409 — the
        // mirror already holds something this request conflicts with).
        res.status(pdas.enabled ? 409 : 503).json({ error: outcome.refused, code: pdas.enabled ? 'BLOCKED' : 'DISABLED', reachesMachine: false });
        return;
      }
      // ok: every step landed. Not ok: NO_ROLLBACK applies — some steps are
      // real PDAS rows and the response names exactly which, per the plan's
      // own contract. 207 marks that as partial without inventing a new shape.
      res.status(outcome.ok ? 200 : 207).json(outcome);
    } catch (err) {
      next(err);
    }
  });

  // The product-change trail — rank 1 (a read; the blanket app.use('/api',
  // requireRole(1)) above already covers this, same as /refs and /plan).
  // `?before=<change_id>&limit=` walks older pages; without `before` the
  // newest page is returned. See services/productChanges.ts for the shape.
  app.get('/api/product-changes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(1000).optional() })
        .safeParse(req.query);
      if (!q.success) { res.status(400).json({ error: 'invalid query' }); return; }
      res.json(await listProductChangePage(pool, { before: q.data.before ?? null, limit: q.data.limit ?? 200 }));
    } catch (err) {
      next(err);
    }
  });
}
