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
  appDb: DbConfig;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return schema.parse({
    port: env.API_PORT,
    lineId: env.LINE_ID,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
    trustProxy: env.TRUST_PROXY,
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
