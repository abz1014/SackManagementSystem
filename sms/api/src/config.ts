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
  appDb: z.object({
    server: z.string().min(1),
    port: z.coerce.number().int().positive(),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string().min(1),
    encrypt: z.coerce.boolean(),
    trustServerCertificate: z.coerce.boolean(),
  }),
});

export interface ApiConfig {
  port: number;
  lineId: number;
  cacheTtlSeconds: number;
  trustProxy: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  tlsPfxPath?: string;
  tlsPfxPassphrase?: string;
  appDb: DbConfig;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return schema.parse({
    port: env.API_PORT,
    lineId: env.LINE_ID,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
    trustProxy: env.TRUST_PROXY,
    tlsCertPath: env.TLS_CERT_PATH,
    tlsKeyPath: env.TLS_KEY_PATH,
    tlsPfxPath: env.TLS_PFX_PATH,
    tlsPfxPassphrase: env.TLS_PFX_PASSPHRASE,
    appDb: {
      server: env.APP_DB_SERVER,
      port: env.APP_DB_PORT,
      database: env.APP_DB_NAME,
      user: env.APP_DB_USER,
      password: env.APP_DB_PASSWORD,
      encrypt: env.APP_DB_ENCRYPT,
      trustServerCertificate: env.APP_DB_TRUST_SERVER_CERTIFICATE,
    },
  }) as ApiConfig;
}
