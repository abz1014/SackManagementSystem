/**
 * API config — APP DB only. The API deliberately does not load or hold any IFL
 * connection string (ARCHITECTURE §16); it reads the sidecar (sms.*) exclusively.
 */
import { z } from 'zod';
import type { DbConfig } from '@sms/sync-worker';

const schema = z.object({
  port: z.coerce.number().int().positive().default(4000),
  lineId: z.coerce.number().int().positive().default(1),
  cacheTtlSeconds: z.coerce.number().nonnegative().default(5),
  /** Name of the single configured line, shown on the floor and wall screens.
   *  Multi-line (Q14, still open) would move this into a table; one env value
   *  keeps the display honest without inventing a line registry. */
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
   * `sms_pdas_writer`, provisioned by IFL's DBA with UPDATE/INSERT on
   * dbo.Materials, EXECUTE on CreateMaterial + SetMaterialStatusActive, INSERT
   * on dbo.nhs_events, and nothing else — enforced by the login, not by code.
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
  appDb: DbConfig;
  pdasWrite: PdasWriteConfig;
}

/**
 * Resolve the write path from its flag and (optional) credentials. Never
 * throws: a missing or partial login degrades to "disabled, and here is why",
 * which the product screen shows in place of the buttons. The reason is
 * written for the operator who will read it on the Setup screen.
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
    plantUtcOffsetMinutes: env.PLANT_UTC_OFFSET_MINUTES,
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
  });
  const { pdasWriteEnabled, pdasWriteDb, ...rest } = parsed;
  return { ...rest, pdasWrite: resolvePdasWrite(pdasWriteEnabled, pdasWriteDb) } as ApiConfig;
}
