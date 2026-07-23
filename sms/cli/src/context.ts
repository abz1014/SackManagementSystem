/** Shared CLI setup: load env/config, open pools. */
import {
  loadDotEnv,
  loadSyncConfig,
  createPool,
  type SyncConfig,
} from '@sms/sync-worker';
import type { ConnectionPool } from 'mssql';

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
  const ifl = opts.needIfl ? await createPool(cfg.iflData) : app;
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
