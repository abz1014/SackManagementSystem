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
  app: DbConfig;
  iflData: DbConfig;
  pdasDbName: string;
  appConfig: AppConfig;
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
    lineId: Number(env.LINE_ID ?? 1),
    overlapRows: Number(env.SYNC_OVERLAP_ROWS ?? 500),
    app,
    iflData,
    pdasDbName: env.IFL_DB_NAME_PDAS ?? 'PDAS_TP1U2',
    appConfig: loadAppConfig(env),
  };
}

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
  };
}
