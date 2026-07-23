/**
 * Sync runner (Step 2 scope: Reader -> raw). Source-agnostic orchestration:
 * fingerprint gate -> read since (watermark - overlap) -> idempotent raw insert
 * -> sync_run audit. Transform->canonical is Step 3.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionPool } from 'mssql';
import type { SyncConfig } from './config.js';
import { IFL_TABLES } from './reader/iflTables.js';
import { IflSqlAdapter } from './reader/IflSqlAdapter.js';
import { persistRaw } from './raw/persistRaw.js';
import { withRetry } from './util/retry.js';
import {
  getConfig,
  setConfig,
  getWatermark,
  startSyncRun,
  finishSyncRun,
} from './store.js';

export interface TableOutcome {
  table: string;
  read: number;
  written: number;
  watermarkFrom: number;
}

export async function runOnce(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  cfg: SyncConfig,
): Promise<TableOutcome[]> {
  const runId = randomUUID();
  const outcomes: TableOutcome[] = [];

  for (const def of IFL_TABLES) {
    const adapter = new IflSqlAdapter(iflPool, def);

    // schema fingerprint gate (§7): trust-on-first-run, then halt on drift
    const current = await adapter.fingerprint();
    const key = `fingerprint.${def.sourceTable}`;
    const expected = await getConfig(appPool, key);
    if (expected === null) {
      await setConfig(appPool, key, current);
    } else if (expected !== current) {
      throw new Error(
        `Schema drift on ${def.sourceTable}: expected ${expected}, got ${current}. ` +
          `Sync halted to protect canonical. Review the source schema before resuming.`,
      );
    }

    const watermark = await getWatermark(appPool, def.rawTable, cfg.lineId);
    // floor at -1, not 0: at least one IFL table (rejectWeight1_TP1U2) has a
    // legitimate row with id = 0, and `id > afterId` would otherwise skip it.
    const afterId = Math.max(-1, watermark - cfg.overlapRows);
    const syncRunId = await startSyncRun(appPool, {
      runId,
      adapter: 'ifl_sql',
      targetTable: def.rawTable.replace('sms_raw.', ''),
      lineId: cfg.lineId,
      watermarkFrom: watermark,
    });

    try {
      const records = await withRetry(() => adapter.readSince(afterId), {
        onRetry: (n, err) =>
          console.warn(`  retry ${n} reading ${def.sourceTable}: ${String(err)}`),
      });
      const { read, written } = await persistRaw(
        appPool,
        def,
        cfg.lineId,
        runId,
        records,
      );
      const newWatermark = await getWatermark(appPool, def.rawTable, cfg.lineId);
      await finishSyncRun(appPool, syncRunId, {
        watermarkTo: newWatermark,
        rowsRead: read,
        rowsWritten: written,
        outcome: 'success',
      });
      outcomes.push({ table: def.rawTable, read, written, watermarkFrom: watermark });
    } catch (err) {
      await finishSyncRun(appPool, syncRunId, {
        watermarkTo: watermark,
        rowsRead: 0,
        rowsWritten: 0,
        outcome: 'failed',
        error: String(err),
      });
      throw err;
    }
  }
  return outcomes;
}
