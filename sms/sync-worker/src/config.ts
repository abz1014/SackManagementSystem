/**
 * Sync-worker configuration. Secrets + connection details come from env ONLY.
 * Behavioural (swappable-unknowns) config is loaded via @sms/shared.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { loadAppConfig, type AppConfig } from '@sms/shared';

/** Minimal .env loader (no dotenv dependency). Loads repo-root .env once. */
export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ is sync-worker/dist, so repo root is three up
  const candidates = [
    join(here, '..', '..', '.env'), // from dist/
    join(here, '..', '..', '..', '.env'),
  ];
  for (const path of candidates) {
    try {
      const text = readFileSync(path, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2];
      }
      return;
    } catch {
      /* try next */
    }
  }
}

const dbSchema = z.object({
  server: z.string().min(1),
  port: z.coerce.number().int().positive(),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  encrypt: z.coerce.boolean(),
  trustServerCertificate: z.coerce.boolean(),
});
export type DbConfig = z.infer<typeof dbSchema>;

export interface SyncConfig {
  lineId: number;
  overlapRows: number;
  /** Seconds between passes in loop mode. Floor 5. */
  intervalSeconds: number;
  /**
   * Consecutive halted/failed passes before the worker raises the
   * `persistent_sync_failure` CRITICAL finding (roadmap Phase 11 item 3,
   * 14 Sep 2026; ARCHITECTURE §14 promised the finding and no check_name
   * existed). SYNC_FAILURE_CRITICAL_AFTER, default 5 — five minutes of
   * failure at the default cadence, long enough to outlast a SQL Server
   * restart and short enough that a dead plant link shows on Setup within
   * the same shift. Floor 1.
   */
  failureCriticalAfter: number;
  /**
   * Hours without a sack row, while cones are being weighed, before the
   * transform raises the `sack_blackout` WARNING (roadmap Phase 7, 15 Sep
   * 2026; dq.ts sackBlackoutFindings). SACK_BLACKOUT_HOURS, default 4 — the
   * developer's threshold: IFL has not said how long the packer may stand
   * while winding runs. Floor 1.
   */
  sackBlackoutHours: number;
  /**
   * The plant's known UTC offset, in minutes, as a cross-check (finding M6,
   * Sep 2026 audit; extended to the worker for roadmap H7, 15 Sep 2026 — the
   * worker is what stamps production_ts_utc_ms on every ingested row, so it
   * needs this at least as much as the API, which has read it since M6).
   * Same env var, same optional-means-skip semantics as api/src/config.ts:
   * unset skips the check rather than forcing a new required variable on an
   * existing deployment. See @sms/shared's checkPlantOffset.
   */
  plantUtcOffsetMinutes?: number;
  app: DbConfig;
  iflData: DbConfig;
  pdasDbName: string;
  appConfig: AppConfig;
}

/**
 * A whole-number env key, validated rather than `Number()`-ed.
 *
 * `Number('6O')` is NaN, and NaN passes straight through everything that used
 * to guard these values: `Math.max(5, NaN)` is NaN, and Node clamps a NaN
 * `setTimeout` delay to 1 ms. So a typo in SYNC_INTERVAL_SECONDS turned the
 * 60 s loop into a tight loop hammering both databases, and a typo in
 * SYNC_OVERLAP_ROWS made the read boundary NaN. Neither said anything at
 * startup. Now both refuse to start, naming the key.
 */
function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`${key} must be a whole number, got ${JSON.stringify(raw)}`);
  }
  const n = Number(raw.trim());
  if (n < min) throw new Error(`${key} must be at least ${min}, got ${n}`);
  return n;
}

/**
 * `Number('')` is 0, not NaN — a genuine JS quirk, distinct from the one
 * `intEnv` above guards against. z.coerce.number().optional() only skips
 * coercion for a literal `undefined`; a blank-but-present env var (an
 * installer who left `PLANT_UTC_OFFSET_MINUTES=` with nothing after the `=`)
 * would otherwise coerce silently to 0 — "the plant is at UTC" — which is
 * exactly the kind of silent wrong answer this whole check exists to catch.
 * So blank is normalised to `undefined` (skip) before it ever reaches zod.
 */
function blankToUndefined(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === '' ? undefined : v;
}

export function loadSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  const app = dbSchema.parse({
    server: env.APP_DB_SERVER,
    port: env.APP_DB_PORT,
    database: env.APP_DB_NAME,
    user: env.APP_DB_USER,
    password: env.APP_DB_PASSWORD,
    encrypt: env.APP_DB_ENCRYPT,
    trustServerCertificate: env.APP_DB_TRUST_SERVER_CERTIFICATE,
  });
  const iflData = dbSchema.parse({
    server: env.IFL_DB_SERVER,
    port: env.IFL_DB_PORT,
    database: env.IFL_DB_NAME_DATA,
    user: env.IFL_DB_USER,
    password: env.IFL_DB_PASSWORD,
    encrypt: env.IFL_DB_ENCRYPT,
    trustServerCertificate: env.IFL_DB_TRUST_SERVER_CERTIFICATE,
  });
  return {
    lineId: intEnv(env, 'LINE_ID', 1, 1),
    overlapRows: intEnv(env, 'SYNC_OVERLAP_ROWS', 500, 0),
    intervalSeconds: intEnv(env, 'SYNC_INTERVAL_SECONDS', 60, 5),
    failureCriticalAfter: intEnv(env, 'SYNC_FAILURE_CRITICAL_AFTER', 5, 1),
    sackBlackoutHours: intEnv(env, 'SACK_BLACKOUT_HOURS', 4, 1),
    // Same shape as api/src/config.ts's identical field: z.coerce.number()
    // rejects a non-numeric value (it does not silently pass NaN through,
    // unlike a bare Number()), and .optional() is what makes an unset
    // PLANT_UTC_OFFSET_MINUTES mean "skip the check" rather than "0".
    plantUtcOffsetMinutes: z.coerce.number().int().optional().parse(blankToUndefined(env.PLANT_UTC_OFFSET_MINUTES)),
    app,
    iflData,
    pdasDbName: env.IFL_DB_NAME_PDAS ?? 'PDAS_TP1U2',
    appConfig: loadAppConfig(env),
  };
}

/**
 * node-mssql defaults `requestTimeout` to 15 seconds, which is sized for the
 * incremental pass (measured median 5ms, p95 10ms) and far too short for the
 * bulk paths that share this pool: a first backfill and a `rebuild` both hand
 * the transform the WHOLE history in one batch, and the rebuild's DELETE
 * clears the whole canonical table in one statement.
 *
 * Measured, Sep 2026 audit: `rebuild --table=cone_event` over 204,076 rows
 * failed outright — "Failed to cancel request in 5000ms" — leaving the audit
 * row 'failed' and the table untouched. cone_event had therefore NEVER been
 * rebuilt successfully, which matters because a rebuild is the prescribed
 * remedy for a mixed shift-rule regime (H5). sack_event (8,201) and
 * reject_event (4,570) fit inside 15s and hid the problem.
 *
 * This is a maintenance-path timeout on the worker/CLI pools only — the API
 * builds its own pool and keeps its short one, so no user-facing request can
 * hang for ten minutes.
 */
export const SYNC_REQUEST_TIMEOUT_MS = 10 * 60_000;

/** Translate our DbConfig into an mssql connection config. */
export function toMssqlConfig(c: DbConfig) {
  return {
    server: c.server,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      // Read/write datetimes as their stored wall-clock (no local-tz shift).
      // The plant runs one timezone; we treat the stored wall clock as canonical.
      useUTC: true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: SYNC_REQUEST_TIMEOUT_MS,
  };
}
