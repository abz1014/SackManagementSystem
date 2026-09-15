/**
 * What the worker does for itself between passes — roadmap Phase 11 item 3
 * and item 4 (14 Sep 2026). Three things, each a defect the gap analysis
 * named:
 *
 *  1. ORPHANED RUNS. A pass writes a sync_run row with outcome 'running' and
 *     finishes it later. A crash or a kill between the two left that row
 *     'running' for ever — and `sms rebuild`'s in-flight check, which counts
 *     rows with no finished_at_utc, then refused every rebuild after any past
 *     crash. On start, the worker now closes every 'running' row older than
 *     twice its own interval as 'failed' with a reason that says what
 *     happened. Twice the interval, not "all of them", so a second worker
 *     instance mid-pass (which should not exist, but a misconfigured second
 *     service is exactly the kind of thing a plant PC grows) is not stamped
 *     failed by the first.
 *
 *  2. PERSISTENT FAILURE. ARCHITECTURE §14 promised a CRITICAL finding when
 *     the sync keeps failing; no check_name existed. A single halt is
 *     already a row on Setup › Sync health; N in a row is a different fact
 *     — the plant link is down, not blinking — and it is raised once as
 *     `persistent_sync_failure` and cleared by the next pass that succeeds,
 *     the pattern product_mirror_failed and transform_failed already use.
 *
 *  3. DATABASE SIZE. SQL Server Express caps the data file at 10 GB and
 *     nothing checked it (DEPLOY.md called it "never checked or planned
 *     for"). Once an hour the worker reads sys.database_files and raises a
 *     WARNING `database_size` finding at 80 % of the cap, cleared when the
 *     file is back under. Only the raw and canonical layers can bring it
 *     back under, and their retention is IFL's decision (item 4), so the
 *     finding says so.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { randomUUID } from 'node:crypto';
import { clearFindings, persistFindings } from './transform/dq.js';

/** Check names raised here. Not in dq.ts's CHECK_NAMES (that file is owned by Phase 4 this wave). */
export const PERSISTENT_SYNC_FAILURE = 'persistent_sync_failure';
export const DATABASE_SIZE = 'database_size';

/** SQL Server Express's per-database data-file ceiling, MB. */
export const EXPRESS_CAP_MB = 10240;
export const SIZE_WARN_PCT = 80;
export const SIZE_CHECK_INTERVAL_MS = 60 * 60_000;

export const ORPHAN_REASON = 'orphaned: the worker was restarted mid-pass';

/* -------------------------------------------------------- orphaned runs */

/**
 * Close 'running' rows older than `olderThanSeconds` as failed. Returns how
 * many. `finished_at_utc` is set so the in-flight check (`finished_at_utc IS
 * NULL`) stops counting them; `outcome` is 'failed', not 'halted', because
 * a halt is a decision the worker records on purpose and this was not.
 */
export async function reconcileOrphanedRuns(pool: ConnectionPool, lineId: number, olderThanSeconds: number): Promise<number> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('age', mssql.Int, Math.max(0, Math.round(olderThanSeconds)))
    .input('reason', mssql.NVarChar(mssql.MAX), ORPHAN_REASON)
    .query(
      `UPDATE sms.sync_run
          SET outcome = 'failed', error_text = @reason, finished_at_utc = SYSUTCDATETIME()
        WHERE line_id = @line AND outcome = 'running' AND finished_at_utc IS NULL
          AND started_at_utc < DATEADD(SECOND, -@age, SYSUTCDATETIME())`,
    );
  return r.rowsAffected[0] ?? 0;
}

/* --------------------------------------------------- persistent failure */

/**
 * Pure: counts consecutive failed passes and says when the finding should
 * be written or cleared, so the decision is testable without a database.
 *
 *  - `fail()` returns true exactly when the streak reaches the threshold —
 *    write once, not once per pass (persistFindings would dedupe anyway, but
 *    the pool open it costs is not free).
 *  - `succeed()` returns true when a finding MAY be standing: after a streak
 *    that reached the threshold, or on the first success after start
 *    (a finding from a previous process could still be there).
 */
export class FailureStreak {
  private streak = 0;
  /** Unknown at start: a previous process may have left the finding standing. */
  private maybeStanding = true;

  constructor(private readonly threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1) throw new Error(`threshold must be a whole number >= 1, got ${threshold}`);
  }

  get length(): number {
    return this.streak;
  }

  fail(): boolean {
    this.streak += 1;
    if (this.streak === this.threshold) {
      this.maybeStanding = true;
      return true;
    }
    return false;
  }

  succeed(): boolean {
    this.streak = 0;
    const clear = this.maybeStanding;
    this.maybeStanding = false;
    return clear;
  }
}

export async function raisePersistentFailure(pool: ConnectionPool, consecutive: number, threshold: number, lastReason: string | null): Promise<void> {
  await persistFindings(pool, randomUUID(), [
    {
      check_name: PERSISTENT_SYNC_FAILURE,
      severity: 'CRITICAL',
      subject_table: null,
      count: consecutive,
      // Stable text (no counter) so the dedupe in persistFindings holds; the
      // newest reason is already on Setup › Sync health from the halt row.
      detail:
        `${threshold} or more sync passes in a row have failed or halted; no new readings are reaching this ` +
        `system. The per-table rows below carry the worker's reason. Cleared automatically by the next pass that succeeds.` +
        (lastReason ? ` Last reason: ${lastReason.slice(0, 160)}` : ''),
    },
  ]);
}

export async function clearPersistentFailure(pool: ConnectionPool): Promise<void> {
  await clearFindings(pool, PERSISTENT_SYNC_FAILURE);
}

/* -------------------------------------------------------- database size */

/** Data-file size (ROWS files) of the current database, MB; null if unreadable. */
export async function dataFileSizeMb(pool: ConnectionPool): Promise<number | null> {
  const r = await pool
    .request()
    .query<{ size_mb: number | null }>(
      `SELECT SUM(CAST(size AS bigint)) * 8 / 1024.0 AS size_mb FROM sys.database_files WHERE type_desc = 'ROWS'`,
    );
  const v = r.recordset[0]?.size_mb;
  return v == null ? null : Math.round(Number(v) * 10) / 10;
}

/** Pure: the sentence the finding carries, or null when under the threshold. */
export function sizeWarning(sizeMb: number | null, capMb = EXPRESS_CAP_MB, warnPct = SIZE_WARN_PCT): { pct: number; detail: string } | null {
  if (sizeMb == null) return null;
  const pct = Math.round((sizeMb / capMb) * 1000) / 10;
  if (pct < warnPct) return null;
  return {
    pct,
    detail:
      `The app database's data file is ${Math.round(sizeMb)} MB, ${Math.round(pct)} % of SQL Server Express's ` +
      `${Math.round(capMb / 1024)} GB cap. At 100 % every write fails and ingestion stops. Only the raw and canonical ` +
      `readings can bring it down, and how long IFL wants them kept has not been decided — see DEPLOY.md, Retention.`,
  };
}

/**
 * The hourly check. Clear-then-raise when over (so the row's text tracks
 * the current size), clear alone when under: a state finding, as
 * product_mirror_failed is.
 */
export async function checkDatabaseSize(pool: ConnectionPool): Promise<{ sizeMb: number | null; warned: boolean }> {
  const sizeMb = await dataFileSizeMb(pool);
  const w = sizeWarning(sizeMb);
  await clearFindings(pool, DATABASE_SIZE);
  if (!w) return { sizeMb, warned: false };
  await persistFindings(pool, randomUUID(), [
    { check_name: DATABASE_SIZE, severity: 'WARNING', subject_table: null, count: 1, detail: w.detail },
  ]);
  return { sizeMb, warned: true };
}

/**
 * Pure: is the hourly check due? `lastAtMs` null = never run this process,
 * so the first pass checks — an operator restarting the service to see the
 * number should not wait an hour.
 */
export function sizeCheckDue(lastAtMs: number | null, nowMs: number, intervalMs = SIZE_CHECK_INTERVAL_MS): boolean {
  return lastAtMs == null || nowMs - lastAtMs >= intervalMs;
}
