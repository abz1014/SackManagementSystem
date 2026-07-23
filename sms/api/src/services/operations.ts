/** Operations service (ARCHITECTURE §8): sync health, schema, DQ roll-up. */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface SyncStatus {
  targetTable: string;
  outcome: string;
  watermark: number | null;
  rowsRead: number;
  rowsWritten: number;
  finishedAtUtc: string | null;
  ageSeconds: number | null;
}

export interface OperationsData {
  sync: SyncStatus[];
  schema: { table: string; fingerprint: string; status: string }[];
  dq: {
    latestRunId: string | null;
    bySeverity: Record<string, number>;
    findings: { checkName: string; severity: string; subjectTable: string | null; detail: string | null }[];
  };
}

export async function getOperations(pool: ConnectionPool, lineId: number): Promise<OperationsData> {
  // latest sync_run per target_table
  const sync = await pool.request().input('line', mssql.Int, lineId).query<{
    target_table: string;
    outcome: string;
    watermark_to: number | null;
    rows_read: number;
    rows_written: number;
    finished_at_utc: Date | null;
    age_seconds: number | null;
  }>(`
    WITH latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY target_table ORDER BY sync_run_id DESC) rn
      FROM sms.sync_run WHERE line_id=@line
    )
    SELECT target_table, outcome, watermark_to, rows_read, rows_written, finished_at_utc,
           DATEDIFF(SECOND, finished_at_utc, SYSUTCDATETIME()) AS age_seconds
    FROM latest WHERE rn=1 ORDER BY target_table
  `);

  // schema fingerprints (baselined => ok; drift would have halted sync)
  const fp = await pool.request().query<{ config_key: string; config_value: string }>(
    `SELECT config_key, config_value FROM sms.app_config WHERE config_key LIKE 'fingerprint.%'`,
  );

  // DQ roll-up for the most recent run
  const latest = await pool.request().query<{ run_id: string }>(
    `SELECT TOP 1 run_id FROM sms.dq_finding ORDER BY finding_id DESC`,
  );
  const latestRunId = latest.recordset[0]?.run_id ?? null;

  const bySeverity: Record<string, number> = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 };
  let findings: OperationsData['dq']['findings'] = [];
  if (latestRunId) {
    const f = await pool.request().input('run', mssql.UniqueIdentifier, latestRunId).query<{
      check_name: string;
      severity: string;
      subject_table: string | null;
      detail: string | null;
    }>(
      `SELECT check_name, severity, subject_table, detail FROM sms.dq_finding WHERE run_id=@run ORDER BY severity`,
    );
    for (const r of f.recordset) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    findings = f.recordset.map((r) => ({
      checkName: r.check_name,
      severity: r.severity,
      subjectTable: r.subject_table,
      detail: r.detail,
    }));
  }

  return {
    sync: sync.recordset.map((r) => ({
      targetTable: r.target_table,
      outcome: r.outcome,
      watermark: r.watermark_to == null ? null : Number(r.watermark_to),
      rowsRead: r.rows_read,
      rowsWritten: r.rows_written,
      finishedAtUtc: r.finished_at_utc ? new Date(r.finished_at_utc).toISOString() : null,
      ageSeconds: r.age_seconds,
    })),
    schema: fp.recordset.map((r) => ({
      table: r.config_key.replace('fingerprint.', ''),
      fingerprint: r.config_value,
      status: 'ok',
    })),
    dq: { latestRunId, bySeverity, findings },
  };
}
