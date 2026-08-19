/** API entrypoint: load config, open app-DB pool, start Express. */
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { loadDotEnv, createPool } from '@sms/sync-worker';
import { loadApiConfig } from './config.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadApiConfig();
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
