/**
 * Preconditions for the two commands that delete readings — `sms cutover`
 * and `sms epoch:purge` (roadmap Phase 11 item 3, 14 Sep 2026).
 *
 * `sms rebuild` had all three of these for a year; the two commands that
 * delete MORE than a rebuild had none: no lock against the worker's transform
 * pass, no check for a reader pass in flight, and no proof a backup existed.
 * The roadmap's acceptance line for Phase 11 is a restore test; a destructive
 * command that cannot name the snapshot it would be restored from has not
 * met it.
 *
 *  --backup=<path>   must name an EXISTING `.bak` file. Not "a snapshot id"
 *                    as rebuild takes (a name the operator typed): a path the
 *                    command can stat. The file is not opened or verified —
 *                    `RESTORE VERIFYONLY` is the backup script's job — but a
 *                    typo, a wrong drive or a backup that was never taken is
 *                    caught before anything is deleted.
 *  in-flight pass    a sync_run row with no finished_at_utc is a reader pass
 *                    writing raw rows and advancing watermarks right now.
 *                    Refuse; the pass is seconds long and 60 s apart. (An
 *                    orphaned row from a crash is reconciled by the worker on
 *                    its next start; until then this check names it and the
 *                    operator can see it on Setup › Sync health.)
 *  transform lock    the same sp_getapplock the worker's transform and the
 *                    rebuild take, so a DELETE here cannot interleave with a
 *                    transform writing canonical rows from the raw rows being
 *                    deleted.
 */
import { existsSync } from 'node:fs';
import type { ConnectionPool } from 'mssql';

export interface BackupFlagResult {
  ok: boolean;
  path: string | null;
  /** The sentence to print when not ok. */
  problem: string | null;
}

/**
 * Pure apart from the existence check, which is injectable. Accepts only a
 * string value (a bare `--backup` parses as `true`) that ends in `.bak`.
 */
export function requireBackupFlag(
  args: Record<string, string | boolean>,
  command: string,
  exists: (p: string) => boolean = existsSync,
): BackupFlagResult {
  const v = args.backup;
  if (typeof v !== 'string' || v.trim() === '') {
    return {
      ok: false,
      path: null,
      problem:
        `REFUSED: ${command} requires --backup=<path to a .bak file> naming the backup this database would be ` +
        `restored from if the command goes wrong. Take one first: scripts\\backup-appdb.ps1 (DEPLOY.md, Backup & restore). ` +
        `Nothing has been changed.`,
    };
  }
  const path = v.trim();
  if (!/\.bak$/i.test(path)) {
    return { ok: false, path, problem: `REFUSED: --backup must name a .bak file, got ${JSON.stringify(path)}. Nothing has been changed.` };
  }
  if (!exists(path)) {
    return { ok: false, path, problem: `REFUSED: --backup file does not exist: ${path}. Nothing has been changed.` };
  }
  return { ok: true, path, problem: null };
}

/** Rows of sms.sync_run with no finished_at_utc — a pass in progress (or an orphan the worker has not yet reconciled). */
export async function passesInFlight(pool: ConnectionPool): Promise<number> {
  const r = await pool
    .request()
    .query<{ n: number }>(`SELECT COUNT(*) AS n FROM sms.sync_run WHERE finished_at_utc IS NULL`);
  return Number(r.recordset[0]?.n ?? 0);
}

export function inFlightProblem(n: number, command: string): string {
  return (
    `REFUSED: ${n} sync_run row(s) have no finished_at_utc — a worker pass is in progress, or a crashed one was ` +
    `never reconciled (the worker closes those on its next start). Stop SMS-Sync or wait for the pass to settle, ` +
    `then re-run ${command}. Nothing has been changed.`
  );
}
