/** API entrypoint: load config, open app-DB pool, start Express. */
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { loadDotEnv, createPool } from '@sms/sync-worker';
import { loadApiConfig } from './config.js';
import { createApp } from './app.js';
import { plantOffsetMinutes } from './services/plantClock.js';
import { markDegraded, SERVICE_VERSION } from './services/health.js';
import { log } from './log.js';

/**
 * Cross-checks PLANT_UTC_OFFSET_MINUTES (if set) against this process's own
 * OS timezone (finding M6, Sep 2026 audit). plantClock.ts's whole two-clocks
 * design assumes the deployment host's timezone equals the plant's; nothing
 * previously verified that, and a mismatch fails silently by exactly the
 * offset — five hours on this plant. A loud warning, not a crash: getting
 * this check wrong must never be worse than not having it.
 */
function checkPlantOffset(expectedMinutes: number | undefined): void {
  if (expectedMinutes == null) return;
  const actual = plantOffsetMinutes();
  if (actual !== expectedMinutes) {
    // One JSON line since 14 Sep 2026 (roadmap Phase 2 item 6); the three
    // numbers are fields so a monitor can alert on `offsetMismatchMinutes`.
    log.warn(
      `plantClock: this host's OS timezone reports a UTC offset of ${actual} minutes, ` +
        `but PLANT_UTC_OFFSET_MINUTES says the plant is at ${expectedMinutes}. Every production/app-time ` +
        `comparison in this app (product changeovers, calibration adjustments, live status) will be off by ` +
        `${actual - expectedMinutes} minutes until this host's timezone matches the plant's.`,
      { hostOffsetMinutes: actual, plantOffsetMinutes: expectedMinutes, offsetMismatchMinutes: actual - expectedMinutes },
    );
  }
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
  const cfg = loadApiConfig();
  checkPlantOffset(cfg.plantUtcOffsetMinutes);
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
