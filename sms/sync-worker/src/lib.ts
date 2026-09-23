/** Public library surface of the sync-worker, consumed by @sms/cli. */
export { loadDotEnv, loadSyncConfig, type SyncConfig, type DbConfig } from './config.js';
export { createPool, connectSource } from './db.js';
export { seedReference } from './seed/seedReference.js';
export { runOnce, probeSource, TableHaltsError, type TableOutcome, type TableHalt } from './runner.js';
export {
  createAdapter,
  classifyError,
  isTransient,
  REGISTERED_SYSTEM_CODES,
  type SourceAdapter,
  type ErrorClass,
  type ProbeResult,
} from './reader/SourceAdapter.js';
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
  assertSourceTableName,
  SOURCE_TABLE_NAME,
  type SourceStream,
} from './reader/sourceTables.js';
export {
  resolveEpoch,
  readSourceIdentity,
  openEpoch,
  checkColumnDrift,
  SOURCE_COLUMNS_CHANGED,
  type EpochRow,
  type SourceIdentity,
} from './epoch.js';
export { acquireTransformLock, withTransformLock, type TransformLock } from './lock.js';
export { clearPersistentFailure, raisePersistentFailure, PERSISTENT_SYNC_FAILURE } from './housekeeping.js';
