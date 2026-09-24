/**
 * API config — APP DB only. The API deliberately does not load or hold any IFL
 * connection string (ARCHITECTURE §16); it reads the sidecar (sms.*) exclusively.
 */
import { z } from 'zod';
import type { DbConfig } from '@sms/sync-worker';

/**
 * `Number('')` is 0, not NaN. `z.coerce.number().optional()` only skips
 * coercion for a literal `undefined`, so a blank-but-present env var (left
 * as `PLANT_UTC_OFFSET_MINUTES=` with nothing after the `=`) would otherwise
 * coerce silently to 0 — "the plant is at UTC" — exactly the kind of silent
 * wrong answer the offset cross-check exists to catch. Blank is normalised
 * to `undefined` (skip the check) before it reaches zod. Same helper as
 * sync-worker/src/config.ts's identical guard on the same variable.
 */
function blankToUndefined(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === '' ? undefined : v;
}

/**
 * The API's own connection-pool profile (16 Sep 2026 fix): before this, the
 * API called sync-worker's `createPool` with no override and inherited its
 * batch-worker config — `pool: { max: 5, min: 0 }` and a ten-minute
 * `requestTimeout` (sync-worker/src/config.ts's `SYNC_POOL_DEFAULT` /
 * `SYNC_REQUEST_TIMEOUT_MS`). That is correct for a single-threaded sync pass
 * and wrong for an HTTP API: one slow query could hold a connection for ten
 * minutes, and six concurrent viewers could exhaust a five-connection pool.
 *
 * Defaults here, not measured against plant load (no concurrency numbers
 * exist yet — IFL has a handful of named accounts, roadmap CLAUDE.md):
 *  - max 10 / min 1: double the worker's ceiling, one warm connection instead
 *    of zero, sized for "more readers than the worker ever needed" without
 *    guessing a real peak.
 *  - idleTimeoutMillis 30000: unchanged from the worker's own default — pool
 *    churn isn't the problem being fixed here.
 *  - requestTimeout 30000 (30 s): an interactive request that has not
 *    answered in 30 s has already failed as far as a user watching a screen
 *    is concerned, and holding a connection for anything close to the
 *    worker's 10-minute maintenance timeout starves every other reader
 *    behind it in the pool.
 * All four are env-overridable (see loadApiConfig) so the plant can raise
 * them without a rebuild if real usage proves them wrong.
 */
export const DEFAULT_DB_POOL_MAX = 10;
export const DEFAULT_DB_POOL_MIN = 1;
export const DEFAULT_DB_POOL_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_DB_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The largest from/to span any range-capped analytics/report route accepts —
 * shared by every such route in app.ts (`/api/attention`,
 * `/api/weight-stations`, `/api/report`, `/api/spc`, `/api/reject-spc`,
 * `/api/calibration`) so the cap can only ever say one number.
 *
 * 366 was chosen to "cover any real single-year analysis", but the largest
 * dataset that has ever existed against this app is 53 production days (19
 * from the July sample + 34 from September) — nothing has ever executed a
 * query anywhere near 366 days. The value is therefore UNPROVEN above 53
 * days; it is left at 366 unchanged here, and a later task should measure
 * the range-capped queries (getWeightSpc, getRejectSpc, getStationDrift, …)
 * against synthetic volume before this number is trusted at scale.
 */
export const MAX_RANGE_DAYS = 366;

/**
 * RT-014 (HIGH, 23/24 Sep 2026 red-team audits): "no server-side response-
 * size/row-count cap independent of SQL." The decision, recorded in
 * DEFECTS.md and CLAUDE.md's WS-* history: no silent truncation, ever. A
 * response that would exceed either cap below is refused outright (413),
 * never quietly cut down — see middleware/responseCap.ts, which is where
 * both are enforced, independent of whatever the SQL layer itself did.
 * Defaults only; no .env key is required for either.
 */
export const MAX_RESPONSE_ROWS = 50_000;
/** 20 MB. */
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

/**
 * RT-014(c): the one aggregated/KPI route the audit itself measured as slow
 * at scale (`/api/spc`, a full-population I-MR/Cp-Cpk computation over every
 * reading in the range) gets its OWN, tighter span cap — 186 days, half of
 * MAX_RANGE_DAYS — enforced in app.ts's `/api/spc` handler via zod, with a
 * plain-language message. Every other aggregated report/KPI route keeps
 * MAX_RANGE_DAYS unchanged; this is not a second general-purpose range cap.
 */
export const MAX_SPC_RANGE_DAYS = 186;

const schema = z.object({
  port: z.coerce.number().int().positive().default(4000),
  lineId: z.coerce.number().int().positive().default(1),
  cacheTtlSeconds: z.coerce.number().nonnegative().default(5),
  /**
   * FALLBACK name for the line, used by /api/live only when sms.line has no
   * row for LINE_ID — a database that predates migration 028. Since roadmap
   * Phase 1 (14 Sep 2026) the name every screen prints is
   * sms.line.display_name, edited in Setup › Line; this env value seeds
   * nothing and overrides nothing once that row exists. Multi-line (Q14) is
   * rows in that table, not more env values.
   */
  lineName: z.string().min(1).default('TP1 · Line 3 · Unit 2'),
  /**
   * Whether /api/live accepts an `asOf` timestamp that moves the plant clock,
   * so the floor screens can replay a past moment. Off by default: a wall
   * display left on a replay URL would present old numbers as live. Dev sets
   * it true, because the supplied copy ends on 10 Jul 2026 and the live
   * screens are otherwise empty.
   */
  liveAllowAsOf: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Whether to believe X-Forwarded-For. Defaults FALSE, which is correct for the
   * current deployment (browsers hit the API directly on :4000).
   *
   * It used to be unconditionally true, and that made req.ip attacker-controlled.
   * Since the login limiter keys on req.ip, an attacker could rotate the header
   * and never be locked out — demonstrated: 12 failed logins with a rotating
   * X-Forwarded-For all returned 401, while the same 12 from a fixed address
   * were 429 from the 9th.
   *
   * Set TRUST_PROXY=true ONLY when a reverse proxy you control terminates TLS in
   * front of this service (see DEPLOY.md). Setting it true with no proxy in front
   * re-opens the bypass.
   */
  trustProxy: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Direct Node TLS termination (DEPLOY.md's TLS section) — an alternative to
   * fronting the service with a reverse proxy. Two forms, matching the two
   * tools a plant PC actually has without installing anything: PEM cert+key
   * (openssl, or any CA-issued pair) or PFX (Windows' own PowerShell
   * `New-SelfSignedCertificate` + `Export-PfxCertificate`, no OpenSSL needed).
   * Within a form both fields must be set together — a cert with no key (or a
   * PFX with no passphrase) is always a misconfiguration, never a partial-TLS
   * mode. Unset by default, which keeps today's plain-HTTP deployment unchanged.
   */
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional(),
  tlsPfxPath: z.string().optional(),
  tlsPfxPassphrase: z.string().optional(),
  /**
   * The plant's known UTC offset, in minutes, as a cross-check (finding M6,
   * Sep 2026 audit). plantClock.ts's entire two-clocks system trusts this
   * process's OS timezone to equal the plant's — nothing previously verified
   * that assumption, and it fails silently by exactly the offset if wrong
   * (five hours here). Optional: unset skips the check rather than forcing a
   * new required variable on an existing deployment.
   */
  plantUtcOffsetMinutes: z.coerce.number().int().optional(),
  /**
   * Password policy (roadmap Phase 11 item 1, 14 Sep 2026): the shortest
   * password the self-change, the admin reset, the admin create route and
   * the CLI will accept. Default 10, replacing the 6 the create route and
   * the CLI used to hard-code (the CLI accepted any non-empty string). IFL
   * has not stated a password policy (Phase 11 clarifications); this is the
   * developer default until they do, and it is configuration, not code.
   */
  passwordMinLength: z.coerce.number().int().min(6).max(128).default(10),
  /**
   * Where scripts/backup-appdb.ps1 writes its .bak files. The Health screen
   * reads the newest file's age from here — read-only, never written to by
   * the API. Default matches the backup script's own -OutDir default.
   */
  backupDir: z.string().min(1).default('C:\\sms-backups'),
  /**
   * The API's own pool/requestTimeout profile (see the block comment above
   * DEFAULT_DB_POOL_MAX). Overridable so the plant can raise them without a
   * rebuild once real concurrent usage says the defaults are wrong.
   */
  dbPoolMax: z.coerce.number().int().positive().default(DEFAULT_DB_POOL_MAX),
  dbPoolMin: z.coerce.number().int().nonnegative().default(DEFAULT_DB_POOL_MIN),
  dbPoolIdleTimeoutMs: z.coerce.number().int().positive().default(DEFAULT_DB_POOL_IDLE_TIMEOUT_MS),
  dbRequestTimeoutMs: z.coerce.number().int().positive().default(DEFAULT_DB_REQUEST_TIMEOUT_MS),
  appDb: z.object({
    server: z.string().min(1),
    port: z.coerce.number().int().positive(),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string().min(1),
    encrypt: z.coerce.boolean(),
    trustServerCertificate: z.coerce.boolean(),
  }),
  /**
   * THE ONE DELIBERATE EXCEPTION to "the API holds no IFL connection". The
   * product Add / Retire / Change-limits path (SEPT-2026-EPOCH-DECISION §5)
   * writes to PDAS_TP1U2.dbo.Materials through the vendor's own stored
   * procedures, and that needs a connection — a SEPARATE one, on a SEPARATE
   * login, never the sync worker's read-only IFL_DB_*. Confirmed as a
   * requirement by the client on 2026-09-11 (IFL's engineers hand-write these
   * writes in SSMS today); still awaiting IFL's WRITTEN confirmation before it
   * is switched on in the plant (§6.2).
   *
   * Off by default, and every field optional: with the flag off, or with the
   * flag on but credentials missing, the API degrades to a read-only product
   * screen rather than failing to start. The login is meant to be
   * `sms_pdas_writer`, provisioned by IFL's DBA with EXECUTE on all seven
   * vendor procs the write path calls (CreateMaterial, SetMaterialStatusActive,
   * AddBlend, AddCount, AddTubeType, CreatePallet, SetPalletStatusActive),
   * UPDATE on dbo.Materials (change-limits; the vendor has no proc for it) and
   * INSERT on dbo.nhs_events — nine rights, not two (CLAUDE.md ¶3, finding H6,
   * 15 Sep 2026 audit) — and nothing else, enforced by the login, not by code.
   *
   * Two more guards live in resolvePdasWrite below (also H6): the writer's own
   * database must be the one the sync worker reads (IFL_DB_NAME_PDAS), and the
   * writer's login must differ from the sync worker's read-only one
   * (IFL_DB_USER). Both refuse rather than throw, same as the missing-field
   * case above.
   */
  pdasWriteEnabled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  pdasWriteDb: z
    .object({
      server: z.string().min(1).optional(),
      port: z.coerce.number().int().positive().optional(),
      database: z.string().min(1).optional(),
      user: z.string().min(1).optional(),
      password: z.string().min(1).optional(),
      encrypt: z.coerce.boolean().default(true),
      trustServerCertificate: z.coerce.boolean().default(true),
    })
    .default({}),
  /**
   * READ, NEVER CONNECTED TO. The sync worker's own IFL_DB_NAME_PDAS and
   * IFL_DB_USER (sync-worker/src/config.ts) — the two values the PDAS-writer
   * guards below compare the writer's own settings against. This does not
   * widen "the API holds no IFL connection string" (line ~98): no pool is
   * ever opened with these, they are two strings held for comparison only.
   */
  iflDbNamePdas: z.string().optional(),
  iflDbUser: z.string().optional(),
});

/** How the PDAS write path resolved at startup — and, if not, why. */
export interface PdasWriteConfig {
  enabled: boolean;
  db: DbConfig | null;
  /** Human-readable reason the path is unavailable; null when enabled. */
  disabledReason: string | null;
}

export interface ApiConfig {
  port: number;
  lineId: number;
  cacheTtlSeconds: number;
  lineName: string;
  liveAllowAsOf: boolean;
  trustProxy: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  tlsPfxPath?: string;
  tlsPfxPassphrase?: string;
  plantUtcOffsetMinutes?: number;
  /** Optional on the type so the test fixtures that build an ApiConfig by hand keep compiling; the loader always sets both. */
  passwordMinLength?: number;
  backupDir?: string;
  /** Optional on the type for the same reason as passwordMinLength above; apiPoolOptions() falls back to the DEFAULT_* constants. */
  dbPoolMax?: number;
  dbPoolMin?: number;
  dbPoolIdleTimeoutMs?: number;
  dbRequestTimeoutMs?: number;
  appDb: DbConfig;
  pdasWrite: PdasWriteConfig;
}

/**
 * The pool/requestTimeout options the API hands to `createPool` — a small
 * pure function so it is testable without starting the server (index.ts's
 * `main()` opens the real DB connection and is not a practical unit-test
 * target). index.ts calls `createPool(cfg.appDb, { onError, ...apiPoolOptions(cfg) })`.
 */
export function apiPoolOptions(
  cfg: Pick<ApiConfig, 'dbPoolMax' | 'dbPoolMin' | 'dbPoolIdleTimeoutMs' | 'dbRequestTimeoutMs'>,
): { pool: { max: number; min: number; idleTimeoutMillis: number }; requestTimeout: number } {
  return {
    pool: {
      max: cfg.dbPoolMax ?? DEFAULT_DB_POOL_MAX,
      min: cfg.dbPoolMin ?? DEFAULT_DB_POOL_MIN,
      idleTimeoutMillis: cfg.dbPoolIdleTimeoutMs ?? DEFAULT_DB_POOL_IDLE_TIMEOUT_MS,
    },
    requestTimeout: cfg.dbRequestTimeoutMs ?? DEFAULT_DB_REQUEST_TIMEOUT_MS,
  };
}

/**
 * Resolve the write path from its flag and (optional) credentials. Never
 * throws: a missing or partial login, or a login that fails either guard
 * below, degrades to "disabled, and here is why", which the product screen
 * shows in place of the buttons. The reason is written for the operator who
 * will read it on the Setup screen.
 *
 * `ifl` carries the sync worker's own IFL_DB_NAME_PDAS / IFL_DB_USER — read,
 * never connected to (see the schema comment above) — so the two guards below
 * (H6, 15 Sep 2026 audit) can be checked with no new connection:
 *  - the writer's database must be the one the sync worker reads. This both
 *    blocks a writer pointed at the wrong database AND, deliberately, allows
 *    a same-named offline proof against a local copy with no special case:
 *    when IFL_DB_NAME_PDAS is itself pointed at a local `_SEP07` copy (as
 *    .env does for that proof), a matching PDAS_WRITE_DATABASE is accepted.
 *  - the writer's login must differ from the sync worker's read-only one —
 *    that login must never also be the writer.
 */
function resolvePdasWrite(
  enabled: boolean,
  db: {
    server?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
  },
  ifl: { dbNamePdas?: string; user?: string } = {},
): PdasWriteConfig {
  if (!enabled) {
    return { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' };
  }
  const missing = (['server', 'port', 'database', 'user', 'password'] as const).filter((k) => db[k] == null);
  if (missing.length > 0) {
    return {
      enabled: false,
      db: null,
      disabledReason:
        `PDAS_WRITE_ENABLED is true but PDAS_WRITE_${missing.map((k) => k.toUpperCase()).join(' / PDAS_WRITE_')} ` +
        `is not set. The write login must be provisioned separately from the read-only sync login.`,
    };
  }
  // Same default the sync worker itself falls back to (sync-worker/src/config.ts).
  const iflDbNamePdas = ifl.dbNamePdas ?? 'PDAS_TP1U2';
  if (db.database !== iflDbNamePdas) {
    return {
      enabled: false,
      db: null,
      disabledReason:
        `PDAS_WRITE_DATABASE (${JSON.stringify(db.database)}) does not match IFL_DB_NAME_PDAS ` +
        `(${JSON.stringify(iflDbNamePdas)}). The writer must point at the same database the sync worker reads.`,
    };
  }
  if (ifl.user != null && db.user === ifl.user) {
    return {
      enabled: false,
      db: null,
      disabledReason:
        `PDAS_WRITE_USER is the same login as IFL_DB_USER (${JSON.stringify(db.user)}). ` +
        `The read-only sync login must never be the writer.`,
    };
  }
  return {
    enabled: true,
    db: {
      server: db.server!,
      port: db.port!,
      database: db.database!,
      user: db.user!,
      password: db.password!,
      encrypt: db.encrypt,
      trustServerCertificate: db.trustServerCertificate,
    },
    disabledReason: null,
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = schema.parse({
    port: env.API_PORT,
    lineId: env.LINE_ID,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
    lineName: env.LINE_NAME,
    liveAllowAsOf: env.LIVE_ALLOW_AS_OF,
    trustProxy: env.TRUST_PROXY,
    tlsCertPath: env.TLS_CERT_PATH,
    tlsKeyPath: env.TLS_KEY_PATH,
    tlsPfxPath: env.TLS_PFX_PATH,
    tlsPfxPassphrase: env.TLS_PFX_PASSPHRASE,
    plantUtcOffsetMinutes: blankToUndefined(env.PLANT_UTC_OFFSET_MINUTES),
    passwordMinLength: env.PASSWORD_MIN_LENGTH,
    backupDir: env.BACKUP_DIR,
    dbPoolMax: env.API_DB_POOL_MAX,
    dbPoolMin: env.API_DB_POOL_MIN,
    dbPoolIdleTimeoutMs: env.API_DB_POOL_IDLE_TIMEOUT_MS,
    dbRequestTimeoutMs: env.API_DB_REQUEST_TIMEOUT_MS,
    appDb: {
      server: env.APP_DB_SERVER,
      port: env.APP_DB_PORT,
      database: env.APP_DB_NAME,
      user: env.APP_DB_USER,
      password: env.APP_DB_PASSWORD,
      encrypt: env.APP_DB_ENCRYPT,
      trustServerCertificate: env.APP_DB_TRUST_SERVER_CERTIFICATE,
    },
    pdasWriteEnabled: env.PDAS_WRITE_ENABLED,
    pdasWriteDb: {
      server: env.PDAS_WRITE_SERVER,
      port: env.PDAS_WRITE_PORT,
      database: env.PDAS_WRITE_DATABASE,
      user: env.PDAS_WRITE_USER,
      password: env.PDAS_WRITE_PASSWORD,
      encrypt: env.PDAS_WRITE_ENCRYPT ?? 'true',
      trustServerCertificate: env.PDAS_WRITE_TRUST_SERVER_CERTIFICATE ?? 'true',
    },
    // Read for the two guards in resolvePdasWrite only — never held on ApiConfig,
    // never used to open a connection. See the schema comment above.
    iflDbNamePdas: env.IFL_DB_NAME_PDAS,
    iflDbUser: env.IFL_DB_USER,
  });
  const { pdasWriteEnabled, pdasWriteDb, iflDbNamePdas, iflDbUser, ...rest } = parsed;
  return {
    ...rest,
    pdasWrite: resolvePdasWrite(pdasWriteEnabled, pdasWriteDb, { dbNamePdas: iflDbNamePdas, user: iflDbUser }),
  } as ApiConfig;
}
