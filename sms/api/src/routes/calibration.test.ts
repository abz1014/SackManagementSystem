/**
 * Roadmap Phase 9 (15 Sep 2026): the rule table route. Mounted on a fake
 * Express app that records the handler, then driven with fake req/res — the
 * route has no database, so the HTTP harness in app.rbac.test.ts (which
 * carries its RBAC row) is not needed here.
 */
import { describe, expect, it } from 'vitest';
import type { Express, Request, Response } from 'express';
import { mountCalibrationRoutes } from './calibration.js';
import type { RouteContext } from './context.js';
import { NELSON_RULE_LABEL } from '../services/nelson.js';

type Handler = (req: Request, res: Response, next: (e?: unknown) => void) => void;

function mount(): Map<string, Handler> {
  const routes = new Map<string, Handler>();
  const app = { get: (path: string, h: Handler) => routes.set(path, h) } as unknown as Express;
  mountCalibrationRoutes({ app, pool: {} as RouteContext['pool'], cfg: {} as RouteContext['cfg'], audit: () => {}, pdas: {} as RouteContext['pdas'] });
  return routes;
}

function call(h: Handler, query: Record<string, string>): { status: number; body: unknown } {
  let status = 200;
  let body: unknown = null;
  const res = {
    status: (s: number) => { status = s; return res; },
    json: (b: unknown) => { body = b; return res; },
  } as unknown as Response;
  h({ query } as unknown as Request, res, (e) => { if (e) throw e; });
  return { status, body };
}

describe('GET /api/calibration/rules', () => {
  it('serves every rule with its label and minimum run length, unapproved', () => {
    const h = mount().get('/api/calibration/rules')!;
    const { status, body } = call(h, {});
    expect(status).toBe(200);
    const b = body as { rules: { id: number; label: string; minPoints: number }[]; points: number | null; cannotFire: number[] | null; approvedByIfl: boolean };
    expect(b.rules.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b.rules.find((r) => r.id === 3)!.label).toBe(NELSON_RULE_LABEL[3]);
    expect(b.rules.find((r) => r.id === 4)!.minPoints).toBe(14);
    expect(b.points).toBeNull();
    expect(b.cannotFire).toBeNull();
    expect(b.approvedByIfl).toBe(false);
  });

  it('says which rules a series of N days could never complete', () => {
    const h = mount().get('/api/calibration/rules')!;
    // The sidecar's typical window: 12 consecutive days — 4 (14) and 7 (15) cannot fire.
    expect((call(h, { points: '12' }).body as { cannotFire: number[] }).cannotFire).toEqual([4, 7]);
    // Six days: rule 2 (9) and rule 8 (8) join them.
    expect((call(h, { points: '6' }).body as { cannotFire: number[] }).cannotFire).toEqual([2, 4, 7, 8]);
    // A long series: everything can fire.
    expect((call(h, { points: '20' }).body as { cannotFire: number[] }).cannotFire).toEqual([]);
    // Nonsense is ignored rather than refused: it is documentation.
    expect((call(h, { points: 'abc' }).body as { points: number | null }).points).toBeNull();
  });
});
