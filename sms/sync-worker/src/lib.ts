/** Public library surface of the sync-worker, consumed by @sms/cli. */
export { loadDotEnv, loadSyncConfig, type SyncConfig, type DbConfig } from './config.js';
export { createPool } from './db.js';
export { seedReference } from './seed/seedReference.js';
export { runOnce, type TableOutcome } from './runner.js';
export { runTransform, type TransformOutcome } from './transform/runTransform.js';
export { runFullSync, type FullSyncResult } from './pipeline.js';
export { IFL_TABLES } from './reader/iflTables.js';
