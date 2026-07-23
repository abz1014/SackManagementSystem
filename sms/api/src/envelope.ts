/**
 * Standard response envelope (ARCHITECTURE §9): every payload carries metadata
 * so the UI can show freshness + which interpretation (weight/shift) is active.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface Meta {
  generatedAtUtc: string;
  weightBasis: string;
  shiftMode: string;
  transformVersion: number;
  lastSyncUtc: string | null;
  sourceAgeSeconds: number | null;
}

export interface Envelope<T> {
  data: T;
  metadata: Meta;
}

/** Read the active rule + freshness metadata for the response envelope. */
export async function loadMeta(pool: ConnectionPool, lineId: number): Promise<Meta> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    weightBasis: string | null;
    shiftMode: string | null;
    transformVersion: number | null;
    lastSyncUtc: Date | null;
    sourceAgeSeconds: number | null;
  }>(`
    SELECT
      (SELECT TOP 1 basis FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC) AS weightBasis,
      (SELECT TOP 1 mode  FROM sms.shift_rule  WHERE line_id=@line ORDER BY effective_from DESC) AS shiftMode,
      (SELECT MAX(transform_version) FROM sms.cone_event WHERE line_id=@line) AS transformVersion,
      (SELECT MAX(finished_at_utc) FROM sms.sync_run WHERE line_id=@line AND outcome='success') AS lastSyncUtc,
      DATEDIFF(SECOND,
        (SELECT MAX(finished_at_utc) FROM sms.sync_run WHERE line_id=@line AND outcome='success'),
        SYSUTCDATETIME()) AS sourceAgeSeconds
  `);
  const row = r.recordset[0];
  return {
    generatedAtUtc: new Date().toISOString(),
    weightBasis: row?.weightBasis ?? 'as_recorded',
    shiftMode: row?.shiftMode ?? 'corrected',
    transformVersion: row?.transformVersion ?? 0,
    lastSyncUtc: row?.lastSyncUtc ? new Date(row.lastSyncUtc).toISOString() : null,
    sourceAgeSeconds: row?.sourceAgeSeconds ?? null,
  };
}

export async function envelope<T>(
  pool: ConnectionPool,
  lineId: number,
  data: T,
): Promise<Envelope<T>> {
  return { data, metadata: await loadMeta(pool, lineId) };
}
