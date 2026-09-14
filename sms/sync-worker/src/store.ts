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

/**
 * Highest source id already ingested for this line WITHIN ONE GENERATION.
 *
 * Scoped by epoch because IFL's `id` restarts: they recreated the four wide
 * tables on 2026-08-05 and every identity went back to 1. An unscoped MAX would
 * return July's 142,511 while reading a source whose ids run 1..132,552, so the
 * reader would ask for `id > 142011`, get nothing, and report success forever.
 *
 * Returns null — not 0 — when this generation has no rows yet. The distinction
 * matters: the "watermark went backwards" gate must not fire on a brand-new
 * epoch that legitimately has nothing, and `0` is itself a legitimate watermark
 * (rejectWeight1_TP1U2 has a real row at src_id = 0).
 */
export async function getWatermark(
  pool: ConnectionPool,
  rawTable: string,
  lineId: number,
  epochId: number,
): Promise<number | null> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('epoch', mssql.Int, epochId)
    .query<{ wm: number | null }>(
      `SELECT MAX(src_id) AS wm FROM ${rawTable} WHERE line_id = @line AND source_epoch = @epoch`,
    );
  const wm = r.recordset[0]?.wm;
  return wm == null ? null : Number(wm);
}

export interface SyncRunStart {
  runId: string;
  adapter: string;
  targetTable: string;
  lineId: number;
  watermarkFrom: number;
  /** Which source generation this pass read. Without it, watermark_from
   *  jumping from 204,076 to 1 is an uninterpretable number on the Setup panel. */
  sourceEpoch: number;
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
    .input('epoch', mssql.Int, s.sourceEpoch)
    .query<{ id: number }>(
      `INSERT INTO sms.sync_run (run_id, adapter, target_table, line_id, watermark_from, source_epoch)
       OUTPUT INSERTED.sync_run_id AS id
       VALUES (@run, @adapter, @tt, @line, @wm, @epoch)`,
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

export interface SyncRunHalt {
  runId: string;
  adapter: string;
  targetTable: string;
  lineId: number;
  /** Known only when the halt came after the generation was resolved. */
  sourceEpoch: number | null;
  /** Known only when the halt came after the watermark was read. */
  watermarkFrom: number | null;
  error: string;
}

/**
 * A table-run that stopped BEFORE it could open its own run row: an
 * unrecognised source generation, a source that went backwards, a table the
 * pass never reached because an earlier one halted, or a source connection
 * that never opened.
 *
 * Before this, such a halt wrote nothing. The newest row for the table stayed
 * the last good one — outcome 'success' — and the only symptom anywhere was
 * a rising age on the top bar, while `logs\sync.err.log` held the reason.
 * Setup's "N of 4 tables did not sync" line could not fire, because it counts
 * latest rows whose outcome is not 'success', and the halt had not written one.
 *
 * Written as a single already-finished INSERT, never INSERT-then-UPDATE, so a
 * crash between the two cannot leave a phantom 'running' row. `outcome` is
 * 'halted' rather than 'failed' so the two remain distinguishable: 'failed'
 * means the read or the write went wrong; 'halted' means the pass refused to
 * read at all, which is a decision, not a fault.
 */
export async function recordHaltedRun(pool: ConnectionPool, h: SyncRunHalt): Promise<void> {
  await pool
    .request()
    .input('run', mssql.UniqueIdentifier, h.runId)
    .input('adapter', mssql.VarChar(20), h.adapter)
    .input('tt', mssql.VarChar(40), h.targetTable)
    .input('line', mssql.Int, h.lineId)
    .input('wm', mssql.BigInt, h.watermarkFrom)
    .input('epoch', mssql.Int, h.sourceEpoch)
    .input('err', mssql.NVarChar(mssql.MAX), h.error)
    .query(
      `INSERT INTO sms.sync_run
         (run_id, adapter, target_table, line_id, watermark_from, watermark_to,
          rows_read, rows_written, outcome, error_text, source_epoch, finished_at_utc)
       VALUES (@run, @adapter, @tt, @line, @wm, @wm, 0, 0, 'halted', @err, @epoch, SYSUTCDATETIME())`,
    );
}
