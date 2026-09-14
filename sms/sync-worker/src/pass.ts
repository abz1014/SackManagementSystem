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
import type { SyncConfig } from './config.js';
import { createPool } from './db.js';
import { runFullSync, recordPassHalt, type FullSyncResult } from './pipeline.js';

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
      ifl = await deps.createPool(cfg.iflData);
    } catch (err) {
      // The one halt the runner cannot record itself: it never ran. The app
      // pool is open, so the reason goes where Setup reads it.
      await deps.recordPassHalt(app, cfg, 'source connection', err).catch(() => {});
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
