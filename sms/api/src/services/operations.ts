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

/**
 * Lifetime sync figures, from every row `sms.sync_run` holds.
 *
 * `sync_run` records one row PER TABLE PER PASS, so the row count is not the
 * number of times the worker has run — on the supplied copy it is 65 rows
 * across 17 passes of 4 tables. Reporting the row count as "runs" would
 * overstate the work by ~4x, so both are returned and the screen says which
 * it is showing.
 *
 * Durations are per table-run, not per query, and are held as milliseconds.
 */
export interface SyncLifetime {
  passes: number;
  tableRuns: number;
  failures: number;
  firstRunUtc: string | null;
  lastRunUtc: string | null;
  medianMs: number | null;
  p95Ms: number | null;
  slowestMs: number | null;
  lastFailure: { targetTable: string; startedAtUtc: string; error: string | null } | null;
}

export interface OperationsData {
  sync: SyncStatus[];
  lifetime: SyncLifetime;
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

  // lifetime roll-up: one pass writes one row per table, so passes and
  // table-runs are counted separately rather than conflated
  const life = await pool.request().input('line', mssql.Int, lineId).query<{
    passes: number;
    table_runs: number;
    failures: number;
    first_run: Date | null;
    last_run: Date | null;
    median_ms: number | null;
    p95_ms: number | null;
    slowest_ms: number | null;
  }>(`
    SELECT COUNT(DISTINCT run_id) AS passes,
           COUNT(*) AS table_runs,
           SUM(CASE WHEN outcome <> 'success' THEN 1 ELSE 0 END) AS failures,
           MIN(started_at_utc) AS first_run,
           MAX(started_at_utc) AS last_run,
           MAX(median_ms) AS median_ms,
           MAX(p95_ms) AS p95_ms,
           MAX(dur_ms) AS slowest_ms
    FROM (
      SELECT run_id, outcome, started_at_utc,
             DATEDIFF(MILLISECOND, started_at_utc, finished_at_utc) AS dur_ms,
             PERCENTILE_CONT(0.50) WITHIN GROUP (
               ORDER BY DATEDIFF(MILLISECOND, started_at_utc, finished_at_utc)) OVER () AS median_ms,
             PERCENTILE_CONT(0.95) WITHIN GROUP (
               ORDER BY DATEDIFF(MILLISECOND, started_at_utc, finished_at_utc)) OVER () AS p95_ms
      FROM sms.sync_run WHERE line_id = @line
    ) x
  `);
  const lr = life.recordset[0];

  // the most recent failure, so "1 failure" is actionable rather than a bare count
  const fail = await pool.request().input('line', mssql.Int, lineId).query<{
    target_table: string;
    started_at_utc: Date;
    error_text: string | null;
  }>(`
    SELECT TOP 1 target_table, started_at_utc, error_text
    FROM sms.sync_run WHERE line_id = @line AND outcome <> 'success'
    ORDER BY sync_run_id DESC
  `);
  const f0 = fail.recordset[0];

  const lifetime: SyncLifetime = {
    passes: Number(lr?.passes ?? 0),
    tableRuns: Number(lr?.table_runs ?? 0),
    failures: Number(lr?.failures ?? 0),
    firstRunUtc: lr?.first_run ? lr.first_run.toISOString() : null,
    lastRunUtc: lr?.last_run ? lr.last_run.toISOString() : null,
    medianMs: lr?.median_ms != null ? Math.round(Number(lr.median_ms)) : null,
    p95Ms: lr?.p95_ms != null ? Math.round(Number(lr.p95_ms)) : null,
    slowestMs: lr?.slowest_ms != null ? Math.round(Number(lr.slowest_ms)) : null,
    lastFailure: f0
      ? { targetTable: f0.target_table, startedAtUtc: f0.started_at_utc.toISOString(), error: f0.error_text }
      : null,
  };

  // schema fingerprints (baselined => ok; drift would have halted sync)
  const fp = await pool.request().query<{ config_key: string; config_value: string }>(
    `SELECT config_key, config_value FROM sms.app_config WHERE config_key LIKE 'fingerprint.%'`,
  );

  // DQ roll-up — ALL standing findings, not just the most recent run's.
  // Findings are batch-scoped since the Aug 2026 audit: each is recorded once,
  // when its rows are ingested, so a pass with nothing new records nothing.
  // "Latest run" would therefore usually be empty and HIDE the standing
  // faults; the full list is now the truthful standing state, bounded by real
  // faults (each row is one distinct ingest-time finding, deduplicated by
  // migration 016). TOP 200 is a display guard, not a pagination scheme.
  const bySeverity: Record<string, number> = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 };
  const f = await pool.request().query<{
    run_id: string;
    check_name: string;
    severity: string;
    subject_table: string | null;
    detail: string | null;
  }>(
    `SELECT TOP 200 run_id, check_name, severity, subject_table, detail
     FROM sms.dq_finding
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
              finding_id DESC`,
  );
  for (const r of f.recordset) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
  const findings: OperationsData['dq']['findings'] = f.recordset.map((r) => ({
    checkName: r.check_name,
    severity: r.severity,
    subjectTable: r.subject_table,
    detail: r.detail,
  }));
  // kept for API-shape stability: the run that recorded the newest finding
  const latestRunId = f.recordset[0]?.run_id ?? null;

  return {
    lifetime,
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
