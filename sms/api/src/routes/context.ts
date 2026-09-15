/**
 * What a route module needs from createApp — roadmap Wave C/D (14 Sep 2026).
 *
 * app.ts had grown to 1,600 lines with every route inline, and three
 * phases (4 cone weight, 5 rejects, 11 operations/security) were about to
 * add to it at once. Each phase now registers its routes from its own module
 * through this context, so the shared file gains one line per phase rather
 * than a few hundred, and the audit helpers are reached the same way the
 * inline routes reach them.
 */
import type { Express, Request } from 'express';
import type { ConnectionPool } from 'mssql';
import type { ApiConfig } from '../config.js';

export interface RouteContext {
  app: Express;
  pool: ConnectionPool;
  cfg: ApiConfig;
  /** Fire-and-forget audit for non-configuration events (login, export). Configuration writes use auditedWrite. */
  audit: (req: Request, action: string, targetType: string, targetId: string | number | null, detail: string | null) => void;
}
