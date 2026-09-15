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
import { getRejectPareto, listRejectCodes, updateRejectCode, REJECT_SEVERITIES, parseCodeParam } from './services/rejects.js';
import { getWeights, type Basis } from './services/weights.js';
import { listProducts, getCurrent, setCurrent, listTimeline } from './services/currentProduct.js';
import {
  listEvents, getEventDetail, exportEventsCsv, type EventType,
} from './services/register.js';
import { loadStateContext, parseStates } from './services/coneState.js';
import { getDowntime } from './services/downtime.js';
import { getSpec, getWeightSpc, type SpcType } from './services/spc.js';
import { adjustmentRestarts, getStationDrift, listCalibrationAdjustments, recordCalibrationAdjustment } from './services/calibration.js';
import { getRejectSpc, type RejectBucketSize, type RejectTypeFilter } from './services/rejectSpc.js';
import { getLive, invalidateLiveConfigCache } from './services/live.js';
import { getAttention } from './services/attention.js';
import { loadProductTimeline, productDisagreement } from './services/productAt.js';
import { loadProductCatalogue } from './services/productLimits.js';
import { PdasWriter } from './services/pdasWrite.js';
import { plantNowMs, plantOffsetMinutes } from './services/plantClock.js';
import { getWeightStations } from './services/weightStations.js';
import { getReport, resolvePeriod, REPORT_PERIODS, type ReportPeriod } from './services/report.js';
import {
  listUsers, createUser, updateUser,
  listStations, setStation,
  getRules, setWeightRule, setShiftRule,
  getPlausibilityRule, setPlausibilityRule,
} from './services/admin.js';
import {
  getLineConfig, getLineIdentity, listMachines, createMachine, updateMachine, createStation,
  updateLine, listSources, updateDataSource, updateSourceTable, SOURCE_TABLE_NAME,
} from './services/lineConfig.js';
import { recordAudit, recordAuditIn, auditedWrite, listAuditPage } from './services/audit.js';
import { getHealth } from './services/health.js';
import { LastAdminError, passwordPolicyProblem } from './services/admin.js';
import { shiftBoundariesFrom } from '@sms/shared';
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
import { requestId, requestLog } from './log.js';
import { mountConeRoutes } from './routes/cone.js';
import { mountRejectsRoutes } from './routes/rejects.js';
import { mountOpsRoutes } from './routes/ops.js';
import { mountReportsRoutes } from './routes/reports.js';
import { mountCalibrationRoutes } from './routes/calibration.js';
import { mountSacksRoutes } from './routes/sacks.js';

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
  // First, so every later line about this request — access log, 500, auth
  // warning — carries the same correlationId (roadmap Phase 2 item 6).
  app.use(requestId());
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
  //
  // One JSON line since 14 Sep 2026 (roadmap Phase 2 item 6): the sentence is
  // still the `msg`, and the same facts are fields beside it so a refused
  // request can be found by status or by user without parsing prose. A 4xx is
  // `warn` (something was refused), a 3xx `info` (something was redirected).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (res.statusCode < 300 || res.statusCode >= 500 || res.statusCode === 304) return;
      const user = (req as AuthedRequest).user?.username ?? 'anonymous';
      const durationMs = Date.now() - startedAt;
      const fields = { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs, user };
      const msg = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms) user=${user}`;
      if (res.statusCode >= 400) requestLog(req).warn(msg, fields);
      else requestLog(req).info(msg, fields);
    });
    next();
  });

  const prodCache = new TtlCache<Envelope<unknown>>(cfg.cacheTtlSeconds * 1000);
  const loginLimiter = new LoginRateLimiter();

  // Fire-and-forget audit write, for events that are NOT configuration: a
  // product changeover or a calibration entry already versioned in its own
  // table, an export. The primary action has already succeeded by the time
  // this is called, and there is no transaction spanning both, so a logging
  // failure must never fail the request that triggered it. It must also never
  // vanish silently — a broken audit trail is itself a finding — so failures
  // go to the log instead of a swallowed catch.
  //
  // CONFIGURATION writes do not use this. Rules, the line, machines, stations,
  // sources, reject codes and users go through auditedWrite() (services/
  // audit.ts), which commits the change and its audit row in one transaction:
  // the gap analysis found that with this helper "a rule change can commit
  // while its audit row fails", and roadmap Phase 1 accepts only changes that
  // are audited where they affect production calculations.
  function audit(req: Request, action: string, targetType: string, targetId: string | number | null, detail: string | null): void {
    const actorId = (req as AuthedRequest).user?.userId;
    if (actorId == null) return;
    void recordAudit(pool, actorId, action, targetType, targetId, detail).catch((e) =>
      requestLog(req).error(`audit: failed to record ${action}`, { action, targetType, targetId, actorId, err: e }),
    );
  }
  const actorId = (req: Request): number => (req as AuthedRequest).user!.userId;
  /** SQL Server unique-key violation (2627 = unique constraint, 2601 = unique index). */
  const isUniqueViolation = (e: unknown): boolean => {
    const n = (e as { number?: number }).number;
    return n === 2627 || n === 2601;
  };
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

  // health — no envelope; unauthenticated for a monitor probe. Service,
  // database and acquisition separated since roadmap Phase 11 (14 Sep 2026);
  // the database size and the acquisition details are nulled for an
  // anonymous caller (services/health.ts). Never 500: a dead database is
  // `status: 'down'` with 503, which is the answer a probe is asking for.
  app.get('/api/health', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await getHealth(pool, {
        lineId: cfg.lineId,
        backupDir: cfg.backupDir ?? 'C:\\sms-backups',
        authenticated: (req as AuthedRequest).user != null,
      });
      res.status(report.status === 'down' ? 503 : 200).json(report);
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
        // Audited since roadmap Phase 11 (14 Sep 2026): the username tried
        // and nothing else — never the password, and no actor, because the
        // name may not be an account at all. Fire-and-forget like every
        // event row; a failed audit write must not change the 401.
        void recordAudit(pool, null, 'auth.login_failed', 'user', body.data.username.slice(0, 64), `from ${req.ip ?? 'unknown'}`).catch((e) =>
          requestLog(req).error('audit: failed to record auth.login_failed', { err: e }),
        );
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      loginLimiter.clear(ipKey);
      loginLimiter.clear(userKey);
      const s = await createSession(pool, user.userId);
      setSessionCookie(res, s.id, s.expires, req);
      res.json({ user: { username: user.username, displayName: user.displayName, role: user.role } });
      // req.user is not set on this request (the session was just minted), so
      // the actor is passed explicitly rather than through audit().
      void recordAudit(pool, user.userId, 'auth.login', 'user', user.userId, `from ${req.ip ?? 'unknown'}`).catch((e) =>
        requestLog(req).error('audit: failed to record auth.login', { err: e }),
      );
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
      // Before the response: audit() reads req.user, which authMiddleware set
      // from the cookie this request arrived with (roadmap Phase 11).
      audit(req, 'auth.logout', 'user', (req as AuthedRequest).user?.userId ?? null, null);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    res.json({ user: user ? { username: user.username, displayName: user.displayName, role: user.role } : null });
  });

  // ---- everything below requires an authenticated user (viewer+) ----
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
    // Every screen's station list: ACTIVE stations only. A station retired in
    // Setup (is_active = 0, roadmap Phase 1) must leave the filters and the
    // station table without a code change; the admin listing under
    // /api/admin/stations still shows it so it can be reactivated.
    try {
      const all = await listStations(pool, cfg.lineId);
      res.json({ stations: all.filter((s) => s.isActive) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * The installation as configured (roadmap Phase 1, migration 028): the line
   * with its unit and plant, every line known (one today — Q14), the line's
   * machines, and its stations with the machine each is linked to. Read by
   * every signed-in account, because the names on every screen come from
   * here; edited only through /api/admin/*.
   */
  app.get('/api/config', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getLineConfig(pool, cfg.lineId));
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
    /**
     * The scale's own in-range bit (roadmap Phase 4, 14 Sep 2026). With it and
     * weightG, the verdict carries the five-state classification
     * (shared/src/domain/classification.ts) beside the older inside/outsideByG
     * facts, judged with the plausibility rule on file.
     */
    inRange: z.enum(['true', 'false']).optional(),
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
      const plaus = await getPlausibilityRule(pool, cfg.lineId);
      const v = timeline.verdict(atMs, q.data.weightG ?? null, {
        productId: q.data.productId ?? null,
        catalogue,
        inRange: q.data.inRange == null ? null : q.data.inRange === 'true',
        plausibility: { loG: plaus.coneLoG, hiG: plaus.coneHiG },
      });
      res.json({
        at: new Date(atMs).toISOString(),
        product: v.product,
        limits: v.limits,
        /** 'row' = the reading's own MaterialId; 'timeline' = the hand-entered line-wide product. */
        attribution: v.attribution,
        /** Only when weightG was given: the judgement, or why there is none. `state` is the one classification (Phase 4). */
        verdict:
          q.data.weightG == null
            ? null
            : { inside: v.inside, outsideByG: v.outsideByG, reason: v.reason, state: v.state, scalePassed: v.scalePassed, unknownReason: v.unknownReason },
        /** The plausibility window the state was judged with (the rule on file; not yet confirmed by IFL). */
        plausibility: { loG: plaus.coneLoG, hiG: plaus.coneHiG },
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
      // Lazy: only ask the database for the newest production day when the
      // caller did not supply `to` — this used to run unconditionally and
      // throw the answer away whenever `to` was already given (T3, 15 Sep
      // 2026; app.routes.test.ts pins this: with `to` explicit, the
      // MAX(shift_date) query must never be issued).
      const to = q.data.to ?? (await newestProductionDay());
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
    /** Roadmap Phase 8 (15 Sep 2026): one shift across the period's days; "This shift" used to print the whole day. */
    shift: z.enum(['morning', 'evening', 'night']).optional(),
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
      const key = `report:${JSON.stringify(resolved)}:${q.data.shift ?? 'all'}`;
      const cached = prodCache.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT').json(cached);
        return;
      }
      const data = await getReport(pool, cfg.lineId, resolved, q.data.shift ?? null);
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
        // Cones per classification state, always (roadmap Phase 4, 14 Sep 2026).
        withStates: true,
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
          /** One station's stream (cone only; roadmap Phase 4, 14 Sep 2026). */
          station: z.coerce.number().int().positive().optional(),
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
      const data = await getWeightSpc(pool, cfg.lineId, q.data.type as SpcType, q.data.from, q.data.to, spec, plausibility, q.data.shift ?? null, q.data.station ?? null);
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
          // Roadmap Phase 5 (14 Sep 2026): shift + tsTo so the Rejects headline
          // counts the SAME rejects Line counts for the same period; station,
          // product and code are the drilldown dimensions. `code` is
          // `weight` or `<tube>-<material>` (rejects.ts parseCodeParam).
          shift: z.enum(['morning', 'evening', 'night']).optional(),
          tsTo: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp').optional(),
          station: z.coerce.number().int().positive().optional(),
          product: z.coerce.number().int().positive().optional(),
          code: z.string().max(24).optional(),
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
      const code = q.data.code == null ? undefined : parseCodeParam(q.data.code);
      if (code === null) {
        res.status(400).json({ error: 'invalid code — expected weight or <tube>-<material>' });
        return;
      }
      const bucket: RejectBucketSize = q.data.bucket ?? (q.data.from === q.data.to ? 'hour' : 'day');
      const data = await getRejectSpc(pool, cfg.lineId, q.data.from, q.data.to, bucket, q.data.rejectType as RejectTypeFilter, {
        shift: q.data.shift, tsTo: q.data.tsTo, station: q.data.station, product: q.data.product, code,
      });
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
    // limits would not — cone only. Since roadmap Phase 4 (14 Sep 2026) an
    // alias for `state=low,high`: the scale's bit governs 'rejected', so a
    // passed-but-outside cone is exactly a 'low' or 'high' one.
    outsideProductLimits: z.enum(['true']).optional(),
    /** Comma list of the five states (cone only): within,low,high,rejected,unknown. */
    state: z.string().max(64).optional(),
    /** The reading's own material_id (cone + reject). */
    product: z.coerce.number().int().positive().optional(),
    sort: z.enum(['time', 'weight']).default('time'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  });

  /**
   * Cone listings judge every row by the ONE classification (roadmap Phase 4,
   * 14 Sep 2026): the plausibility rule plus every limits window on record,
   * loaded once per request and handed to register.ts, which builds the
   * state column and the state filter from it. Sacks and rejects have no
   * classification and get none.
   */
  async function registerClassification(q: { type: string; state?: string; outsideProductLimits?: 'true' }) {
    if (q.type !== 'cone') return { classification: undefined, states: undefined };
    const classification = await loadStateContext(pool, cfg.lineId);
    const states = parseStates(q.state) ?? (q.outsideProductLimits ? (['low', 'high'] as const) : null);
    return { classification, states: states == null ? undefined : [...states] };
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
      const { classification, states } = await registerClassification(q);
      const data = await listEvents(pool, cfg.lineId, q.type as EventType, { ...q, ...pageQ.data, classification, states });
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
      const { classification, states } = await registerClassification(q);
      const { csv, truncated } = await exportEventsCsv(pool, cfg.lineId, q.type as EventType, { ...q, classification, states });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${q.type}-events.csv"`);
      if (truncated) res.setHeader('X-Export-Truncated', 'true');
      res.send(csv);
      // Which register left the building, and for what window (roadmap Phase
      // 11, 14 Sep 2026). An event, not configuration: fire-and-forget.
      audit(req, 'export.csv', 'register', q.type, `${q.from ?? '…'} to ${q.to ?? '…'}${truncated ? ' (truncated)' : ''}`);
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
      // A cone's sheet carries its state from the same rule as the list (Phase 4).
      const classification = type === 'cone' ? await loadStateContext(pool, cfg.lineId) : undefined;
      const row = await getEventDetail(pool, cfg.lineId, type, id, classification);
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
      // Roadmap Phase 5 (14 Sep 2026): the same filter set as /api/reject-spc
      // and /api/rejects/by-day-code (routes/rejects.ts), bound by one function.
      const q = z.object({
        from: dateStr,
        to: dateStr,
        shift: z.enum(['morning', 'evening', 'night']).optional(),
        tsTo: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp').optional(),
        station: z.coerce.number().int().positive().optional(),
        product: z.coerce.number().int().positive().optional(),
        code: z.string().max(24).optional(),
      }).safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      // Capped like every other analytics range (MAX_RANGE_DAYS); this route
      // had no cap at all until 14 Sep 2026.
      const rangeErr = q.data.from && q.data.to ? validateRange(q.data.from, q.data.to) : null;
      if (rangeErr) {
        res.status(400).json({ error: rangeErr });
        return;
      }
      const code = q.data.code == null ? undefined : parseCodeParam(q.data.code);
      if (code === null) {
        res.status(400).json({ error: 'invalid code — expected weight or <tube>-<material>' });
        return;
      }
      const data = await getRejectPareto(pool, cfg.lineId, { ...q.data, code });
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // the line's reject codes, for the Setup table and the Rejects screen's labels
  app.get('/api/reject-codes', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ codes: await listRejectCodes(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  // set a reject code's label / pass flag / severity (entering Q10 answers) —
  // engineer+ (rank 2) since 15 Sep 2026: IFL said reject-code meanings are
  // set in settings by the engineer (Q12), the same person who sets limits.
  // Was manager+. Only the fields sent are changed; the audit row names each.
  app.put('/api/reject-codes/:id', requireRole(2), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          label: z.string().max(128).nullable().optional(),
          // z.boolean(), not z.coerce.boolean(): "false" must not become true (a473d4d).
          isPass: z.boolean().nullable().optional(),
          severity: z.enum(REJECT_SEVERITIES).nullable().optional(),
        })
        .safeParse(req.body);
      if (!Number.isInteger(id) || !body.success) {
        res.status(400).json({ error: 'invalid request' });
        return;
      }
      const p = body.data;
      if (p.label === undefined && p.isPass === undefined && p.severity === undefined) {
        res.status(400).json({ error: 'nothing to change' });
        return;
      }
      // An empty label is "no label", never the empty string.
      const patch = { ...p, ...(p.label !== undefined ? { label: p.label || null } : {}) };
      const updated = await auditedWrite(
        pool, actorId(req), { action: 'reject_code.update', targetType: 'reject_code', targetId: id, detail: null },
        async (tx) => {
          const r = await updateRejectCode(tx, cfg.lineId, id, patch);
          if (r.rowsAffected === 0) return { result: 0, noop: true };
          const parts: string[] = [];
          if (patch.label !== undefined) parts.push(`label "${r.oldLabel ?? '(none)'}" -> "${patch.label ?? '(none)'}"`);
          if (patch.isPass !== undefined) parts.push(`is_pass ${String(r.oldIsPass)} -> ${String(patch.isPass)}`);
          if (patch.severity !== undefined) parts.push(`severity ${r.oldSeverity ?? '(none)'} -> ${patch.severity ?? '(none)'}`);
          return { result: r.rowsAffected, detail: parts.join(', ') };
        },
      );
      res.json({ updated });
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
      // Roadmap Phase 9 (15 Sep 2026): a logged adjustment restarts the
      // station's centreline and sigma, so the ledger is passed in here as
      // it is by the station table and the attention list.
      // T3 (15 Sep 2026): bound to `{ to: q.data.to }` — same defect and same
      // fix as weightStations.ts, see the comment there. Without it, an
      // adjustment logged after this route's own `to` would still come back
      // as the newest row and wrongly restart every station's run.
      const [plausibility, adjustments] = await Promise.all([
        getPlausibilityRule(pool, cfg.lineId),
        listCalibrationAdjustments(pool, cfg.lineId, { to: q.data.to }),
      ]);
      const data = await getStationDrift(pool, cfg.lineId, q.data.from, q.data.to, plausibility, {
        restarts: adjustmentRestarts(adjustments),
      });
      res.json(await envelope(pool, cfg.lineId, data));
    } catch (err) {
      next(err);
    }
  });

  // Roadmap Phase 9 item 5 (15 Sep 2026): `from`/`to` are production days
  // compared on the plant clock; `station` returns that station's rows PLUS
  // the line-wide rows (station NULL), which apply to every station. The
  // Calibration report (Phase 8) calls this with from/to.
  const adjustmentsQuery = z.object({
    from: dateStr,
    to: dateStr,
    station: z.coerce.number().int().positive().optional(),
  });
  app.get('/api/calibration/adjustments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = adjustmentsQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: 'invalid query', detail: q.error.flatten().fieldErrors });
        return;
      }
      if (q.data.from && q.data.to) {
        const bad = validateRange(q.data.from, q.data.to);
        if (bad) {
          res.status(400).json({ error: bad });
          return;
        }
      }
      const adjustments = await listCalibrationAdjustments(pool, cfg.lineId, {
        from: q.data.from,
        to: q.data.to,
        station: q.data.station ?? null,
      });
      res.json({
        adjustments,
        // The offset the plant-time fields were converted with — the web
        // uses this, never the browser's zone (the two clocks, CLAUDE.md).
        plantOffsetMinutes: plantOffsetMinutes(),
        from: q.data.from ?? null,
        to: q.data.to ?? null,
        station: q.data.station ?? null,
      });
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
          // Roadmap Phase 9 item 5 (migration 034): reference readings and
          // the product in force, all optional. `adjustedAt` above is a
          // genuine-UTC instant; the web converts the plant-time the person
          // typed with the offset this API reports.
          beforeG: z.coerce.number().finite().optional(),
          afterG: z.coerce.number().finite().optional(),
          referenceG: z.coerce.number().finite().optional(),
          productId: z.coerce.number().int().positive().optional(),
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
      // Same gate for the product: sms.product carries no FK from the ledger
      // (the mirror can lag), so an unknown id is refused here instead.
      if (body.data.productId != null) {
        const known = await pool.request().input('id', mssql.Int, body.data.productId)
          .query<{ n: number }>(`SELECT COUNT(*) n FROM sms.product WHERE product_id=@id`);
        if (!known.recordset[0]?.n) {
          res.status(400).json({ error: `no product ${body.data.productId}` });
          return;
        }
      }
      const user = (req as AuthedRequest).user!;
      const adjustedAt = body.data.adjustedAt ? new Date(body.data.adjustedAt) : new Date();
      const id = await recordCalibrationAdjustment(pool, cfg.lineId, {
        stationId: body.data.stationId ?? null,
        adjustedAtUtc: adjustedAt,
        recordedBy: user.userId,
        reason: body.data.reason ?? null,
        note: body.data.note ?? null,
        amountG: body.data.amountG ?? null,
        beforeG: body.data.beforeG ?? null,
        afterG: body.data.afterG ?? null,
        referenceG: body.data.referenceG ?? null,
        productId: body.data.productId ?? null,
      });
      audit(
        req, 'calibration.adjustment', 'station', body.data.stationId ?? 'line-wide',
        body.data.reason ?? body.data.note ?? null,
      );
      res.json({
        adjustmentId: id,
        adjustments: await listCalibrationAdjustments(pool, cfg.lineId),
        plantOffsetMinutes: plantOffsetMinutes(),
      });
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
  // what ran when is a read, not a decision; setting it stays engineer+ below
  app.get('/api/product-timeline', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ timeline: await listTimeline(pool, cfg.lineId) });
    } catch (err) {
      next(err);
    }
  });

  // set the running product — engineer+ (rank 2; IFL Q19/Q41, 15 Sep 2026: the process engineer on the floor changes products) (append-only timeline)
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
  // Rank 2 (engineer) since 15 Sep 2026. Was rank 3 (manager) on the
  // developer's reasoning that these change what the scale ACCEPTS, not what
  // a report is labelled; IFL's answers (Q10/Q19/Q40/Q41) put products and
  // limits in the hands of the process engineer on the floor, so the gate
  // matches — one rank for every product write, here and in routes/products.ts.
  // The status endpoint is open to any signed-in user so the screen can be
  // read-only and say why, instead of offering a button that can only answer 503.
  const PDAS_WRITE_RANK = 2;
  app.get('/api/product-write/status', async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    res.json({
      enabled: pdas.enabled,
      reason: pdas.disabledReason,
      canWrite: Boolean(user) && (user?.rank ?? 0) >= PDAS_WRITE_RANK && pdas.enabled,
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

  app.post('/api/products', requireRole(PDAS_WRITE_RANK), async (req: Request, res: Response, next: NextFunction) => {
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

  app.post('/api/products/:id/active', requireRole(PDAS_WRITE_RANK), async (req: Request, res: Response, next: NextFunction) => {
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

  app.post('/api/products/:id/limits', requireRole(PDAS_WRITE_RANK), async (req: Request, res: Response, next: NextFunction) => {
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
  // Every write below is a CONFIGURATION change and goes through
  // auditedWrite(): the change and its audit row are one transaction.
  // viewer 1 · engineer 2 · manager 3 · admin 4 — the names since migration 035 (15 Sep 2026).
  const ROLE_NAMES = z.enum(['viewer', 'engineer', 'manager', 'admin']);
  const optText = (max: number) => z.string().max(max).nullable().optional();

  app.get('/api/admin/users', requireRole(4), async (_req, res, next) => {
    try { res.json({ users: await listUsers(pool) }); } catch (e) { next(e); }
  });
  app.post('/api/admin/users', requireRole(4), async (req, res, next) => {
    try {
      const b = z.object({ username: z.string().min(1).max(64), password: z.string().min(1), role: ROLE_NAMES, displayName: z.string().max(128).optional() }).safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid user' }); return; }
      // The length policy (PASSWORD_MIN_LENGTH, default 10) replaced the
      // literal 6 here on 14 Sep 2026 (roadmap Phase 11) — one rule, shared
      // with the change and reset routes and the CLI.
      const policy = passwordPolicyProblem(b.data.password, cfg.passwordMinLength ?? 10);
      if (policy) { res.status(400).json({ error: 'password policy', detail: policy }); return; }
      try {
        await auditedWrite(
          pool, actorId(req), { action: 'user.create', targetType: 'user', targetId: b.data.username, detail: `role ${b.data.role}` },
          async (tx) => {
            await createUser(tx, b.data.username, b.data.password, b.data.role, b.data.displayName ?? null);
            return { result: undefined };
          },
        );
      } catch (e) {
        // unique-key violation on username → a clear 409, not a generic 500
        if (isUniqueViolation(e)) {
          res.status(409).json({ error: `username "${b.data.username}" already exists` });
          return;
        }
        throw e;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.patch('/api/admin/users/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z.object({ active: z.boolean().optional(), role: ROLE_NAMES.optional() }).safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid' }); return; }
      try {
        await auditedWrite(pool, actorId(req), { action: 'user.update', targetType: 'user', targetId: id, detail: null }, async (tx) => {
          const { oldActive, oldRole } = await updateUser(tx, id, b.data.active, b.data.role);
          const changes: string[] = [];
          if (b.data.active != null) changes.push(`active ${oldActive ?? '?'} -> ${b.data.active}`);
          if (b.data.role) changes.push(`role ${oldRole ?? '?'} -> ${b.data.role}`);
          return { result: undefined, detail: changes.join('; ') || null };
        });
      } catch (e) {
        // The last-admin guard lives in updateUser, inside the transaction
        // (roadmap Phase 11, 14 Sep 2026); it surfaces here as a 409 with the
        // sentence Setup prints, and auditedWrite has already rolled back.
        if (e instanceof LastAdminError) { res.status(409).json({ error: 'last administrator', detail: e.message }); return; }
        throw e;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- line identity: plant › unit › line (migration 028) ----
  app.get('/api/admin/line', requireRole(4), async (_req, res, next) => {
    try {
      const line = await getLineIdentity(pool, cfg.lineId);
      if (!line) { res.status(404).json({ error: `no sms.line row for line ${cfg.lineId} — apply migration 028` }); return; }
      res.json({ line });
    } catch (e) { next(e); }
  });
  app.put('/api/admin/line', requireRole(4), async (req, res, next) => {
    try {
      const name = z.string().min(1).max(128).optional();
      const b = z.object({ plantName: name, unitName: name, lineName: name, displayName: name }).safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid', detail: b.error.flatten().fieldErrors }); return; }
      if (Object.values(b.data).every((v) => v === undefined)) { res.status(400).json({ error: 'nothing to change' }); return; }
      const found = await updateLine(pool, actorId(req), cfg.lineId, b.data);
      if (!found) { res.status(404).json({ error: `no sms.line row for line ${cfg.lineId}` }); return; }
      // The wall display's title comes from the same row, cached for a minute.
      invalidateLiveConfigCache();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- machines: the winders and the packer (migration 028) ----
  // Adding one here, with a number, also creates its station — the roadmap's
  // "adding a second machine does not require source-code modification".
  // Whether a machine IS a station on this line is clarification Q3.
  app.get('/api/admin/machines', requireRole(4), async (_req, res, next) => {
    try { res.json({ machines: await listMachines(pool, cfg.lineId) }); } catch (e) { next(e); }
  });
  app.post('/api/admin/machines', requireRole(4), async (req, res, next) => {
    try {
      const b = z
        .object({
          // null (or absent) = the source never identifies it, like the packer.
          machineNo: z.number().int().min(0).nullable().optional(),
          kind: z.enum(['winder', 'packer', 'other']),
          name: z.string().min(1).max(64),
          make: optText(64),
          model: optText(64),
          notes: optText(255),
        })
        .safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid machine', detail: b.error.flatten().fieldErrors }); return; }
      let r;
      try {
        r = await createMachine(pool, actorId(req), cfg.lineId, { ...b.data, machineNo: b.data.machineNo ?? null });
      } catch (e) {
        // Two admins adding the same number at once: the filtered unique
        // index UX_machine_no wins the race the pre-check cannot.
        if (isUniqueViolation(e)) { res.status(409).json({ error: `machine number ${b.data.machineNo} already exists on this line` }); return; }
        throw e;
      }
      if (!r.ok) { res.status(409).json({ error: r.message }); return; }
      res.status(201).json({ machineId: r.machineId, stationCreated: r.stationCreated });
    } catch (e) { next(e); }
  });
  app.put('/api/admin/machines/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z
        .object({
          name: z.string().min(1).max(64).optional(),
          make: optText(64),
          model: optText(64),
          notes: optText(255),
          // z.boolean(): a coerced "false" would re-activate a retired machine.
          isActive: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid', detail: b.success ? undefined : b.error.flatten().fieldErrors }); return; }
      if (Object.values(b.data).every((v) => v === undefined)) { res.status(400).json({ error: 'nothing to change' }); return; }
      const found = await updateMachine(pool, actorId(req), cfg.lineId, id, b.data);
      if (!found) { res.status(404).json({ error: `no machine ${id} on this line` }); return; }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- stations ----
  app.get('/api/admin/stations', requireRole(4), async (_req, res, next) => {
    try { res.json({ stations: await listStations(pool, cfg.lineId) }); } catch (e) { next(e); }
  });
  app.post('/api/admin/stations', requireRole(4), async (req, res, next) => {
    try {
      const b = z
        .object({
          // The number MachineNo on a cone row is matched against — chosen, not assigned.
          stationId: z.number().int().min(0),
          name: optText(64),
          machineId: z.number().int().positive().nullable().optional(),
        })
        .safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid station', detail: b.error.flatten().fieldErrors }); return; }
      let r;
      try {
        r = await createStation(pool, actorId(req), cfg.lineId, {
          stationId: b.data.stationId, name: b.data.name ?? null, machineId: b.data.machineId ?? null,
        });
      } catch (e) {
        if (isUniqueViolation(e)) { res.status(409).json({ error: `station ${b.data.stationId} already exists on this line` }); return; }
        throw e;
      }
      if (!r.ok) { res.status(r.code === 'EXISTS' ? 409 : 400).json({ error: r.message }); return; }
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });
  app.put('/api/admin/stations/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z
        .object({
          name: z.string().max(64).nullable(),
          machine: z.string().max(64).nullable(),
          description: z.string().max(255).nullable(),
          /** Present (including null) = set the link; absent = leave it. */
          machineId: z.number().int().positive().nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid' }); return; }
      const newName = b.data.name || null;
      // A link must point at a machine on THIS line; the FK alone would let
      // a station borrow another line's winder (Q14).
      if (b.data.machineId != null) {
        const known = await pool.request().input('line', mssql.Int, cfg.lineId).input('id', mssql.Int, b.data.machineId)
          .query<{ n: number }>(`SELECT COUNT(*) n FROM sms.machine WHERE line_id=@line AND machine_id=@id`);
        if (!Number(known.recordset[0]?.n ?? 0)) { res.status(400).json({ error: `no machine ${b.data.machineId} on this line` }); return; }
      }
      const updated = await auditedWrite(
        pool, actorId(req), { action: 'station.rename', targetType: 'station', targetId: id, detail: null },
        async (tx) => {
          const r = await setStation(tx, cfg.lineId, id, {
            name: newName, machine: b.data.machine || null, description: b.data.description || null,
            machineId: b.data.machineId, isActive: b.data.isActive,
          });
          // a nonexistent station used to return ok:true AND write a phantom
          // audit entry — found live in the Aug 2026 audit (PUT /stations/999)
          if (!r.updated) return { result: false, noop: true };
          // One change, two events when the link moved: the rename row the
          // Setup screen has always written, and a station.link row so the
          // Q3 question ("which machine is station 7?") has its own history.
          if (b.data.machineId !== undefined && b.data.machineId !== r.oldMachineId) {
            await recordAuditIn(tx, actorId(req), {
              action: 'station.link', targetType: 'station', targetId: id,
              detail: `machine_id ${r.oldMachineId ?? '(none)'} -> ${b.data.machineId ?? '(none)'}`,
            });
          }
          const activeNote = b.data.isActive !== undefined && b.data.isActive !== r.oldIsActive
            ? `; active ${String(r.oldIsActive)} -> ${String(b.data.isActive)}` : '';
          return { result: true, detail: `name "${r.oldName ?? '(none)'}" -> "${newName ?? '(none)'}"${activeNote}` };
        },
      );
      if (!updated) {
        res.status(404).json({ error: `no station ${id} on this line` });
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- data sources and the line's source tables (migration 028) ----
  // Connection details are NOT here: a data_source row names which .env
  // block it uses (connection_key); server, database and login stay in .env.
  app.get('/api/admin/sources', requireRole(4), async (_req, res, next) => {
    try { res.json(await listSources(pool, cfg.lineId)); } catch (e) { next(e); }
  });
  app.put('/api/admin/sources/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z.object({ label: z.string().min(1).max(128).optional(), isEnabled: z.boolean().optional(), notes: optText(255) }).safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid', detail: b.success ? undefined : b.error.flatten().fieldErrors }); return; }
      if (Object.values(b.data).every((v) => v === undefined)) { res.status(400).json({ error: 'nothing to change' }); return; }
      const found = await updateDataSource(pool, actorId(req), id, b.data);
      if (!found) { res.status(404).json({ error: `no data source ${id}` }); return; }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.put('/api/admin/sources/tables/:id', requireRole(4), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = z
        .object({
          // A plain SQL Server identifier, so the worker can bracket-quote it.
          // "pack1; DROP TABLE x" stops here, not in the worker's SELECT.
          sourceTable: z.string().regex(SOURCE_TABLE_NAME, 'must be a plain SQL Server identifier').optional(),
          isEnabled: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!Number.isInteger(id) || !b.success) { res.status(400).json({ error: 'invalid', detail: b.success ? undefined : b.error.flatten().fieldErrors }); return; }
      if (Object.values(b.data).every((v) => v === undefined)) { res.status(400).json({ error: 'nothing to change' }); return; }
      const found = await updateSourceTable(pool, actorId(req), cfg.lineId, id, b.data);
      if (!found) { res.status(404).json({ error: `no source table ${id} on this line` }); return; }
      res.json({
        ok: true,
        note:
          "Applies on the sync worker's next pass. A different table is a different source generation: " +
          'the worker will halt on it until `sms epoch:accept` registers it.',
      });
    } catch (e) { next(e); }
  });

  // ---- versioned rules ----
  app.get('/api/admin/rules', requireRole(4), async (_req, res, next) => {
    try { res.json(await getRules(pool, cfg.lineId)); } catch (e) { next(e); }
  });
  app.post('/api/admin/rules/weight', requireRole(4), async (req, res, next) => {
    try {
      const b = z.object({ basis: z.enum(['as_recorded', 'gross', 'net']), coneTubeWeightG: z.coerce.number().nonnegative(), sackTareKg: z.coerce.number().nonnegative(), reason: z.string().max(255).optional() }).safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid' }); return; }
      await auditedWrite(
        pool, actorId(req),
        { action: 'rule.weight', targetType: 'weight_rule', targetId: cfg.lineId, detail: `basis ${b.data.basis}, tube ${b.data.coneTubeWeightG}g, tare ${b.data.sackTareKg}kg` },
        async (tx) => {
          await setWeightRule(tx, cfg.lineId, b.data.basis, b.data.coneTubeWeightG, b.data.sackTareKg, actorId(req), b.data.reason ?? null);
          return { result: undefined };
        },
      );
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
  app.post('/api/admin/rules/shift', requireRole(4), async (req, res, next) => {
    try {
      const b = z
        .object({
          morningStart: hhmm,
          eveningStart: hhmm,
          nightStart: hhmm,
          mode: z.enum(['corrected', 'legacy']),
          nightBelongsTo: z.enum(['start_day', 'calendar_day']),
          reason: z.string().max(255).optional(),
        })
        .safeParse(req.body);
      if (!b.success) { res.status(400).json({ error: 'invalid', detail: b.error.flatten().fieldErrors }); return; }
      // The three starts must be in order within one calendar day: the night
      // shift is the one that wraps midnight, so it is always last. The same
      // function the worker uses to read the rule back decides, so nothing
      // can be stored that the transform could not interpret.
      const boundaries = shiftBoundariesFrom(b.data.morningStart, b.data.eveningStart, b.data.nightStart);
      if (!boundaries) {
        res.status(400).json({
          error: 'invalid shift boundaries',
          detail: 'morningStart, eveningStart and nightStart must be HH:MM and strictly increasing (the night shift is the one that crosses midnight)',
        });
        return;
      }
      await auditedWrite(
        pool, actorId(req),
        {
          action: 'rule.shift', targetType: 'shift_rule', targetId: cfg.lineId,
          detail: `starts ${b.data.morningStart}/${b.data.eveningStart}/${b.data.nightStart}, mode ${b.data.mode}, night belongs to ${b.data.nightBelongsTo}`,
        },
        async (tx) => {
          await setShiftRule(tx, cfg.lineId, boundaries, b.data.mode, b.data.nightBelongsTo, actorId(req), b.data.reason ?? null);
          return { result: undefined };
        },
      );
      // /api/live names the current shift from the same row, cached a minute.
      invalidateLiveConfigCache();
      // Finding H5 (Sep 2026 audit): this note used to say "rebuild canonical
      // to apply" while the transform actually read a static env var and
      // never this table at all — a rebuild silently re-derived the OLD
      // rule. runTransform.ts now resolves the rule from this table fresh
      // every pass, so the note is now true: new syncs pick it up
      // immediately, and a rebuild is only needed to recompute what is
      // already stored. The corrected/legacy `mode` itself remains recorded
      // but not yet applied anywhere — Q7 (fix vs reproduce) is still open.
      res.json({
        ok: true,
        rebuildRequired: true,
        note:
          'Shift rule stored. The transform picks it up on its NEXT pass, so from now on new rows ' +
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
      await auditedWrite(
        pool, actorId(req),
        { action: 'rule.plausibility', targetType: 'plausibility_rule', targetId: cfg.lineId, detail: `cone ${b.data.coneLoG}-${b.data.coneHiG}g, sack ${b.data.sackLoKg}-${b.data.sackHiKg}kg` },
        async (tx) => {
          await setPlausibilityRule(
            tx, cfg.lineId, b.data.coneLoG, b.data.coneHiG, b.data.sackLoKg, b.data.sackHiKg,
            actorId(req), b.data.reason ?? null,
          );
          return { result: undefined };
        },
      );
      res.json({ ok: true, note: 'applies immediately to every SPC/weight query — read-time, not a rebuild' });
    } catch (e) { next(e); }
  });

  // audit log — admin only, read-only view of every write above. Keyset
  // paged since roadmap Phase 11 (14 Sep 2026): `?before=<audit_id>&limit=`
  // walks older pages; without `before` the newest page is returned, and the
  // legacy `entries` shape is kept so an older bundle still renders.
  app.get('/api/admin/audit', requireRole(4), async (req, res, next) => {
    try {
      const q = z
        .object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(1000).optional() })
        .safeParse(req.query);
      if (!q.success) { res.status(400).json({ error: 'invalid query' }); return; }
      res.json(await listAuditPage(pool, { before: q.data.before ?? null, limit: q.data.limit ?? 500 }));
    } catch (e) { next(e); }
  });

  // Routes added per roadmap phase live in their own modules (routes/*.ts);
  // they mount here, after every gate above and BEFORE the /api 404 below:
  // mounted after it (as the first stub did, 14 Sep 2026) every one of their
  // routes was shadowed by `not found` and could never be reached.
  const routeCtx = { app, pool, cfg, audit };
  mountConeRoutes(routeCtx);
  mountRejectsRoutes(routeCtx);
  mountOpsRoutes(routeCtx);
  mountReportsRoutes(routeCtx);
  mountCalibrationRoutes(routeCtx);
  mountSacksRoutes(routeCtx);

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
  //
  // One JSON line since 14 Sep 2026 (roadmap Phase 2 item 6): `err` carries
  // name, message and stack; `correlationId` is the request id, which the
  // body returns as `requestId` so a user's "it said internal error" can be
  // matched to the one line that says why. Still nothing about the cause in
  // the response.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const user = (req as AuthedRequest).user?.username ?? 'anonymous';
    requestLog(req).error(`api error: ${req.method} ${req.originalUrl} user=${user}`, {
      method: req.method,
      url: req.originalUrl,
      user,
      err: err instanceof Error ? err : { message: String(err) },
    });
    res.status(500).json({ error: 'internal error', requestId: res.locals.requestId ?? null });
  });

  return app;
}
