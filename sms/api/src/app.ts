/** Express app factory. Routes mounted here; DB pool injected. */
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { z } from 'zod';
import type { ApiConfig } from './config.js';
import { envelope, type Envelope } from './envelope.js';
import { getOperations } from './services/operations.js';
import { getProduction, type GroupBy } from './services/production.js';
import { getRejectPareto, setRejectLabel } from './services/rejects.js';
import { getWeights, type Basis } from './services/weights.js';
import { listProducts, getCurrent, setCurrent, listTimeline } from './services/currentProduct.js';
import {
  listEvents, getEventDetail, exportEventsCsv, type EventType, type OutsideLimitsSegment,
} from './services/register.js';
import { getDowntime } from './services/downtime.js';
import { getSpec, getWeightSpc, type SpcType } from './services/spc.js';
import { getStationDrift, listCalibrationAdjustments, recordCalibrationAdjustment } from './services/calibration.js';
import { getRejectSpc, type RejectBucketSize, type RejectTypeFilter } from './services/rejectSpc.js';
import { getLive } from './services/live.js';
import { getAttention } from './services/attention.js';
import { loadProductTimeline, limitsOf, productDisagreement } from './services/productAt.js';
import { loadProductCatalogue } from './services/productLimits.js';
import { PdasWriter } from './services/pdasWrite.js';
import { plantNowMs } from './services/plantClock.js';
import { getWeightStations } from './services/weightStations.js';
import { getReport, resolvePeriod, REPORT_PERIODS, type ReportPeriod } from './services/report.js';
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
  // Caps the window at an INSTANT so a replay (?at=) shows only what existed
  // then. The route spreads parsed.data straight into getProduction and keys
  // its cache on the same object, so both follow automatically.
  tsTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
    .optional(),
  groupBy: z.enum(['day', 'shift', 'station', 'none']).default('day'),
});

export function createApp(pool: ConnectionPool, cfg: ApiConfig): Express {
  const app = express();
  app.use(securityHeaders());
  app.use(express.json());
  app.use(authMiddleware(pool)); // attaches req.user (or null) from session cookie
  // The PDAS write path (§5). Holds the ONLY writable IFL connection in the
  // API, opened lazily and only if PDAS_WRITE_ENABLED + a writer login are
  // configured; otherwise every write answers DISABLED with the reason.
  const pdas = new PdasWriter(pool, cfg.pdasWrite, cfg.lineId);

  // Access log for every non-2xx response except 304 (finding H10, Sep 2026
  // audit: there was previously no request/access log of any kind — a refused
  // or redirected request left no trace at all). 5xx is logged by the error
  // handler below instead, with the stack trace this line doesn't have.
  //
  // 304 is the one deliberate exclusion: the live screens poll every 10-60s
  // and a conditional GET answers 304 almost every time, so logging those
  // would bury real events under thousands of lines a day. Every other 3xx —
  // a genuine redirect — IS logged, because those are rare here and a
  // redirect nobody expected is exactly the kind of thing worth a trace.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (res.statusCode < 300 || res.statusCode >= 500 || res.statusCode === 304) return;
      const user = (req as AuthedRequest).user;
      console.error(
        `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms) user=${user?.username ?? 'anonymous'}`,
      );
    });
    next();
  });

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

  /**
   * The newest production day on record.
   *
   * Every default period anchors here rather than on today's date: on a server
   * whose source data has stopped, "today" is an empty screen and the newest
   * day is the honest answer.
   */
  async function newestProductionDay(): Promise<string> {
    const r = await pool
      .request()
      .input('line', mssql.Int, cfg.lineId)
      .query<{ d: string | null }>(
        'SELECT CONVERT(varchar(10), MAX(shift_date), 120) AS d FROM sms.cone_event WHERE line_id=@line',
      );
    return r.recordset[0]?.d ?? new Date().toISOString().slice(0, 10);
  }

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

  // ---- Live line state — polled every ~10 s by the floor screens and the wall display ----
  // Cached under the same short TTL as production so a room of wall screens
  // and floor PCs costs one set of queries per TTL, not one per viewer.
  const liveQuery = z.object({
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
      .optional(),
  });
  app.get('/api/live', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = liveQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      if (q.data.asOf && !cfg.liveAllowAsOf) {
        res.status(400).json({ error: 'asOf replay is disabled on this server (LIVE_ALLOW_AS_OF)' });
        return;
      }
      const asOfMs = q.data.asOf ? new Date(q.data.asOf).getTime() : undefined;
      const key = `live:${asOfMs ?? 'now'}`;
      const cached = prodCache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT').json(cached);
        return;
      }
      const data = await getLive(pool, cfg.lineId, cfg.lineName, { asOfMs });
      const env = await envelope(pool, cfg.lineId, data);
      prodCache.set(key, env);
      res.setHeader('X-Cache', 'MISS').json(env);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Station names, for every signed-in reader.
   *
   * These are LABELS — "East Conveyor", "Winder-5" — and every screen that
   * names a station needs them: the station row on Line, the station table on
   * Weight, the filter chip on Readings. They lived only behind the admin-only
   * /api/admin/stations, so the rest of the app could only ever say "Station 7"
   * and the count of stations was hardcoded in the web bundle. Writing them
   * stays admin; reading them cannot be.
   */
  app.get('/api/stations', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ stations: await listStations(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * "Does anything need attention?" — at most three sentences for the Line
   * screen, from three sources that each answer a requirement line.
   *
   * The period governs only the outside-limits count. Station drift and reject
   * rises are judged over a FIXED trailing window ending at the newest
   * production day, because those tests run on daily means and one shift is one
   * point; the response states the window so the screen can say so too.
   */
  const attentionQuery = z.object({
    from: dateStr,
    to: dateStr,
    shift: z.enum(['morning', 'evening', 'night']).optional(),
    trailingDays: z.coerce.number().int().min(1).max(90).default(14),
  });
  app.get('/api/attention', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = attentionQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const newest = await newestProductionDay();
      const to = q.data.to ?? newest;
      const from = q.data.from ?? to;
      const bad = validateRange(from, to);
      if (bad) {
        res.status(400).json({ error: bad });
        return;
      }
      const trailingTo = newest;
      const trailingFrom = new Date(new Date(`${trailingTo}T12:00:00Z`).getTime() - (q.data.trailingDays - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const key = `attention:${from}:${to}:${q.data.shift ?? 'all'}:${trailingFrom}:${trailingTo}`;
      const cached = prodCache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT').json(cached);
        return;
      }
      const data = await getAttention(
        pool,
        cfg.lineId,
        { from: trailingFrom, to: trailingTo },
        { from, to, shift: q.data.shift ?? null },
      );
      const env = await envelope(pool, cfg.lineId, data);
      prodCache.set(key, env);
      res.setHeader('X-Cache', 'MISS').json(env);
    } catch (err) {
      next(err);
    }
  });

  /**
   * The product in force at a given moment, and its limits — never "the
   * product recorded today, applied to whatever you are looking at".
   *
   * Without `at`, answers for the newest reading, which is what the Line and
   * Weight screens mean by "the product running".
   */
  const productAtQuery = z.object({
    at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
      .optional(),
    /**
     * The reading's OWN product — IFL's MaterialId, stamped on every row since
     * their 2026-08-05 rebuild. When given, the answer is that product's label
     * and its limits in force at `at`, and the line-wide timeline is not
     * consulted: six materials run concurrently on different machines, so the
     * timeline is the wrong question for a reading that knows its product.
     * Without it, the timeline is the only attribution there is (pre-MaterialId
     * rows), as before.
     */
    productId: z.coerce.number().int().positive().optional(),
    /**
     * The reading's weight in grams. With it, the response carries the
     * verdict — inside the limits, or by how much outside — computed by the
     * same ProductTimeline.verdict() the register and the attention list use.
     * Until 14 Sep 2026 the reading sheet re-derived this in the browser with
     * its own copy of the comparison, which is exactly the "two places answer
     * one question" rule REDESIGN.md forbids.
     */
    weightG: z.coerce.number().optional(),
  });
  app.get('/api/product-at', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = productAtQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const [timeline, catalogue] = await Promise.all([
        loadProductTimeline(pool, cfg.lineId),
        loadProductCatalogue(pool),
      ]);
      let atMs: number;
      if (q.data.at) {
        atMs = new Date(q.data.at).getTime();
      } else {
        const r = await pool
          .request()
          .input('line', mssql.Int, cfg.lineId)
          .query<{ ms: string | number | null }>(
            'SELECT MAX(production_ts_utc_ms) AS ms FROM sms.cone_event WHERE line_id=@line',
          );
        // Finding M5 (Sep 2026 audit): the empty-database fallback used raw
        // Date.now() — genuine UTC — against a timeline whose effectiveFromMs
        // values are on the production-time convention (plant wall clock
        // labelled UTC). Off by the plant's UTC offset. Only reachable before
        // any cone has ever synced for this line.
        atMs = r.recordset[0]?.ms != null ? Number(r.recordset[0]!.ms) : plantNowMs();
      }
      // One implementation of "which product, which limits, inside or not":
      // ProductTimeline.verdict() — row attribution first (the reading's own
      // MaterialId), the line-wide timeline second, limits from the versioned
      // history at that instant rather than the mirror's current values.
      // This route used to hand-roll the first two steps itself and leave the
      // third to the browser.
      const v = timeline.verdict(atMs, q.data.weightG ?? null, { productId: q.data.productId ?? null, catalogue });
      res.json({
        at: new Date(atMs).toISOString(),
        product: v.product,
        limits: v.limits,
        /** 'row' = the reading's own MaterialId; 'timeline' = the hand-entered line-wide product. */
        attribution: v.attribution,
        /** Only when weightG was given: the judgement, or why there is none. */
        verdict:
          q.data.weightG == null
            ? null
            : { inside: v.inside, outsideByG: v.outsideByG, reason: v.reason },
        /** The limits are the oldest version known and the instant predates it. */
        limitsAreLowerBound: v.limitsAreLowerBound,
        /** True when nothing has ever been recorded, so a screen says it once. */
        neverRecorded: timeline.isEmpty,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * The station table, and the one sentence that goes above it.
   *
   * `from`/`to` are the TRAILING window the drift test needs (14 production
   * days by default), not the selected period — a shift is a single daily mean
   * and no pattern can be measured from one point. The period is passed
   * separately, and governs only the count of cones the scale passed that sit
   * outside the product's limits.
   */
  const weightStationsQuery = z.object({
    from: dateStr,
    to: dateStr,
    periodFrom: dateStr,
    periodTo: dateStr,
    shift: z.enum(['morning', 'evening', 'night']).optional(),
    trailingDays: z.coerce.number().int().min(1).max(90).default(14),
  });
  app.get('/api/weight-stations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = weightStationsQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const newest = await newestProductionDay();
      const to = q.data.to ?? newest;
      const from =
        q.data.from ??
        new Date(new Date(`${to}T12:00:00Z`).getTime() - (q.data.trailingDays - 1) * 86_400_000)
          .toISOString()
          .slice(0, 10);
      const bad = validateRange(from, to);
      if (bad) {
        res.status(400).json({ error: bad });
        return;
      }
      const periodTo = q.data.periodTo ?? to;
      const periodFrom = q.data.periodFrom ?? periodTo;

      const key = `wstations:${from}:${to}:${periodFrom}:${periodTo}:${q.data.shift ?? 'all'}`;
      const cached = prodCache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT').json(cached);
        return;
      }
      const [timeline, catalogue] = await Promise.all([
        loadProductTimeline(pool, cfg.lineId),
        loadProductCatalogue(pool),
      ]);
      const [stations, disagreement] = await Promise.all([
        getWeightStations(pool, cfg.lineId, from, to),
        productDisagreement(
          pool,
          cfg.lineId,
          timeline,
          { from: periodFrom, to: periodTo, shift: q.data.shift ?? null },
          catalogue,
        ),
      ]);
      const env = await envelope(pool, cfg.lineId, { ...stations, disagreement });
      prodCache.set(key, env);
      res.setHeader('X-Cache', 'MISS').json(env);
    } catch (err) {
      next(err);
    }
  });

  // ---- Production report — the period summary (IFL requirement: "comprehensive reporting") ----
  const reportQuery = z.object({
    period: z.enum(REPORT_PERIODS).default('day'),
    /** Day the period is derived from. Defaults to the newest production day. */
    anchor: dateStr,
    from: dateStr,
    to: dateStr,
  });
  app.get('/api/report', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = reportQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      const { period } = q.data;
      if (period === 'custom' && (!q.data.from || !q.data.to)) {
        res.status(400).json({ error: 'custom period requires from and to' });
        return;
      }
      if (q.data.from && q.data.to) {
        const bad = validateRange(q.data.from, q.data.to);
        if (bad) {
          res.status(400).json({ error: bad });
          return;
        }
      }
      // Anchor defaults to the newest production day, so a bare /api/report
      // answers "the latest day" rather than whatever today happens to be on a
      // server whose source data has stopped.
      const anchor = q.data.anchor ?? (await newestProductionDay());
      const resolved = resolvePeriod(period as ReportPeriod, anchor, q.data.from, q.data.to);
      const spanBad = validateRange(resolved.from, resolved.to);
      if (spanBad) {
        res.status(400).json({ error: spanBad });
        return;
      }
      const key = `report:${JSON.stringify(resolved)}`;
      const cached = prodCache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT').json(cached);
        return;
      }
      const data = await getReport(pool, cfg.lineId, resolved);
      const env = await envelope(pool, cfg.lineId, data);
      prodCache.set(key, env);
      res.setHeader('X-Cache', 'MISS').json(env);
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
      const spec = await getSpec(pool, q.data.productId ?? null, q.data.usl ?? null, q.data.lsl ?? null, q.data.type, { from: q.data.from, to: q.data.to });
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
    // Finding H4 (Sep 2026 audit): cones the scale passed but a product's own
    // limits would not — cone only, resolved to segments below.
    outsideProductLimits: z.enum(['true']).optional(),
    sort: z.enum(['time', 'weight']).default('time'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  });

  /**
   * The product timeline's usable-limits stretches, in the shape register.ts's
   * outsideLimitsSegments filter needs. Segments with no usable limits
   * (no product recorded, or a product with no setpoint/offsets) are dropped
   * rather than treated as "anything goes" — an unjudgeable cone is neither
   * inside nor outside a limit that does not exist.
   */
  async function outsideLimitsSegmentsFor(): Promise<OutsideLimitsSegment[]> {
    const [timeline, catalogue] = await Promise.all([
      loadProductTimeline(pool, cfg.lineId),
      loadProductCatalogue(pool),
    ]);
    const asc = [...timeline.entries].sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
    const segments: OutsideLimitsSegment[] = [];
    for (let i = 0; i < asc.length; i++) {
      const seg = asc[i]!;
      // Limits as they stood when this segment began, not as the mirror holds
      // them today. Segments follow the line-wide timeline, which is the only
      // attribution readings from before MaterialId existed can have.
      const limits = catalogue.limitsAt(seg.productId, seg.effectiveFromMs) ?? limitsOf(seg);
      if (!limits) continue;
      segments.push({
        fromMs: seg.effectiveFromMs,
        toMs: asc[i + 1]?.effectiveFromMs ?? null,
        loG: limits.loG,
        hiG: limits.hiG,
      });
    }
    return segments;
  }

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
      const outsideLimitsSegments =
        q.outsideProductLimits && q.type === 'cone' ? await outsideLimitsSegmentsFor() : undefined;
      const data = await listEvents(pool, cfg.lineId, q.type as EventType, { ...q, ...pageQ.data, outsideLimitsSegments });
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
      const outsideLimitsSegments =
        q.outsideProductLimits && q.type === 'cone' ? await outsideLimitsSegmentsFor() : undefined;
      const { csv, truncated } = await exportEventsCsv(pool, cfg.lineId, q.type as EventType, { ...q, outsideLimitsSegments });
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
      // isPass is passed through as-is: undefined means "not this time".
      const { rowsAffected, oldLabel, oldIsPass } = await setRejectLabel(pool, id, newLabel, body.data.isPass);
      if (rowsAffected > 0) {
        const passNote = body.data.isPass === undefined ? '' : `, is_pass ${String(oldIsPass)} -> ${String(body.data.isPass)}`;
        audit(req, 'reject_code.label', 'reject_code', id, `label "${oldLabel ?? '(none)'}" -> "${newLabel ?? '(none)'}"${passNote}`);
      }
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

  // ---- Calibration advisory (Phase 5) — cone only, same restriction as per-station SPC ----
  app.get('/api/calibration', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = z.object({ from: dateStr, to: dateStr }).safeParse(req.query);
      if (!q.success || !q.data.from || !q.data.to) {
        res.status(400).json({ error: 'from and to are required' });
        return;
      }
      const rangeErr = validateRange(q.data.from, q.data.to);
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const plausibility = await getPlausibilityRule(pool, cfg.lineId);
      const data = await getStationDrift(pool, cfg.lineId, q.data.from, q.data.to, plausibility);
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/calibration/adjustments', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ adjustments: await listCalibrationAdjustments(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  // logging an adjustment is a decision, same rank as setting the current product (Q1)
  app.post('/api/calibration/adjustments', requireRole(2), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          stationId: z.coerce.number().int().positive().optional(),
          adjustedAt: z.string().datetime().optional(),
          reason: z.string().max(255).optional(),
          note: z.string().max(500).optional(),
          // Signed grams the scale was moved by (finding M9) — positive =
          // now reads heavier, negative = lighter.
          amountG: z.coerce.number().optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'invalid request' });
        return;
      }
      // same class of gate as product changeover: no FK backs station_id, so
      // an unknown station would land in the ledger unchallenged
      if (body.data.stationId != null) {
        const known = await pool.request().input('line', mssql.Int, cfg.lineId).input('id', mssql.Int, body.data.stationId)
          .query<{ n: number }>(`SELECT COUNT(*) n FROM sms.station WHERE line_id=@line AND station_id=@id`);
        if (!known.recordset[0]?.n) {
          res.status(400).json({ error: `no station ${body.data.stationId} on this line` });
          return;
        }
      }
      const user = (req as AuthedRequest).user!;
      const adjustedAt = body.data.adjustedAt ? new Date(body.data.adjustedAt) : new Date();
      const id = await recordCalibrationAdjustment(
        pool, cfg.lineId, body.data.stationId ?? null, adjustedAt, user.userId,
        body.data.reason ?? null, body.data.note ?? null, body.data.amountG ?? null,
      );
      audit(
        req, 'calibration.adjustment', 'station', body.data.stationId ?? 'line-wide',
        body.data.reason ?? body.data.note ?? null,
      );
      res.json({ adjustmentId: id, adjustments: await listCalibrationAdjustments(pool, cfg.lineId) });
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
      // The timeline has no FK to sms.product (append-only design), so this is
      // the only gate — without it a typo'd id becomes the line's "current
      // product", with a broken label and no setpoint (proven live in the Aug
      // 2026 audit: productId 4242 was accepted and displayed as "Product 4242").
      const known = await pool.request().input('id', mssql.Int, body.data.productId)
        .query<{ n: number }>(`SELECT COUNT(*) n FROM sms.product WHERE product_id=@id`);
      if (!known.recordset[0]?.n) {
        res.status(400).json({ error: `unknown productId ${body.data.productId}` });
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

  // ---- PDAS write path: product Add / Retire / Change limits (§5) ----
  // Rank 3 (manager). These change what the scale ACCEPTS, not what a report
  // is labelled — heavier than /api/current-product's rank 2. The status
  // endpoint is open to any signed-in user so the screen can be read-only and
  // say why, instead of offering a button that can only answer 503.
  app.get('/api/product-write/status', async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    res.json({
      enabled: pdas.enabled,
      reason: pdas.disabledReason,
      canWrite: Boolean(user) && (user?.rank ?? 0) >= 3 && pdas.enabled,
    });
  });

  // The pickers for "Create a new product": the mirrored reference tables.
  app.get('/api/product-options', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [b, c, t] = await Promise.all([
        pool.request().query<{ id: number; name: string }>(`SELECT blend_id id, blend name FROM sms.blend ORDER BY blend`),
        pool.request().query<{ id: number; name: string }>(`SELECT count_id id, count_text name FROM sms.yarn_count ORDER BY count_val, count_text`),
        pool.request().query<{ id: number; name: string; tubeWeightG: number | null }>(
          `SELECT tube_type_id id, tube_type name, tube_weight_g tubeWeightG FROM sms.tube_type ORDER BY tube_type`,
        ),
      ]);
      res.json({ blends: b.recordset, counts: c.recordset, tubeTypes: t.recordset });
    } catch (err) {
      next(err);
    }
  });

  const productFields = z.object({
    setpointG: z.coerce.number().positive(),
    offsetMinusG: z.coerce.number().min(0),
    offsetPlusG: z.coerce.number().min(0),
    desc1: z.string().max(255).nullable().optional().transform((v) => v ?? null),
    desc2: z.string().max(255).nullable().optional().transform((v) => v ?? null),
    // z.boolean(), not z.coerce.boolean(): coerce is Boolean(value), so the
    // string "false" became true. On the retire route that is the difference
    // between retiring a product and re-activating it.
    active: z.boolean(),
  });
  const writeReason = z.string().min(10).max(255);
  const setpointBounds = async () => {
    const p = await getPlausibilityRule(pool, cfg.lineId);
    return { setpointLoG: p.coneLoG, setpointHiG: p.coneHiG };
  };
  const actorOf = (req: Request) => {
    const u = (req as AuthedRequest).user!;
    return { userId: u.userId, username: u.username };
  };
  const writeStatus = (code: string): number =>
    code === 'DISABLED' ? 503 : code === 'CONFLICT' ? 409 : code === 'IMPLAUSIBLE' ? 400 : code === 'NOT_FOUND' ? 404 : code === 'PDAS_ERROR' ? 422 : 500;

  app.post('/api/products', requireRole(3), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = z
        .object({
          blendId: z.coerce.number().int().positive(),
          countId: z.coerce.number().int().positive(),
          tubeTypeId: z.coerce.number().int().positive(),
          fields: productFields,
          reason: writeReason,
        })
        .safeParse(req.body);
      if (!b.success) {
        res.status(400).json({ error: 'invalid product', detail: b.error.flatten().fieldErrors });
        return;
      }
      const r = await pdas.createProduct({ ...b.data, bounds: await setpointBounds(), actor: actorOf(req) });
      if (!r.ok) {
        res.status(writeStatus(r.code)).json({ error: r.message, code: r.code, pdasErrorCode: r.pdasErrorCode ?? null });
        return;
      }
      res.json({ productId: r.productId, products: await listProducts(pool) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/products/:id/active', requireRole(3), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.coerce.number().int().positive().safeParse(req.params.id);
      const b = z.object({ active: z.boolean(), reason: writeReason }).safeParse(req.body);
      if (!id.success || !b.success) {
        res.status(400).json({ error: 'productId, active and a reason of at least 10 characters are required' });
        return;
      }
      const r = await pdas.setProductActive({ productId: id.data, active: b.data.active, reason: b.data.reason, actor: actorOf(req) });
      if (!r.ok) {
        res.status(writeStatus(r.code)).json({ error: r.message, code: r.code, pdasErrorCode: r.pdasErrorCode ?? null });
        return;
      }
      res.json({ productId: r.productId, active: r.active, products: await listProducts(pool) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/products/:id/limits', requireRole(3), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.coerce.number().int().positive().safeParse(req.params.id);
      const b = z.object({ before: productFields, after: productFields, reason: writeReason }).safeParse(req.body);
      if (!id.success || !b.success) {
        res.status(400).json({ error: 'productId, before, after and a reason of at least 10 characters are required' });
        return;
      }
      const r = await pdas.updateProductLimits({
        productId: id.data,
        before: b.data.before,
        after: b.data.after,
        bounds: await setpointBounds(),
        reason: b.data.reason,
        actor: actorOf(req),
      });
      if (!r.ok) {
        res.status(writeStatus(r.code)).json({ error: r.message, code: r.code, pdasErrorCode: r.pdasErrorCode ?? null });
        return;
      }
      res.json({ productId: r.productId, observedAfter: r.observedAfter, products: await listProducts(pool) });
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
      try {
        await createUser(pool, b.data.username, b.data.password, b.data.role, b.data.displayName ?? null);
      } catch (e) {
        // unique-key violation on username → a clear 409, not a generic 500
        const n = (e as { number?: number }).number;
        if (n === 2627 || n === 2601) {
          res.status(409).json({ error: `username "${b.data.username}" already exists` });
          return;
        }
        throw e;
      }
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
      const { updated, oldName } = await setStation(pool, cfg.lineId, id, newName, b.data.machine || null, b.data.description || null);
      // a nonexistent station used to return ok:true AND write a phantom
      // audit entry — found live in the Aug 2026 audit (PUT /stations/999)
      if (!updated) {
        res.status(404).json({ error: `no station ${id} on this line` });
        return;
      }
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
      // Finding H5 (Sep 2026 audit): this note used to say "rebuild canonical
      // to apply" while the transform actually read a static env var and
      // never this table at all — a rebuild silently re-derived the OLD
      // rule. runTransform.ts now resolves night_belongs_to from this table
      // fresh every pass, so the note is now true: new syncs pick it up
      // immediately, and a rebuild is only needed to recompute what is
      // already stored. The corrected/legacy `mode` itself remains recorded
      // but not yet applied anywhere — Q7 (fix vs reproduce) is still open.
      res.json({
        ok: true,
        rebuildRequired: true,
        note:
          'Night-attribution rule stored. The transform picks it up on its NEXT pass, so from now on new rows ' +
          'are stamped under the new rule while everything already in canonical keeps the old one — until you ' +
          'rebuild, one table holds two attribution regimes and every shift_date figure blends them. ' +
          'Run: sms rebuild --table=cone_event --snapshot-id=<id> (and the same for sack_event and reject_event). ' +
          'The corrected/legacy mode is recorded for when Q7 is resolved; it does not change shift_code yet.',
      });
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
  //
  // resolve(), not the raw value: res.sendFile REFUSES a relative path
  // ("path must be absolute or specify root"), and DEPLOY.md's own setup step
  // tells operators to set `WEB_DIST=./web/dist`. express.static tolerates a
  // relative path, so the app looked fine — assets loaded — while every request
  // that fell through to the SPA fallback answered 500. Found by running the
  // built stack with the documented value (Sep 2026 audit follow-up).
  const webDist = resolve(process.env.WEB_DIST ?? join(process.cwd(), 'web', 'dist'));
  if (existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    // SPA fallback for client-side routes (non-/api)
    app.get('*', (_req: Request, res: Response) => res.sendFile(join(webDist, 'index.html')));
  }

  // Error handler — never leak internals to the client, but log everything an
  // on-call engineer needs at 2am. Previously logged only err.message with no
  // request, no path and no stack (finding H10, Sep 2026 audit) — the entire
  // diagnostic artifact for a 500 was a bare one-line message.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    console.error(
      `api error: ${req.method} ${req.originalUrl} user=${user?.username ?? 'anonymous'}`,
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
