/** One full pass: seed reference, Reader→raw, Transform→canonical. Reused by
 *  the worker entrypoint and the CLI `sync` command. */
import type { ConnectionPool } from 'mssql';
import type { SyncConfig } from './config.js';
import { seedReference } from './seed/seedReference.js';
import { seedProducts } from './seed/seedProducts.js';
import { runOnce, type TableOutcome } from './runner.js';
import { runTransform, type TransformOutcome } from './transform/runTransform.js';

export interface FullSyncResult {
  reader: TableOutcome[];
  transform: TransformOutcome[];
}

export async function runFullSync(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  cfg: SyncConfig,
): Promise<FullSyncResult> {
  await seedReference(appPool, cfg);
  await seedProducts(appPool, iflPool, cfg.pdasDbName);
  const reader = await runOnce(appPool, iflPool, cfg);
  const transform = await runTransform(appPool, cfg);
  return { reader, transform };
}
