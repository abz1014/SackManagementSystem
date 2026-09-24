/** API entrypoint: load config, open app-DB pool, start Express. */
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { loadDotEnv, createPool } from '@sms/sync-worker';
import { checkPlantOffset } from '@sms/shared';
import { loadApiConfig, apiPoolOptions } from './config.js';
import { createApp } from './app.js';
import { markDegraded, SERVICE_VERSION } from './services/health.js';
import { log } from './log.js';
import { installProcessGuards } from './processGuards.js';

/**
 * Cross-checks PLANT_UTC_OFFSET_MINUTES (if set) against this process's own
 * OS timezone (finding M6, Sep 2026 audit). The comparison itself is
 * `@sms/shared`'s `checkPlantOffset` (moved there for roadmap H7, 15 Sep
 * 2026, so the sync worker — sync-worker/src/index.ts, same call, same
 * message shape — runs the identical check; it used to exist only here).
 * plantClock.ts's whole two-clocks design assumes the deployment host's
 * timezone equals the plant's; nothing previously verified that, and a
 * mismatch fails silently by exactly the offset — five hours on this plant.
 * A loud warning, not a crash: getting this check wrong must never be worse
 * than not having it (see @sms/shared's checkPlantOffset for why, at length
 * — the owner supplies the plant PC per IFL's 15 Sep answer, and a freshly
 * imaged Windows Server defaults to UTC).
 *
 * This log line is the API's contribution only. It does NOT call
 * markDegraded: that marker exists for pool connectivity and getHealth()
 * clears it unconditionally on the next successful DB probe (health.ts) —
 * using it for a standing config mismatch would make the warning flicker
 * away the moment /api/health is next polled, which reads as "it fixed
 * itself" when nothing did. The sync worker raises a proper standing
 * dq_finding instead (visible on the Operations screen, cleared only when
 * the check itself next agrees) — see sync-worker/src/index.ts. Giving the
 * API the same durable, screen-visible signal would need either a
 * non-self-clearing degraded reason in health.ts or a public findings
 * writer exported from @sms/sync-worker's lib.ts; both are out of this
 * change's scope and are a natural follow-up.
 */
function checkPlantOffsetOnStartup(expectedMinutes: number | undefined): void {
  const result = checkPlantOffset(expectedMinutes);
  if (!result.checked || !result.mismatched) return;
  // One JSON line since 14 Sep 2026 (roadmap Phase 2 item 6); the three
  // numbers are fields so a monitor can alert on `offsetMismatchMinutes`.
  log.warn(result.message, {
    hostOffsetMinutes: result.hostOffsetMinutes,
    plantOffsetMinutes: result.plantOffsetMinutes,
    offsetMismatchMinutes: result.offsetMismatchMinutes,
  });
}

/**
 * Stop accepting, drain, close the pool, exit — on SIGTERM (NSSM's stop, a
 * `Stop-Service`) and SIGINT (Ctrl+C at a console). Roadmap Phase 11 item 3
 * (14 Sep 2026): there was no handler, so a stop was Node's default — the
 * process died mid-request with sockets half-written and pooled connections
 * torn down by the OS rather than closed. `server.close()` stops new
 * connections and resolves once in-flight requests finish; the pool is
 * closed after that so no request loses its connection underneath it. A hard
 * deadline guards the drain: a hung request must not keep the service in
 * "stopping" for ever, which NSSM would eventually resolve by killing it.
 */
const SHUTDOWN_DEADLINE_MS = 10_000;
function installShutdown(server: { close(cb: (err?: Error) => void): unknown }, pool: { close(): Promise<void> }): void {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`api stopping on ${signal}`, { signal });
    const deadline = setTimeout(() => {
      log.warn('api shutdown deadline reached; exiting with requests still open', { deadlineMs: SHUTDOWN_DEADLINE_MS });
      process.exit(0);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    server.close(() => {
      pool
        .close()
        .catch((err) => log.warn('closing the pool failed during shutdown', { err: err instanceof Error ? err : { message: String(err) } }))
        .finally(() => {
          log.info('api stopped', { signal });
          process.exit(0);
        });
    });
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

async function main(): Promise<void> {
  loadDotEnv();
  // RT24-01 (CRITICAL): installed before anything can start handling
  // requests. Previously an unhandled promise rejection anywhere in the
  // process (e.g. authMiddleware's EPARAM on a malformed session cookie)
  // was fatal — Node's default for an unhandled rejection with no listener
  // is to exit. Now it is logged, marks the service degraded (visible on
  // /api/health), and the process keeps serving; only a genuine synchronous
  // uncaughtException still exits (NSSM restarts it, DEPLOY.md).
  installProcessGuards(log, markDegraded);
  const cfg = loadApiConfig();
  checkPlantOffsetOnStartup(cfg.plantUtcOffsetMinutes);
  // 16 Sep 2026 fix: without an explicit override, createPool falls back to
  // sync-worker's own batch profile (sync-worker/src/config.ts's
  // SYNC_POOL_DEFAULT / SYNC_REQUEST_TIMEOUT_MS: 5 connections, a 10-minute
  // requestTimeout) — sized for one single-threaded sync pass, not N
  // concurrent interactive readers. `dbPool`/`dbRequestTimeout` below are the
  // API's OWN values (config.ts's apiPoolOptions/DEFAULT_DB_POOL_MAX has the
  // reasoning); API_DB_POOL_MAX/MIN/IDLE_TIMEOUT_MS and
  // API_DB_REQUEST_TIMEOUT_MS can raise them without a rebuild.
  const { pool: dbPool, requestTimeout: dbRequestTimeout } = apiPoolOptions(cfg);
  const pool = await createPool(cfg.appDb, {
    // A pool-level error (a connection the server dropped, a failed
    // reconnect) is an EventEmitter 'error': with no listener Node treats it
    // as uncaught and the process dies — the gap analysis found no listener
    // in either process. Log it and mark the service degraded; /api/health
    // reports 'degraded' until the next probe succeeds (roadmap Phase 11).
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error('app-db pool error', { err: err instanceof Error ? err : { message } });
      markDegraded(`pool error: ${message}`);
    },
    pool: dbPool,
    requestTimeout: dbRequestTimeout,
  });
  const app = createApp(pool, cfg);

  // Direct TLS termination (DEPLOY.md TLS section) — opt-in, two forms.
  // Unset (the default) preserves today's plain-HTTP behaviour exactly.
  const tlsOptions = cfg.tlsPfxPath && cfg.tlsPfxPassphrase
    ? { pfx: readFileSync(cfg.tlsPfxPath), passphrase: cfg.tlsPfxPassphrase } // Windows New-SelfSignedCertificate export
    : cfg.tlsCertPath && cfg.tlsKeyPath
      ? { cert: readFileSync(cfg.tlsCertPath), key: readFileSync(cfg.tlsKeyPath) } // PEM pair (openssl or a real CA)
      : null;
  const server = tlsOptions
    ? createHttpsServer(tlsOptions, app).listen(cfg.port, () => {
        log.info(`api ${SERVICE_VERSION} listening on https://localhost:${cfg.port} (db=${cfg.appDb.database})`, {
          version: SERVICE_VERSION, port: cfg.port, tls: true, db: cfg.appDb.database,
        });
      })
    : app.listen(cfg.port, () => {
        log.info(`api ${SERVICE_VERSION} listening on http://localhost:${cfg.port} (db=${cfg.appDb.database})`, {
          version: SERVICE_VERSION, port: cfg.port, tls: false, db: cfg.appDb.database,
        });
      });
  installShutdown(server, pool);
}

main().catch((err) => {
  log.error('api failed to start', { err: err instanceof Error ? err : { message: String(err) } });
  process.exit(1);
});
