/** Express app factory. Routes mounted here; DB pool injected. */
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { z } from 'zod';
import type { ApiConfig } from './config.js';
import { envelope, type Envelope } from './envelope.js';
import { getOperations } from './services/operations.js';
import { getProduction, type GroupBy } from './services/production.js';
import { getShiftAnalysis } from './services/shiftAnalysis.js';
import { getRejectPareto, setRejectLabel } from './services/rejects.js';
import { getWeights, type Basis } from './services/weights.js';
import { listProducts, getCurrent, setCurrent, listTimeline } from './services/currentProduct.js';
import { listEvents, getEventDetail, exportEventsCsv, type EventType } from './services/register.js';
import { getDowntime, getStoppagePatterns } from './services/downtime.js';
import { getSpec, getWeightSpc, type SpcType } from './services/spc.js';
import { getRejectSpc, type RejectBucketSize, type RejectTypeFilter } from './services/rejectSpc.js';
import { getOee } from './services/oee.js';
import {
  listUsers, createUser, updateUser,
  listStations, setStation,
  getRules, setWeightRule, setShiftRule,
  getPlausibilityRule, setPlausibilityRule,
} from './services/admin.js';
import { recordAudit, listAudit } from './services/audit.js';
import {
  authMiddleware,
  authenticate,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireRole,
  pruneExpiredSessions,
  LoginRateLimiter,
  SESSION_COOKIE,
  type AuthedRequest,
} from './auth.js';
import { TtlCache } from './cache.js';
import { securityHeaders } from './security.js';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .optional();

// Analytics endpoints (SPC/reject-SPC/OEE) do full-population computation by
// design — correct at the current 18-day scale, but unbounded once years
// accumulate. Cap the span rather than let an accidental multi-year query
// scan/allocate without limit; 366 covers any real single-year analysis.
const MAX_RANGE_DAYS = 366;
function validateRange(from: string, to: string): string | null {
  if (from > to) return 'from must be <= to';
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `range too large — max ${MAX_RANGE_DAYS} days, requested ${days}`;
  return null;
}

const productionQuery = z.object({
  from: dateStr,
  to: dateStr,
  shift: z.enum(['morning', 'evening', 'night']).optional(),
  station: z.coerce.number().int().positive().optional(),
  product: z.coerce.number().int().positive().optional(),
  groupBy: z.enum(['day', 'shift', 'station', 'none']).default('day'),
});

export function createApp(pool: ConnectionPool, cfg: ApiConfig): Express {
  const app = express();
  app.use(securityHeaders());
  app.use(express.json());
  app.use(authMiddleware(pool)); // attaches req.user (or null) from session cookie

  const prodCache = new TtlCache<Envelope<unknown>>(cfg.cacheTtlSeconds * 1000);
  const loginLimiter = new LoginRateLimiter();

  // Fire-and-forget audit write: the primary action has already succeeded by
  // the time this is called, and there is no transaction spanning both, so a
  // logging failure must never fail the request that triggered it. It must
  // also never vanish silently — a broken audit trail is itself a finding —
  // so failures go to stderr instead of a swallowed catch.
  function audit(req: Request, action: string, targetType: string, targetId: string | number | null, detail: string | null): void {
    const actorId = (req as AuthedRequest).user?.userId;
    if (actorId == null) return;
    void recordAudit(pool, actorId, action, targetType, targetId, detail).catch((e) =>
      console.error(`[audit] failed to record ${action}:`, e),
    );
  }
  // Off unless explicitly enabled: X-Forwarded-For is client-supplied, so
  // trusting it with no proxy in front makes req.ip attacker-controlled and the
  // login lockout bypassable. Enable only behind a proxy you control (DEPLOY.md).
  app.set('trust proxy', cfg.trustProxy);

  // health — no envelope, cheap liveness/DB check
  app.get('/api/health', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await pool.request().query('SELECT 1 AS ok');
      res.json({ status: 'ok', db: 'up' });
    } catch (err) {
      next(err);
    }
  });

  // ---- auth (public: login/logout/me) ----
  app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'username and password required' });
        return;
      }
      // Limit on BOTH axes. Keying on req.ip alone was bypassable by rotating
      // X-Forwarded-For (proven: 12 failed logins with a rotating header all
      // returned 401, vs 429 from the 9th on a fixed address). `trust proxy` is
      // now off by default, which closes that — but keying on the account as
      // well means IP rotation cannot grind a single account even when a real
      // proxy is trusted, which is the protection that actually matters for the
      // admin login. Accepted trade-off: a determined attacker can lock a known
      // account out for LOCKOUT_MS. On a handful-of-users plant intranet that is
      // strictly better than unlimited attempts against `admin`.
      const ipKey = `ip:${req.ip ?? 'unknown'}`;
      const userKey = `user:${body.data.username.toLowerCase()}`;
      const now = Date.now();
      const wait = Math.max(loginLimiter.retryAfter(ipKey, now), loginLimiter.retryAfter(userKey, now));
      if (wait > 0) {
        res.setHeader('Retry-After', String(wait)).status(429).json({ error: 'too many attempts, try again later' });
        return;
      }
      const user = await authenticate(pool, body.data.username, body.data.password);
      if (!user) {
        loginLimiter.recordFailure(ipKey, now);
        loginLimiter.recordFailure(userKey, now);
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      loginLimiter.clear(ipKey);
      loginLimiter.clear(userKey);
      const s = await createSession(pool, user.userId);
      setSessionCookie(res, s.id, s.expires, req);
      res.json({ user: { username: user.username, displayName: user.displayName, role: user.role } });
      // opportunistic housekeeping — don't block the response
      void pruneExpiredSessions(pool).catch(() => {});
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.headers.cookie ?? '';
      const m = raw.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
      if (m && m[1]) await destroySession(pool, decodeURIComponent(m[1]));
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    res.json({ user: user ? { username: user.username, displayName: user.displayName, role: user.role } : null });
  });

  // ---- everything below requires an authenticated user (operator+) ----
  app.use('/api', requireRole(1));

  /**
   * The production window every date picker offers.
   *
   * A day only counts if it holds a real production run. Two kinds of bad row
   * would otherwise invent a day at the front of the range:
   *   - epoch-near-zero timestamps (DQ-2 clock faults) landing in 1969/1970;
   *   - a station clock briefly reporting the wrong day, which put 2 readings
   *     on 2026-06-21 while their neighbours in ingest order sat on 06-22.
   * Both made the picker open on a day with no production, and made every
   * "N days" count in the app read one day long.
   *
   * MIN_PRODUCTION_ROWS is not tuned. The measured separation is 2 rows on a
   * fault day against 1,671 on the smallest REAL day (2026-07-10, a genuine
   * part-day where the copy ends mid-morning), so anything from 3 to ~1,600
   * yields the same window. It is deliberately far below 1,671 so a short
   * changeover day or a half-finished today is never mistaken for a fault.
   *
   * Excluded days are returned, not swallowed: the app states them rather than
   * quietly narrowing the range, and the transform raises a `stale_timestamp`
   * finding so the underlying clock fault is visible on Sync.
   */
  const MIN_PRODUCTION_ROWS = 20;
  app.get('/api/range', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await pool
        .request()
        .input('line', mssql.Int, cfg.lineId)
        .input('minRows', mssql.Int, MIN_PRODUCTION_ROWS)
        .query<{ shiftDate: string; n: number }>(
          `SELECT CONVERT(varchar(10), shift_date, 120) AS shiftDate, COUNT(*) AS n
             FROM sms.cone_event
            WHERE line_id = @line AND shift_date >= '2020-01-01'
            GROUP BY shift_date
            ORDER BY shift_date`,
        );
      const kept = r.recordset.filter((d) => d.n >= MIN_PRODUCTION_ROWS);
      const excluded = r.recordset
        .filter((d) => d.n < MIN_PRODUCTION_ROWS)
        .map((d) => ({ date: d.shiftDate, rows: d.n }));
      res.json({
        minDate: kept.length ? kept[0]!.shiftDate : null,
        maxDate: kept.length ? kept[kept.length - 1]!.shiftDate : null,
        excludedDays: excluded,
        minProductionRows: MIN_PRODUCTION_ROWS,
      });
    } catch (err) {
      next(err);
    }
  });

  // operations — sync health, schema, DQ roll-up
  app.get('/api/operations', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await getOperations(pool, cfg.lineId);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // production — generalized, filtered, grouped; TTL-cached
  app.get('/api/production', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = productionQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid query', detail: parsed.error.flatten().fieldErrors });
        return;
      }
      if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
        res.status(400).json({ error: 'from must be <= to' });
        return;
      }
      const key = JSON.stringify(parsed.data);
      const cached = prodCache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT').json(cached);
        return;
      }
      const data = await getProduction(pool, cfg.lineId, {
        ...parsed.data,
        groupBy: parsed.data.groupBy as GroupBy,
      });
      const env = await envelope(pool, cfg.lineId, data);
      prodCache.set(key, env);
      res.setHeader('X-Cache', 'MISS').json(env);
    } catch (err) {
      next(err);
    }
  });

  // ---- Downtime & Throughput — inferred from inter-cone gaps only (no PLC feed) ----
  app.get('/api/downtime', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          thresholdSeconds: z.coerce.number().int().min(30).max(3600).default(120),
        })
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — date=YYYY-MM-DD required' });
        return;
      }
      const data = await getDowntime(pool, cfg.lineId, q.data.date, q.data.thresholdSeconds);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // ---- Stoppage patterns across a range — one query, not one call per day ----
  app.get('/api/stoppage-patterns', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          thresholdSeconds: z.coerce.number().int().min(30).max(3600).default(120),
        })
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required' });
        return;
      }
      const rangeErr = validateRange(q.data.from, q.data.to);
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const data = await getStoppagePatterns(pool, cfg.lineId, q.data.from, q.data.to, q.data.thresholdSeconds);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // ---- Weight SPC — I-MR control chart + Cp/Cpk/Pp/Ppk (only with a real spec) ----
  app.get('/api/spc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({
          type: z.enum(['cone', 'sack']).default('cone'),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          productId: z.coerce.number().int().positive().optional(),
          usl: z.coerce.number().optional(),
          lsl: z.coerce.number().optional(),
          shift: z.enum(['morning', 'evening', 'night']).optional(),
        })
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required' });
        return;
      }
      const rangeErr = validateRange(q.data.from, q.data.to);
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const spec = await getSpec(pool, q.data.productId ?? null, q.data.usl ?? null, q.data.lsl ?? null, q.data.type);
      const plausibility = await getPlausibilityRule(pool, cfg.lineId);
      const data = await getWeightSpc(pool, cfg.lineId, q.data.type as SpcType, q.data.from, q.data.to, spec, plausibility, q.data.shift ?? null);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // ---- Reject control chart (p-chart) — anomalous rate + burst detection ----
  app.get('/api/reject-spc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          bucket: z.enum(['hour', 'day']).optional(),
          rejectType: z.enum(['all', 'quality', 'weight']).default('all'),
        })
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required' });
        return;
      }
      const rangeErr = validateRange(q.data.from, q.data.to);
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const bucket: RejectBucketSize = q.data.bucket ?? (q.data.from === q.data.to ? 'hour' : 'day');
      const data = await getRejectSpc(pool, cfg.lineId, q.data.from, q.data.to, bucket, q.data.rejectType as RejectTypeFilter);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // ---- Inferred OEE — estimated, every input visible/overridable ----
  app.get('/api/oee', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          thresholdSeconds: z.coerce.number().int().min(30).max(3600).default(120),
          plannedHoursPerDay: z.coerce.number().min(1).max(24).default(24),
          idealCycleSeconds: z.coerce.number().positive().optional(),
          shift: z.enum(['morning', 'evening', 'night']).optional(),
        })
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query — from/to=YYYY-MM-DD required' });
        return;
      }
      const rangeErr = validateRange(q.data.from, q.data.to);
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const data = await getOee(
        pool,
        cfg.lineId,
        q.data.from,
        q.data.to,
        q.data.thresholdSeconds,
        q.data.plannedHoursPerDay,
        q.data.idealCycleSeconds ?? null,
        q.data.shift ?? null,
      );
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // ---- Sack & Cone Register — drill-down list, detail, CSV export ----
  const isoTs = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
    .optional();
  const registerQuery = z.object({
    type: z.enum(['cone', 'sack', 'reject']),
    from: dateStr,
    to: dateStr,
    shift: z.enum(['morning', 'evening', 'night']).optional(),
    station: z.coerce.number().int().positive().optional(),
    inRange: z.enum(['true', 'false']).optional(),
    rejectType: z.enum(['quality', 'weight']).optional(),
    wMin: z.coerce.number().optional(),
    wMax: z.coerce.number().optional(),
    tsFrom: isoTs,
    tsTo: isoTs,
    sort: z.enum(['time', 'weight']).default('time'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  });

  function parseRegisterQuery(raw: unknown) {
    const parsed = registerQuery.safeParse(raw);
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      inRange: parsed.data.inRange === undefined ? undefined : parsed.data.inRange === 'true',
    };
  }

  app.get('/api/events', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = parseRegisterQuery(req.query);
      if (!q) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const pageQ = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50) }).safeParse(req.query);
      if (!pageQ.success) {
        res.status(400).json({ error: 'invalid page/pageSize' });
        return;
      }
      const data = await listEvents(pool, cfg.lineId, q.type as EventType, { ...q, ...pageQ.data });
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // Bulk export is manager+ per the interface spec's role table. Paged reads
  // stay at the blanket requireRole(1): looking at a page of records is not the
  // same act as walking off with all 142k rows.
  app.get('/api/events/export', requireRole(3), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = parseRegisterQuery(req.query);
      if (!q) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const { csv, truncated } = await exportEventsCsv(pool, cfg.lineId, q.type as EventType, q);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${q.type}-events.csv"`);
      if (truncated) res.setHeader('X-Export-Truncated', 'true');
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/events/:type/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = req.params.type;
      const id = Number(req.params.id);
      if ((type !== 'cone' && type !== 'sack' && type !== 'reject') || !Number.isInteger(id)) {
        res.status(400).json({ error: 'invalid type or id' });
        return;
      }
      const row = await getEventDetail(pool, cfg.lineId, type, id);
      if (!row) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ row });
    } catch (err) {
      next(err);
    }
  });

  // shift analysis — corrected vs legacy (Q7), with mismatch count
  app.get('/api/shift-analysis', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({ from: dateStr, to: dateStr })
        .refine((v) => !(v.from && v.to) || v.from <= v.to, 'from must be <= to')
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const data = await getShiftAnalysis(pool, cfg.lineId, q.data.from, q.data.to);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // reject Pareto (Q10) — raw codes + lookup labels
  app.get('/api/rejects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z.object({ from: dateStr, to: dateStr }).safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const data = await getRejectPareto(pool, cfg.lineId, q.data.from, q.data.to);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // set a reject-reason label (entering Q10 answers) — manager+ only
  app.put('/api/reject-codes/:id', requireRole(3), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({ label: z.string().max(128).nullable(), isPass: z.boolean().nullable().optional() })
        .safeParse(req.body);
      if (!Number.isInteger(id) || !body.success) {
        res.status(400).json({ error: 'invalid request' });
        return;
      }
      const newLabel = body.data.label || null;
      const { rowsAffected, oldLabel } = await setRejectLabel(pool, id, newLabel, body.data.isPass ?? null);
      if (rowsAffected > 0) audit(req, 'reject_code.label', 'reject_code', id, `label "${oldLabel ?? '(none)'}" -> "${newLabel ?? '(none)'}"`);
      res.json({ updated: rowsAffected });
    } catch (err) {
      next(err);
    }
  });

  // weight consistency (Q4/Q5) — distribution, outliers, giveaway, basis toggle
  app.get('/api/weights', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z
        .object({ from: dateStr, to: dateStr, basis: z.enum(['as_recorded', 'gross', 'net']).default('as_recorded') })
        .safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const data = await getWeights(pool, cfg.lineId, q.data.basis as Basis, q.data.from, q.data.to);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // ---- Current Product (Q1) ----
  app.get('/api/products', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ products: await listProducts(pool) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/current-product', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ current: await getCurrent(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  // full changeover history — same rank as reading "current", since seeing
  // what ran when is a read, not a decision; setting it stays supervisor+ below
  app.get('/api/product-timeline', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ timeline: await listTimeline(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  // set the running product — supervisor+ (append-only timeline)
  app.post('/api/current-product', requireRole(2), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          productId: z.coerce.number().int().positive(),
          effectiveFrom: z.string().datetime().optional(),
          reason: z.string().max(255).optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'productId required' });
        return;
      }
      const user = (req as AuthedRequest).user!;
      const eff = body.data.effectiveFrom ? new Date(body.data.effectiveFrom) : new Date();
      const id = await setCurrent(pool, cfg.lineId, body.data.productId, eff, user.userId, body.data.reason ?? null);
      audit(req, 'product.changeover', 'product', body.data.productId, body.data.reason ?? null);
      res.json({ timelineId: id, current: await getCurrent(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Admin (admin only, rank 4) ----
  const ROLE_NAMES = z.enum(['operator', 'supervisor', 'manager', 'admin']);

  app.get('/api/admin/users', requireRole(4), async (_req, res, next) => {
    try { res.json({ users: await listUsers(pool) }); } catch (e) { next(e); }
  });
  app.post('/api/admin/users', requireRole(4), async (req, res, next) => {
    try {
      const b = z.object({ username: z.string().min(1).max(64), password: z.string().min(6), role: ROLE_NAMES, displayName: z.string().max(128).optional() }).safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid user' }); return; }
      await createUser(pool, b.data.username, b.data.password, b.data.role, b.data.displayName ?? null);
      audit(req, 'user.create', 'user', b.data.username, `role ${b.data.role}`);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.patch('/api/admin/users/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z.object({ active: z.boolean().optional(), role: ROLE_NAMES.optional() }).safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid' }); return; }
      const { oldActive, oldRole } = await updateUser(pool, id, b.data.active, b.data.role);
      const changes: string[] = [];
      if (b.data.active != null) changes.push(`active ${oldActive ?? '?'} -> ${b.data.active}`);
      if (b.data.role) changes.push(`role ${oldRole ?? '?'} -> ${b.data.role}`);
      audit(req, 'user.update', 'user', id, changes.join('; ') || null);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/admin/stations', requireRole(4), async (_req, res, next) => {
    try { res.json({ stations: await listStations(pool, cfg.lineId) }); } catch (e) { next(e); }
  });
  app.put('/api/admin/stations/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z.object({ name: z.string().max(64).nullable(), machine: z.string().max(64).nullable(), description: z.string().max(255).nullable() }).safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid' }); return; }
      const newName = b.data.name || null;
      const { oldName } = await setStation(pool, cfg.lineId, id, newName, b.data.machine || null, b.data.description || null);
      audit(req, 'station.rename', 'station', id, `name "${oldName ?? '(none)'}" -> "${newName ?? '(none)'}"`);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/admin/rules', requireRole(4), async (_req, res, next) => {
    try { res.json(await getRules(pool, cfg.lineId)); } catch (e) { next(e); }
  });
  app.post('/api/admin/rules/weight', requireRole(4), async (req, res, next) => {
    try {
      const b = z.object({ basis: z.enum(['as_recorded', 'gross', 'net']), coneTubeWeightG: z.coerce.number().nonnegative(), sackTareKg: z.coerce.number().nonnegative(), reason: z.string().max(255).optional() }).safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid' }); return; }
      await setWeightRule(pool, cfg.lineId, b.data.basis, b.data.coneTubeWeightG, b.data.sackTareKg, (req as AuthedRequest).user!.userId, b.data.reason ?? null);
      audit(req, 'rule.weight', 'weight_rule', cfg.lineId, `basis ${b.data.basis}, tube ${b.data.coneTubeWeightG}g, tare ${b.data.sackTareKg}kg`);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.post('/api/admin/rules/shift', requireRole(4), async (req, res, next) => {
    try {
      const b = z.object({ mode: z.enum(['corrected', 'legacy']), nightBelongsTo: z.enum(['start_day', 'calendar_day']), reason: z.string().max(255).optional() }).safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid' }); return; }
      await setShiftRule(pool, cfg.lineId, b.data.mode, b.data.nightBelongsTo, (req as AuthedRequest).user!.userId, b.data.reason ?? null);
      audit(req, 'rule.shift', 'shift_rule', cfg.lineId, `mode ${b.data.mode}, night belongs to ${b.data.nightBelongsTo}`);
      res.json({ ok: true, note: 'shift rule stored; rebuild canonical to apply to stored shift_code/shift_date' });
    } catch (e) { next(e); }
  });
  app.post('/api/admin/rules/plausibility', requireRole(4), async (req, res, next) => {
    try {
      const b = z
        .object({
          coneLoG: z.coerce.number().positive(),
          coneHiG: z.coerce.number().positive(),
          sackLoKg: z.coerce.number().positive(),
          sackHiKg: z.coerce.number().positive(),
          reason: z.string().max(255).optional(),
        })
        .refine((v) => v.coneLoG < v.coneHiG, { message: 'coneLoG must be less than coneHiG' })
        .refine((v) => v.sackLoKg < v.sackHiKg, { message: 'sackLoKg must be less than sackHiKg' })
        .safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid', detail: b.error.issues.map((i) => i.message) }); return; }
      await setPlausibilityRule(
        pool, cfg.lineId, b.data.coneLoG, b.data.coneHiG, b.data.sackLoKg, b.data.sackHiKg,
        (req as AuthedRequest).user!.userId, b.data.reason ?? null,
      );
      audit(req, 'rule.plausibility', 'plausibility_rule', cfg.lineId, `cone ${b.data.coneLoG}-${b.data.coneHiG}g, sack ${b.data.sackLoKg}-${b.data.sackHiKg}kg`);
      res.json({ ok: true, note: 'applies immediately to every SPC/weight query — read-time, not a rebuild' });
    } catch (e) { next(e); }
  });

  // audit log — admin only, read-only view of every write above
  app.get('/api/admin/audit', requireRole(4), async (_req, res, next) => {
    try { res.json({ entries: await listAudit(pool) }); } catch (e) { next(e); }
  });

  // JSON 404 for unmatched API routes
  app.use('/api', (_req: Request, res: Response) => res.status(404).json({ error: 'not found' }));

  // production single-service: serve the built React app if WEB_DIST is set/exists
  const webDist = process.env.WEB_DIST ?? join(process.cwd(), 'web', 'dist');
  if (existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    // SPA fallback for client-side routes (non-/api)
    app.get('*', (_req: Request, res: Response) => res.sendFile(join(webDist, 'index.html')));
  }

  // error handler — never leak internals
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('api error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
