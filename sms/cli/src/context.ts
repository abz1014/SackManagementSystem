/** Shared CLI setup: load env/config, open pools. */
import {
  loadDotEnv,
  loadSyncConfig,
  createPool,
  connectSource,
  type SyncConfig,
} from '@sms/sync-worker';
import { createLogger } from '@sms/shared';
import type { ConnectionPool } from 'mssql';

/** The CLI's logger: human output stays on console; errors and retries go through here too. */
export const cliLog = createLogger('cli');

export interface Ctx {
  cfg: SyncConfig;
  app: ConnectionPool;
  ifl: ConnectionPool;
  close: () => Promise<void>;
}

export async function openContext(opts: { needIfl?: boolean } = {}): Promise<Ctx> {
  loadDotEnv();
  const cfg = loadSyncConfig();
  const app = await createPool(cfg.app);
  // Same policy as the worker (Phase 2): three attempts, transient only.
  const ifl = opts.needIfl
    ? await connectSource(cfg.iflData, createPool, (attempt, err) =>
        cliLog.warn('retrying source connection', {
          attempt,
          server: cfg.iflData.server,
          database: cfg.iflData.database,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    : app;
  return {
    cfg,
    app,
    ifl,
    close: async () => {
      await app.close();
      if (opts.needIfl && ifl !== app) await ifl.close();
    },
  };
}

/** Parse `--key=value` and `--flag` args into a map. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m && m[1]) out[m[1]] = m[2] ?? true;
  }
  return out;
}
