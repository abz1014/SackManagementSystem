/** API entrypoint: load config, open app-DB pool, start Express. */
import { loadDotEnv, createPool } from '@sms/sync-worker';
import { loadApiConfig } from './config.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadApiConfig();
  const pool = await createPool(cfg.appDb);
  const app = createApp(pool, cfg);
  app.listen(cfg.port, () => {
    console.log(`api listening on http://localhost:${cfg.port} (db=${cfg.appDb.database})`);
  });
}

main().catch((err) => {
  console.error('api failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
