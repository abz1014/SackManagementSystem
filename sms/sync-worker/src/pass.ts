/**
 * One supervised pass: open both pools, run the full sync, close both — with
 * every failure path accounted for.
 *
 * The pools are opened one at a time inside their own try/finally, because the
 * old shape — `const app = await createPool(); const ifl = await createPool();
 * try { … } finally { close both }` — closed nothing when the SECOND open threw.
 * With IFL unreachable (the plant server down, or the wrong hostname in .env)
 * every 60 s tick opened a fresh app pool and abandoned it, never closed. The
 * pool config (`min: 0`, 30 s idle reaper) meant the connection itself was
 * eventually dropped, so the cost was one dangling pool and one open session
 * per tick for half a minute rather than an unbounded pile — but that was luck
 * in the pool settings, not a property of the code, and any change to `min`
 * would have turned it into a real connection leak. Nothing was logged about
 * it; only the source outage was.
 */
import type { ConnectionPool } from 'mssql';
import { createLogger } from '@sms/shared';
import type { SyncConfig } from './config.js';
import { connectSource, createPool } from './db.js';
import { classifyError } from './reader/errorClass.js';
import { runFullSync, recordPassHalt, type FullSyncResult } from './pipeline.js';

const log = createLogger('sync-worker');

export interface PassDeps {
  createPool: (c: SyncConfig['app']) => Promise<ConnectionPool>;
  runFullSync: typeof runFullSync;
  recordPassHalt: typeof recordPassHalt;
}

const realDeps: PassDeps = { createPool, runFullSync, recordPassHalt };

export async function runPass(cfg: SyncConfig, deps: PassDeps = realDeps): Promise<FullSyncResult> {
  const app = await deps.createPool(cfg.app);
  try {
    let ifl: ConnectionPool;
    try {
      // Three attempts, transient failures only (Phase 2): see connectSource.
      ifl = await connectSource(cfg.iflData, deps.createPool, (attempt, err) =>
        log.warn('retrying source connection', {
          attempt,
          server: cfg.iflData.server,
          database: cfg.iflData.database,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } catch (err) {
      // The one halt the runner cannot record itself: it never ran. The app
      // pool is open, so the reason goes where Setup reads it — with the
      // failure's class in front, so "login refused" reads as such.
      const cls = classifyError(err);
      const reason = err instanceof Error ? err.message : String(err);
      const halt = cls === 'unknown' ? err : new Error(`[${cls}] ${reason}`);
      await deps.recordPassHalt(app, cfg, 'source connection', halt).catch(() => {});
      throw err;
    }
    try {
      return await deps.runFullSync(app, ifl, cfg);
    } finally {
      await ifl.close();
    }
  } finally {
    await app.close();
  }
}
