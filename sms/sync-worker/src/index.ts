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
 *
 * Since roadmap Phase 11 (14 Sep 2026) the loop also keeps house:
 *   - on start it closes sync_run rows a previous process left 'running';
 *   - it counts consecutive failed passes and raises `persistent_sync_failure`
 *     at SYNC_FAILURE_CRITICAL_AFTER, clearing it on the next success;
 *   - once an hour it checks the data file against the Express cap;
 *   - SIGTERM/SIGINT let the pass in flight finish (bounded), then exit.
 * The housekeeping opens its own short-lived app pool: the pass owns its
 * pools and closes them (pass.ts), so there is none to borrow between passes.
 */
import type { ConnectionPool } from 'mssql';
import { randomUUID } from 'node:crypto';
import { createLogger, checkPlantOffset } from '@sms/shared';
import { loadDotEnv, loadSyncConfig, type SyncConfig } from './config.js';
import { createPool } from './db.js';
import { runPass } from './pass.js';
import { TableHaltsError } from './runner.js';
import type { FullSyncResult } from './pipeline.js';
import { clearFindings, persistFindings } from './transform/dq.js';
import {
  checkDatabaseSize,
  clearPersistentFailure,
  FailureStreak,
  raisePersistentFailure,
  reconcileOrphanedRuns,
  sizeCheckDue,
} from './housekeeping.js';

const log = createLogger('sync-worker');

/**
 * Check name for the plant-clock cross-check below — not in dq.ts's
 * CHECK_NAMES, the same way housekeeping.ts's PERSISTENT_SYNC_FAILURE and
 * DATABASE_SIZE aren't: check names are owned by whichever module raises
 * them (see dq.ts's CHECK_NAMES comment).
 */
export const PLANT_CLOCK_MISMATCH = 'plant_clock_mismatch';

/**
 * Cross-checks PLANT_UTC_OFFSET_MINUTES against this host's OS timezone —
 * the same check the API has run since finding M6 (api/src/index.ts),
 * extended here for roadmap H7 (15 Sep 2026) because THIS process is the one
 * that actually stamps production_ts_utc_ms on every ingested row; a
 * mismatch is silent by exactly the offset (five hours on this plant) and a
 * freshly imaged Windows Server — the owner supplies the plant PC, per IFL's
 * 15 Sep answer — defaults to UTC.
 *
 * Unlike the API, the worker keeps its own pool and can afford a standing
 * `dq_finding`, so a mismatch here is not just a log line: it is a WARNING
 * finding on the Operations screen, raised once at startup and cleared at
 * the next startup where the check agrees — the same "state finding" pattern
 * clearFindings/persistFindings already use for product_mirror_failed and
 * persistent_sync_failure (dq.ts, housekeeping.ts). Not fatal, and not
 * retried mid-run: this is static configuration, so re-checking every pass
 * would only repeat the same answer until the process restarts.
 */
async function checkPlantOffsetOnStartup(cfg: SyncConfig, pool: ConnectionPool): Promise<void> {
  const result = checkPlantOffset(cfg.plantUtcOffsetMinutes);
  if (!result.checked) return; // PLANT_UTC_OFFSET_MINUTES unset: nothing to compare, nothing to clear
  if (!result.mismatched) {
    await clearFindings(pool, PLANT_CLOCK_MISMATCH);
    return;
  }
  log.warn(result.message, {
    hostOffsetMinutes: result.hostOffsetMinutes,
    plantOffsetMinutes: result.plantOffsetMinutes,
    offsetMismatchMinutes: result.offsetMismatchMinutes,
  });
  await persistFindings(pool, randomUUID(), [
    { check_name: PLANT_CLOCK_MISMATCH, severity: 'WARNING', subject_table: null, count: 1, detail: result.message },
  ]);
}

/** How long a stop signal waits for the pass in flight before exiting anyway. */
const STOP_DEADLINE_MS = 30_000;

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

async function onePass(cfg: SyncConfig): Promise<void> {
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

/** Open the app pool, run `fn`, close it — for the housekeeping between passes. Never throws. */
async function withAppPool(cfg: SyncConfig, what: string, fn: (pool: ConnectionPool) => Promise<void>): Promise<void> {
  let pool: ConnectionPool | null = null;
  try {
    pool = await createPool(cfg.app);
    await fn(pool);
  } catch (err) {
    log.warn(`housekeeping: ${what} failed (will retry)`, { what, error: err instanceof Error ? err.message : String(err) });
  } finally {
    await pool?.close().catch(() => {});
  }
}

/** Sleep that a stop signal can cut short. */
function interruptibleSleep(ms: number, stop: { requested: boolean; wake: () => void }): Promise<void> {
  return new Promise((resolve) => {
    if (stop.requested) return resolve();
    const t = setTimeout(resolve, ms);
    stop.wake = () => {
      clearTimeout(t);
      resolve();
    };
  });
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
    failureCriticalAfter: cfg.failureCriticalAfter,
  });

  // Once at startup, static config vs. this host's OS timezone — see the
  // function doc for why the worker gets its own standing finding rather
  // than just a log line (roadmap H7, 15 Sep 2026).
  await withAppPool(cfg, 'plant clock cross-check', (pool) => checkPlantOffsetOnStartup(cfg, pool));

  // Rows a previous process left 'running' (a crash, a kill, a power cut).
  // Older than two intervals: anything younger may be a pass genuinely in
  // flight elsewhere. Done before the first pass so the in-flight checks in
  // rebuild/cutover/purge see the truth from the first minute.
  await withAppPool(cfg, 'orphan reconciliation', async (pool) => {
    const n = await reconcileOrphanedRuns(pool, cfg.lineId, 2 * cfg.intervalSeconds);
    if (n > 0) log.warn('closed orphaned sync_run rows from a previous process', { rows: n });
  });

  if (once) {
    await onePass(cfg);
    // A single pass that succeeds is a success like any other: if a previous
    // service process left `persistent_sync_failure` standing, an operator's
    // `sms sync` / `--once` after fixing the cause must clear it too. Found in
    // the 15 Sep 2026 recovery rehearsal — the finding survived a clean
    // one-shot pass because only the loop cleared it.
    await withAppPool(cfg, 'clearing the persistent failure finding', clearPersistentFailure);
    return;
  }

  // ---- stop signals ---------------------------------------------------------
  // The pass in flight is allowed to finish (its pools close in pass.ts's
  // finally); the sleep is cut short; a bounded deadline exits anyway so a
  // hung source connection cannot hold the service in "stopping" until NSSM
  // kills it. An interrupted pass leaves 'running' rows, which the next start
  // reconciles above — so aborting at the deadline is clean, not silent.
  const stop = { requested: false, wake: () => {} };
  let passInFlight = false;
  const onSignal = (signal: string) => {
    if (stop.requested) return;
    stop.requested = true;
    log.info(`sync-worker stopping on ${signal}`, { signal, passInFlight });
    stop.wake();
    if (passInFlight) {
      const t = setTimeout(() => {
        log.warn('stop deadline reached with a pass still in flight; exiting (the next start reconciles its rows)', {
          deadlineMs: STOP_DEADLINE_MS,
        });
        process.exit(0);
      }, STOP_DEADLINE_MS);
      t.unref();
    }
  };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));

  const streak = new FailureStreak(cfg.failureCriticalAfter);
  let lastSizeCheckMs: number | null = null;

  // continuous loop — never throws out of the service
  while (!stop.requested) {
    passInFlight = true;
    let lastReason: string | null = null;
    let failed = false;
    try {
      await onePass(cfg);
    } catch (err) {
      failed = true;
      lastReason = err instanceof Error ? err.message : String(err);
      log.error('sync pass failed (will retry next tick)', { error: lastReason, consecutiveFailures: streak.length + 1 });
    } finally {
      passInFlight = false;
    }

    if (failed) {
      if (streak.fail()) {
        log.error('persistent sync failure — raising the CRITICAL finding', { consecutive: streak.length, threshold: cfg.failureCriticalAfter });
        await withAppPool(cfg, 'persistent failure finding', (pool) =>
          raisePersistentFailure(pool, streak.length, cfg.failureCriticalAfter, lastReason),
        );
      }
    } else if (streak.succeed()) {
      await withAppPool(cfg, 'clearing the persistent failure finding', clearPersistentFailure);
    }

    // Hourly, and only after a pass that reached the database at all.
    if (!failed && sizeCheckDue(lastSizeCheckMs, Date.now())) {
      lastSizeCheckMs = Date.now();
      await withAppPool(cfg, 'database size check', async (pool) => {
        const r = await checkDatabaseSize(pool);
        if (r.warned) log.warn('app database data file is near the Express cap', { sizeMb: r.sizeMb });
        else log.info('database size checked', { sizeMb: r.sizeMb });
      });
    }

    if (stop.requested) break;
    await interruptibleSleep(intervalMs, stop);
  }
  log.info('sync-worker stopped');
}

main().catch((err) => {
  log.error('fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
