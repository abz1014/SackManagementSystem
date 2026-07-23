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
  appDb: DbConfig;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return schema.parse({
    port: env.API_PORT,
    lineId: env.LINE_ID,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
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
