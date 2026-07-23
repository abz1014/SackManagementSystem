/**
 * Sync-worker service entry. Runs a full pass on an interval (default 60s),
 * so it can be supervised as a Windows Service (NSSM). Each pass is isolated:
 * a failure is logged and retried next tick — the service never dies on a
 * transient DB blip. Set SYNC_ONCE=true for a single pass (dev/CI).
 */
import { loadDotEnv, loadSyncConfig } from './config.js';
import { createPool } from './db.js';
import { runFullSync } from './pipeline.js';

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, svc: 'sync-worker', msg, ...extra }));

async function onePass(cfg: ReturnType<typeof loadSyncConfig>): Promise<void> {
  const app = await createPool(cfg.app);
  const ifl = await createPool(cfg.iflData);
  try {
    const started = Date.now();
    const { reader, transform } = await runFullSync(app, ifl, cfg);
    const rawWritten = reader.reduce((s, o) => s + o.written, 0);
    const canonWritten = transform.reduce((s, o) => s + o.written, 0);
    const dq = transform.flatMap((o) => o.findings).reduce((m, f) => ({ ...m, [f.severity]: (m[f.severity] ?? 0) + 1 }), {} as Record<string, number>);
    log('info', 'sync pass complete', { ms: Date.now() - started, rawWritten, canonWritten, dq });
  } finally {
    await app.close();
    await ifl.close();
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadSyncConfig();
  // --once CLI flag as well as the env var: npm scripts on Windows run through
  // cmd.exe, which doesn't support `VAR=val node ...` shell syntax, so the
  // flag is the portable way to request a single pass from package.json.
  const once = process.env.SYNC_ONCE === 'true' || process.argv.includes('--once');
  const intervalMs = Math.max(5, cfg.appConfig ? Number(process.env.SYNC_INTERVAL_SECONDS ?? 60) : 60) * 1000;

  log('info', 'starting', {
    line: cfg.lineId,
    source: `${cfg.iflData.database}@${cfg.iflData.server}:${cfg.iflData.port}`,
    mode: once ? 'once' : `loop ${intervalMs / 1000}s`,
  });

  if (once) {
    await onePass(cfg);
    return;
  }

  // continuous loop — never throws out of the service
  for (;;) {
    try {
      await onePass(cfg);
    } catch (err) {
      log('error', 'sync pass failed (will retry next tick)', { error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((err) => {
  log('error', 'fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
