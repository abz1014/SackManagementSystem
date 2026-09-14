/**
 * Sync-worker service entry. Runs a full pass on an interval (default 60s),
 * so it can be supervised as a Windows Service (NSSM). Each pass is isolated:
 * a failure is logged and retried next tick — the service never dies on a
 * transient DB blip. Set SYNC_ONCE=true for a single pass (dev/CI).
 *
 * Logging goes through @sms/shared's createLogger (roadmap Phase 2 item 6):
 * the inline `log()` this file used to carry was the same JSON shape, but
 * private to it — the retry warnings, the lock messages and the per-table
 * halts were bare console strings that could not be correlated with the
 * summary line of the pass they belonged to. Every line the runner writes
 * now carries the pass `runId` as `correlationId`.
 */
import { createLogger } from '@sms/shared';
import { loadDotEnv, loadSyncConfig } from './config.js';
import { runPass } from './pass.js';
import { TableHaltsError } from './runner.js';
import type { FullSyncResult } from './pipeline.js';

const log = createLogger('sync-worker');

function summarise(started: number, r: FullSyncResult, halted: number): void {
  const rawWritten = r.reader.reduce((s, o) => s + o.written, 0);
  const canonWritten = r.transform.reduce((s, o) => s + o.written, 0);
  const dq = r.transform
    .flatMap((o) => o.findings)
    .reduce((m, f) => ({ ...m, [f.severity]: (m[f.severity] ?? 0) + 1 }), {} as Record<string, number>);
  log.info('sync pass complete', {
    ms: Date.now() - started,
    sourceProbeMs: r.sourceProbeMs,
    rawWritten,
    canonWritten,
    dq,
    ...(halted > 0 ? { haltedTables: halted } : {}),
  });
  if (r.productMirrorError) {
    log.warn('PDAS product mirror failed (ingestion ran; recorded as a finding)', { error: r.productMirrorError });
  }
}

async function onePass(cfg: ReturnType<typeof loadSyncConfig>): Promise<void> {
  const started = Date.now();
  try {
    summarise(started, await runPass(cfg), 0);
  } catch (err) {
    // A pass in which SOME tables halted still transformed the rest
    // (per-table isolation, Phase 2). Log what did happen, then the halts —
    // and still throw, so `--once` exits 1 and the loop logs the failure.
    if (err instanceof TableHaltsError && err.partial) {
      summarise(started, err.partial as FullSyncResult, err.halts.length);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadSyncConfig();
  // --once CLI flag as well as the env var: npm scripts on Windows run through
  // cmd.exe, which doesn't support `VAR=val node ...` shell syntax, so the
  // flag is the portable way to request a single pass from package.json.
  const once = process.env.SYNC_ONCE === 'true' || process.argv.includes('--once');
  // Validated in loadSyncConfig: a non-numeric SYNC_INTERVAL_SECONDS used to
  // reach setTimeout as NaN, which Node runs as 1 ms — a tight loop.
  const intervalMs = cfg.intervalSeconds * 1000;

  log.info('starting', {
    line: cfg.lineId,
    source: `${cfg.iflData.database}@${cfg.iflData.server}:${cfg.iflData.port}`,
    mode: once ? 'once' : `loop ${cfg.intervalSeconds}s`,
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
      log.error('sync pass failed (will retry next tick)', { error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((err) => {
  log.error('fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
