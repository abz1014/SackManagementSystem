/** Public library surface of the sync-worker, consumed by @sms/cli. */
export { loadDotEnv, loadSyncConfig, type SyncConfig, type DbConfig } from './config.js';
export { createPool } from './db.js';
export { seedReference } from './seed/seedReference.js';
export { runOnce, type TableOutcome } from './runner.js';
export {
  runTransform,
  resetTransformWatermarks,
  resolveShiftRule,
  type TransformOutcome,
} from './transform/runTransform.js';
export { runFullSync, type FullSyncResult } from './pipeline.js';
// The table NAMES are configuration since roadmap Phase 1 (sms.source_table);
// the CLI loads them per command with loadSourceTables. DEFAULT_IFL_TABLES is
// the seeded line-1 installation, for tests and documentation only.
export {
  DEFAULT_IFL_TABLES,
  TABLE_SHAPES,
  TABLE_KINDS,
  rawShortName,
  type IflTableDef,
  type TableKind,
} from './reader/iflTables.js';
export {
  loadSourceTables,
  loadSourceStreams,
  noSourceTablesError,
  type SourceStream,
} from './reader/sourceTables.js';
export {
  resolveEpoch,
  readSourceIdentity,
  openEpoch,
  type EpochRow,
  type SourceIdentity,
} from './epoch.js';
export { acquireTransformLock, withTransformLock, type TransformLock } from './lock.js';
