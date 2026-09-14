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
import { persistFindings } from './transform/dq.js';
import { resolveEpoch } from './epoch.js';
import { withRetry } from './util/retry.js';
import { getWatermark, startSyncRun, finishSyncRun } from './store.js';

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

    // ---- generation gate ------------------------------------------------------
    // Resolve WHICH generation of this source table we are reading before doing
    // anything else. resolveEpoch halts on an unknown generation, on a changed
    // server/database, and on column drift within a live generation — the schema
    // fingerprint now lives on the epoch row, because it is a property of a
    // generation rather than of a table name.
    //
    // Order matters: the watermark is meaningless until the generation is known,
    // since `id` restarts with each one.
    const epoch = await resolveEpoch(appPool, iflPool, def, cfg.lineId, cfg.iflData);

    const watermark = await getWatermark(appPool, def.rawTable, cfg.lineId, epoch.epoch_id);

    // ---- restore / reseed gate -----------------------------------------------
    // resolveEpoch catches a source that was REPLACED (new create_date). It
    // cannot catch a source RESTORED FROM BACKUP: same table, same create_date,
    // ids rewound. Nothing about the schema changes, so only the numbers betray
    // it — a watermark above everything the source holds cannot be produced by
    // inserting rows.
    //
    // Guarded on `watermark !== null`, not `> 0`: a freshly accepted generation
    // legitimately has no rows yet and must not be blocked, while 0 is itself a
    // real watermark (rejectWeight1_TP1U2 has a genuine row at src_id = 0).
    const sourceMax = await adapter.maxSourceId();
    if (watermark !== null && (sourceMax === null || sourceMax < watermark)) {
      throw new Error(
        `Source ${def.sourceTable} has gone backwards within generation ${epoch.epoch_id} ` +
          `("${epoch.label}"): our watermark is ${watermark} but the source's highest id is ` +
          `${sourceMax === null ? 'none (table empty)' : sourceMax}. The source was restored, ` +
          `purged or reseeded without being recreated. Reading on would ingest nothing and ` +
          `report success. Sync halted.`,
      );
    }

    // floor at -1, not 0: at least one IFL table (rejectWeight1_TP1U2) has a
    // legitimate row with id = 0, and `id > afterId` would otherwise skip it.
    const afterId = Math.max(-1, (watermark ?? 0) - cfg.overlapRows);
    const syncRunId = await startSyncRun(appPool, {
      runId,
      adapter: 'ifl_sql',
      targetTable: def.rawTable.replace('sms_raw.', ''),
      lineId: cfg.lineId,
      watermarkFrom: watermark ?? 0,
      sourceEpoch: epoch.epoch_id,
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
        epoch.epoch_id,
      );
      // Read something, wrote nothing — every row was discarded as already-seen.
      //
      // Re-reading the overlap window and writing none of it is NORMAL: that is
      // exactly what the 500-row overlap is for. So only a batch that EXCEEDS the
      // overlap and still writes nothing is suspicious. Now that the dedupe probe
      // is epoch-scoped, that can only mean the id space was reused INSIDE one
      // generation — which is a real fault, not a curiosity, so it halts the
      // table's pass rather than logging and carrying on.
      //
      // Without this the discard is invisible: `written` simply comes back below
      // `read` and nothing compares the two.
      if (read > cfg.overlapRows && written === 0) {
        const detail =
          `${read} rows read from ${def.sourceTable} (generation ${epoch.epoch_id}) and none ` +
          `written — every row was already present by (line_id, source_epoch, src_id). Beyond ` +
          `the ${cfg.overlapRows}-row overlap this means the id space was reused within a ` +
          `single generation.`;
        await persistFindings(appPool, runId, [
          {
            check_name: 'raw_read_without_write',
            severity: 'ERROR',
            subject_table: def.rawTable.replace('sms_raw.', ''),
            count: read,
            detail,
          },
        ]);
        throw new Error(detail);
      }

      const newWatermark = await getWatermark(appPool, def.rawTable, cfg.lineId, epoch.epoch_id);
      await finishSyncRun(appPool, syncRunId, {
        watermarkTo: newWatermark ?? 0,
        rowsRead: read,
        rowsWritten: written,
        outcome: 'success',
      });
      outcomes.push({ table: def.rawTable, read, written, watermarkFrom: watermark ?? 0 });
    } catch (err) {
      await finishSyncRun(appPool, syncRunId, {
        watermarkTo: watermark ?? 0,
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
