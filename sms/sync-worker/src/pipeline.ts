/** One full pass: seed reference, Reader→raw, Transform→canonical. Reused by
 *  the worker entrypoint and the CLI `sync` command. */
import type { ConnectionPool } from 'mssql';
import type { SyncConfig } from './config.js';
import { seedReference } from './seed/seedReference.js';
import { seedProducts } from './seed/seedProducts.js';
import { runOnce, type TableOutcome } from './runner.js';
import { runTransform, type TransformOutcome } from './transform/runTransform.js';
import { withTransformLock } from './lock.js';

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
  // Mutually exclusive with `sms rebuild` (finding C1, Sep 2026 audit): both
  // write the same canonical tables and transform watermarks, and nothing
  // previously stopped them running at the same time.
  const transform = await withTransformLock(cfg.app, () => runTransform(appPool, cfg));
  return { reader, transform };
}
