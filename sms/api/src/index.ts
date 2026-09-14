/** API entrypoint: load config, open app-DB pool, start Express. */
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { loadDotEnv, createPool } from '@sms/sync-worker';
import { loadApiConfig } from './config.js';
import { createApp } from './app.js';
import { plantOffsetMinutes } from './services/plantClock.js';

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
    console.error(
      `[plantClock] WARNING: this host's OS timezone reports a UTC offset of ${actual} minutes, ` +
        `but PLANT_UTC_OFFSET_MINUTES says the plant is at ${expectedMinutes}. Every production/app-time ` +
        `comparison in this app (product changeovers, calibration adjustments, live status) will be off by ` +
        `${actual - expectedMinutes} minutes until this host's timezone matches the plant's.`,
    );
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadApiConfig();
  checkPlantOffset(cfg.plantUtcOffsetMinutes);
  const pool = await createPool(cfg.appDb);
  const app = createApp(pool, cfg);

  // Direct TLS termination (DEPLOY.md TLS section) — opt-in, two forms.
  // Unset (the default) preserves today's plain-HTTP behaviour exactly.
  const tlsOptions = cfg.tlsPfxPath && cfg.tlsPfxPassphrase
    ? { pfx: readFileSync(cfg.tlsPfxPath), passphrase: cfg.tlsPfxPassphrase } // Windows New-SelfSignedCertificate export
    : cfg.tlsCertPath && cfg.tlsKeyPath
      ? { cert: readFileSync(cfg.tlsCertPath), key: readFileSync(cfg.tlsKeyPath) } // PEM pair (openssl or a real CA)
      : null;
  if (tlsOptions) {
    createHttpsServer(tlsOptions, app).listen(cfg.port, () => {
      console.log(`api listening on https://localhost:${cfg.port} (db=${cfg.appDb.database})`);
    });
  } else {
    app.listen(cfg.port, () => {
      console.log(`api listening on http://localhost:${cfg.port} (db=${cfg.appDb.database})`);
    });
  }
}

main().catch((err) => {
  console.error('api failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
