/** App-DB helpers: config, watermark, sync_run audit. Parameterised only. */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export async function getConfig(
  pool: ConnectionPool,
  key: string,
): Promise<string | null> {
  const r = await pool
    .request()
    .input('k', mssql.VarChar(64), key)
    .query<{ config_value: string }>(
      `SELECT config_value FROM sms.app_config WHERE config_key = @k`,
    );
  return r.recordset[0]?.config_value ?? null;
}

export async function setConfig(
  pool: ConnectionPool,
  key: string,
  value: string,
): Promise<void> {
  await pool
    .request()
    .input('k', mssql.VarChar(64), key)
    .input('v', mssql.NVarChar(255), value)
    .query(
      `MERGE sms.app_config AS t
       USING (SELECT @k AS k, @v AS v) AS s ON t.config_key = s.k
       WHEN MATCHED THEN UPDATE SET config_value = s.v, updated_at_utc = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (config_key, config_value) VALUES (s.k, s.v);`,
    );
}

/** Highest source id already in a raw table for this line (0 if empty). */
export async function getWatermark(
  pool: ConnectionPool,
  rawTable: string,
  lineId: number,
): Promise<number> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ wm: number }>(
      `SELECT ISNULL(MAX(src_id), 0) AS wm FROM ${rawTable} WHERE line_id = @line`,
    );
  return r.recordset[0]?.wm ?? 0;
}

export interface SyncRunStart {
  runId: string;
  adapter: string;
  targetTable: string;
  lineId: number;
  watermarkFrom: number;
}

export async function startSyncRun(
  pool: ConnectionPool,
  s: SyncRunStart,
): Promise<number> {
  const r = await pool
    .request()
    .input('run', mssql.UniqueIdentifier, s.runId)
    .input('adapter', mssql.VarChar(20), s.adapter)
    .input('tt', mssql.VarChar(40), s.targetTable)
    .input('line', mssql.Int, s.lineId)
    .input('wm', mssql.BigInt, s.watermarkFrom)
    .query<{ id: number }>(
      `INSERT INTO sms.sync_run (run_id, adapter, target_table, line_id, watermark_from)
       OUTPUT INSERTED.sync_run_id AS id
       VALUES (@run, @adapter, @tt, @line, @wm)`,
    );
  return r.recordset[0]!.id;
}

export interface SyncRunFinish {
  watermarkTo: number;
  rowsRead: number;
  rowsWritten: number;
  outcome: 'success' | 'failed';
  error?: string;
}

export async function finishSyncRun(
  pool: ConnectionPool,
  syncRunId: number,
  f: SyncRunFinish,
): Promise<void> {
  await pool
    .request()
    .input('id', mssql.BigInt, syncRunId)
    .input('wm', mssql.BigInt, f.watermarkTo)
    .input('read', mssql.Int, f.rowsRead)
    .input('written', mssql.Int, f.rowsWritten)
    .input('outcome', mssql.VarChar(12), f.outcome)
    .input('err', mssql.NVarChar(mssql.MAX), f.error ?? null)
    .query(
      `UPDATE sms.sync_run
         SET watermark_to = @wm, rows_read = @read, rows_written = @written,
             outcome = @outcome, error_text = @err, finished_at_utc = SYSUTCDATETIME()
       WHERE sync_run_id = @id`,
    );
}
