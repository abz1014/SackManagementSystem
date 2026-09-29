/**
 * Service, database and acquisition health in one answer — roadmap Phase 11
 * item 2 (14 Sep 2026).
 *
 * `/api/health` was `SELECT 1`. It could not tell a monitor that the sync
 * worker had halted, that the data file was a week from SQL Server Express's
 * 10 GB ceiling, or that the pool had thrown an error the process survived;
 * and the only place any of that was shown was Setup › Sync health, which is
 * admin-only while IFL's accounts are to be created at manager. This module
 * separates the three things "is it healthy" actually means:
 *
 *   service      this process — version, uptime, pid (a restart shows as a
 *                reset uptime, which is how an operator tells "it crashed
 *                and NSSM restarted it" from "it has been fine all week")
 *   database     reachable, how fast, and how full against the Express cap
 *   acquisition  the sync worker's verdict, from the same measured cadence
 *                and freshness as /api/live, plus every table it has halted on
 *
 * `status` folds them: `down` when the database cannot be reached at all;
 * `degraded` when the pool reported an error since the last good probe, the
 * acquisition is stale or late or halted, the data file is past 80 % of the
 * cap, a standing ERROR/CRITICAL data-quality finding exists, or the newest
 * backup is missing/stale; `ok` otherwise. A monitor needs only that word.
 *
 * WHY DQ FINDINGS AND BACKUP AGE ARE BOTH IN THE FOLD (21 Sep 2026 — three
 * independent audits found the Health screen's headline claiming "Everything
 * is healthy" a few lines above a non-zero blocking-findings count and a
 * stale-backup warning, both already computed and already rendered on the
 * same page). A severity a check itself marked ERROR/CRITICAL is, by the
 * database's own CK_dq_severity classification, something that needs
 * attention — a status called "healthy" that does not consult it is not
 * measuring what its name claims, so it folds in unconditionally. Backup
 * staleness is a weaker case — a host/ops fact rather than a data fact, and
 * it risks a permanently amber status on a dev box with no backup task
 * configured — but BACKUP_WARN_DAYS is not a guess: it is a named threshold
 * against a real nightly schedule, already surfaced as a warning on this
 * same screen, and leaving it out would reproduce the exact contradiction
 * this fold exists to remove, one block down. Both fold in. If the dev-box
 * noise proves a real problem, the fix is a per-environment override on
 * BACKUP_WARN_DAYS or backupDir, not silence in the one word meant to
 * summarise the page.
 *
 * REDACTION. The route is unauthenticated on purpose — a probe cannot hold a
 * session — but the database size and the acquisition details are facts
 * about the installation, so they are nulled for an anonymous caller and
 * filled in for a signed-in one. `status` is always computed from the full
 * picture: a monitor that could not see WHY still sees THAT. The same now
 * holds for the DQ finding count and the backup check: both are always
 * computed so `status` stays honest for the anonymous probe, and only their
 * detail (the backup block; the finding rows on Setup/Health) is redacted.
 *
 * BACKUP AGE is read-only from the directory the backup script writes to
 * (BACKUP_DIR), by file mtime. The API never writes there. Two days is the
 * warning threshold because the schedule is nightly: one missed night is a
 * blip, two is a stopped task.
 */
import { readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectionPool } from 'mssql';
import type { PdasPermissionStatus } from './pdasPermissions.js';
import mssql from 'mssql';
import {
  classifyHealth,
  emptyLiveGenerationNote,
  findNewerElsewhere,
  getSyncHealth,
  LAG_SAMPLE_ROWS,
  MAX_REPORTABLE_LAG_SECONDS,
  resolveLiveScope,
  type LiveGenerationNote,
  type LiveHealthKind,
} from './live.js';
import { epochFragment, noteOf } from './generation.js';

/** SQL Server Express's per-database data-file ceiling, in MB (10 GB). */
export const EXPRESS_CAP_MB = 10240;
/** Above this share of the cap the status degrades and the screen says so in a sentence. */
export const SIZE_WARN_PCT = 80;
/** A backup older than this many days is a warning (the schedule is nightly). */
export const BACKUP_WARN_DAYS = 2;
/**
 * Free disk space, MB, below which the probe degrades (W1-C, 29 Sep 2026,
 * failure analysis F-36). Named rather than inline so the same number backs
 * both the fold and the sentence that explains it. SQL Server Express can
 * still be well under its 10 GB data-file cap while the VOLUME itself is
 * nearly full — the log file, tempdb, other databases and this script's own
 * backup files all share the same disk — so this is a second, independent
 * check, not a restatement of EXPRESS_CAP_MB/SIZE_WARN_PCT above.
 */
export const FREE_DISK_WARN_MB = 2048;

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface ServiceHealth {
  version: string;
  uptimeSeconds: number;
  startedAtUtc: string;
  pid: number;
}

export interface DatabaseHealth {
  ok: boolean;
  latencyMs: number | null;
  /** Data file size (ROWS files), MB. Null when not signed in or not measurable. */
  sizeMb: number | null;
  capMb: typeof EXPRESS_CAP_MB;
  pctOfCap: number | null;
}

export interface AcquisitionHealth {
  /** The live health kind — the same classification the strip on every screen uses. */
  kind: LiveHealthKind | null;
  /** Seconds since the OLDEST source table last synced. */
  ageSeconds: number | null;
  /** Measured gap between passes. */
  cadenceSeconds: number | null;
  /** Target tables whose latest pass halted or failed. */
  halted: string[] | null;
  /**
   * Which source generation the acquisition figures describe, and the newest
   * reading on record that it does NOT contain (23 Sep 2026, D-11).
   *
   * Health is the screen whose whole job is to report breakage. Before this
   * it read the newest production instant across EVERY generation, so on a
   * sidecar carrying both IFL's September copy and the simulator it reported
   * the simulator's tip as the plant's own freshness and the simulator's
   * acquisition lag as IFL's. Null for an anonymous caller, like the rest of
   * the acquisition block.
   */
  generation: LiveGenerationNote | null;
}

export interface BackupHealth {
  dir: string;
  /**
   * The file being REPORTED — not necessarily the physically newest .bak in
   * the directory. When the newest one failed verification (see `verified`
   * requirements in `backupHealth`'s own doc comment below), this steps back
   * to the newest VERIFIED file instead, so the screen never states a
   * restorability claim about a file that was never proven restorable.
   */
  newestFile: string | null;
  newestAtUtc: string | null;
  ageDays: number | null;
  /** True when there is no verified backup, the newest is older than BACKUP_WARN_DAYS, or the newest .bak is unverified. */
  warning: boolean;
  /** Whether `newestFile` itself carries a matching, size-consistent `.verified.json` marker. False only when nothing verified exists at all. */
  verified: boolean;
  /**
   * True when the actual physically-newest `.bak` in the directory is NOT
   * verified (no marker, a size mismatch, or an unreadable marker) — whether
   * or not an older verified file was found to report instead. The screen's
   * job is to say this plainly even when `newestFile` above is a fine, older
   * backup: "the newest one isn't proven yet" is a fact worth stating on its
   * own, not silently absorbed into the older file's own good numbers.
   */
  newestUnverified: boolean;
}

/** One host volume's free space, MB, or null when it could not be measured (e.g. `statfsSync` unsupported/denied — never fatal). */
export interface DiskHealth {
  appDataFreeMb: number | null;
  backupFreeMb: number | null;
}

/**
 * RT24-05: whether the PDAS write login can read back what it writes, folded
 * from pdasPermissions.ts's direct SQL Server answer plus PdasWriter's own
 * in-memory record of what has actually happened since startup. Null when
 * writes are disabled (pdasWrite.ts's `enabled` is false — there is nothing
 * to check) or for an anonymous caller (redacted like acquisition/backup).
 */
export interface PdasWriteHealth {
  enabled: boolean;
  /** Null when the permission probe itself could not run (e.g. writes disabled, or the probe threw). */
  canReadBack: boolean | null;
  missingSelect: string[];
  missingExecute: string[];
  /** Subject tables with a standing CRITICAL 'pdas_write_unverified' finding — see pdasWrite.ts's raiseReadbackFailed. */
  unverifiedSinceStartup: string[];
  lastVerifiedUtc: string | null;
}

export interface HealthReport {
  status: HealthStatus;
  service: ServiceHealth;
  database: DatabaseHealth;
  acquisition: AcquisitionHealth;
  /** Only for a signed-in caller; null otherwise. */
  backup: BackupHealth | null;
  /** Set while the pool has reported an error since the last good probe. */
  degradedReason: string | null;
  /** Only for a signed-in caller, or when no pdas dep was supplied at all; null otherwise. */
  pdasWrite: PdasWriteHealth | null;
  /** Free disk space on the app-data and backup volumes. Redacted like backup/acquisition for an anonymous caller. */
  disk: DiskHealth | null;
  /**
   * `sms.verify_run`'s newest `started_at_utc` — informational only, NEVER
   * folded into `status` (see `foldStatus`'s own doc: this is the record of
   * a MANUAL run someone chose to make, not a live check, so its absence or
   * age says nothing about whether the system is healthy right now). Null
   * when nothing has run, the table does not exist yet, or the caller is
   * anonymous.
   */
  lastVerifyRunUtc: string | null;
  /**
   * The newest `sms.sync_run.finished_at_utc` for this line, REGARDLESS of
   * `rows_written` — a heartbeat proving the worker process itself is still
   * executing passes, kept deliberately separate from `acquisition.ageSeconds`
   * (which answers "how stale is the DATA", not "is the recorder still
   * checking in"). A worker that runs every 60 s and correctly finds zero new
   * rows on a quiet line looks identical to a dead worker under the data-age
   * figure alone; this tells them apart. Null when unauthenticated or no
   * sync_run row exists yet.
   */
  workerLastPassUtc: string | null;
}

/* ------------------------------------------------------------ the service */

const startedAt = new Date();

/**
 * The version from api/package.json, read once. dist/services/health.js and
 * src/services/health.ts sit at the same depth, so `../../package.json`
 * resolves to the workspace's own manifest from either. Falls back to
 * 'unknown' rather than throwing: a missing manifest must not take the
 * health route down with it.
 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', '..', 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}
export const SERVICE_VERSION = readVersion();

export function serviceHealth(now = Date.now()): ServiceHealth {
  return {
    version: SERVICE_VERSION,
    uptimeSeconds: Math.max(0, Math.round((now - startedAt.getTime()) / 1000)),
    startedAtUtc: startedAt.toISOString(),
    pid: process.pid,
  };
}

/* ------------------------------------------------------- degraded marker */

let degraded: { reason: string; atUtc: string } | null = null;

/** Called from pool.on('error') in index.ts: the process is up but a connection failed underneath it. */
export function markDegraded(reason: string): void {
  degraded = { reason, atUtc: new Date().toISOString() };
}
/** Cleared by the next probe that succeeds — the pool recovered. */
export function clearDegraded(): void {
  degraded = null;
}
export function degradedReason(): string | null {
  return degraded ? `${degraded.reason} (at ${degraded.atUtc})` : null;
}

/* ------------------------------------------------------------- database */

export interface DbProbe {
  ok: boolean;
  latencyMs: number | null;
  sizeMb: number | null;
}

/**
 * One round trip for reachability and, on the same connection, the data
 * file size from sys.database_files (pages × 8 KB). ROWS files only: the log
 * file is not subject to the Express cap. `sys.database_files` is readable
 * by any user of the database, so sms_app needs no extra grant.
 */
export async function probeDatabase(pool: ConnectionPool): Promise<DbProbe> {
  const t0 = Date.now();
  try {
    const r = await pool.request().query<{ ok: number; size_mb: number | null }>(
      `SELECT 1 AS ok,
              (SELECT SUM(CAST(size AS bigint)) * 8 / 1024.0 FROM sys.database_files WHERE type_desc = 'ROWS') AS size_mb`,
    );
    const row = r.recordset[0];
    const size = row?.size_mb == null ? null : Math.round(Number(row.size_mb) * 10) / 10;
    return { ok: true, latencyMs: Date.now() - t0, sizeMb: Number.isFinite(size as number) ? size : null };
  } catch {
    return { ok: false, latencyMs: null, sizeMb: null };
  }
}

/* ---------------------------------------------------------- acquisition */

export interface AcquisitionFacts extends Required<Omit<AcquisitionHealth, 'kind'>> {
  kind: LiveHealthKind;
  halted: string[];
}

/**
 * The worker's health as /api/live classifies it, without the rest of the
 * live payload: freshness and cadence from getSyncHealth, the newest
 * production instant, the measured acquisition lag, and the tables whose
 * LATEST sync_run row is a halt or a failure. Same classification function,
 * so the strip and the Health screen cannot disagree.
 */
export async function acquisitionHealth(pool: ConnectionPool, lineId: number): Promise<AcquisitionFacts> {
  // Same scope, same cache, same rule as /api/live — so the Health screen and
  // the strip on every other screen cannot disagree about which generation
  // they are describing, any more than they can disagree about its kind.
  const scope = await resolveLiveScope(pool, lineId);
  const coneF = epochFragment(scope, 'cone_event');
  const rejF = epochFragment(scope, 'reject_event');
  const andF = (f: { sql: string | null }) => (f.sql ? ` AND ${f.sql}` : '');
  const bindF = (req: mssql.Request, ...fs: { params: { name: string; id: number }[] }[]) => {
    for (const f of fs) for (const p of f.params) req.input(p.name, mssql.Int, p.id);
    return req;
  };

  const [sync, tip, lag, halted] = await Promise.all([
    getSyncHealth(pool, lineId),
    // RT-021 (23 Sep 2026 red-team audit): the same unfloored MAX() defect
    // as live.ts and machinesRunning.ts — a vendor clock-fault row
    // (production_ts_utc_ms = 0) could win this query. This site carries no
    // @now/@asOf cap today, so the sentinel is never actually the largest
    // candidate against real data — but the floor is added here too, as a
    // literal, so the query's shape matches the other two sites and a
    // future caller that adds a cap (the live read-only login, Q65-70)
    // inherits the same protection instead of reintroducing RT-021 here.
    bindF(pool.request().input('line', mssql.Int, lineId), coneF, rejF).query<{ tip: number | null }>(
      `SELECT MAX(tip) AS tip FROM (
           SELECT MAX(production_ts_utc_ms) AS tip FROM sms.cone_event WHERE line_id = @line AND production_ts_utc_ms > 0${andF(coneF)}
           UNION ALL
           SELECT MAX(production_ts_utc_ms) FROM sms.reject_event WHERE line_id = @line AND production_ts_utc_ms > 0${andF(rejF)}
         ) t`,
    ),
    bindF(
      pool.request().input('line', mssql.Int, lineId).input('take', mssql.Int, LAG_SAMPLE_ROWS),
      coneF,
    ).query<{ lagSeconds: number }>(
      `SELECT TOP (@take) DATEDIFF(SECOND, src_ProductionDate, src_Date) AS lagSeconds
           FROM sms_raw.cone_raw
          WHERE line_id = @line AND src_Date IS NOT NULL AND src_ProductionDate IS NOT NULL${andF(coneF)}
          ORDER BY raw_id DESC`,
    ),
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<{ target_table: string }>(
        `WITH latest AS (
           SELECT target_table, outcome,
                  ROW_NUMBER() OVER (PARTITION BY target_table ORDER BY sync_run_id DESC) AS rn
             FROM sms.sync_run WHERE line_id = @line
         )
         SELECT target_table FROM latest WHERE rn = 1 AND outcome IN ('halted', 'failed') ORDER BY target_table`,
      ),
  ]);
  const dataAsOfMs = tip.recordset[0]?.tip != null ? Number(tip.recordset[0].tip) : null;
  const samples = lag.recordset
    .map((r) => Number(r.lagSeconds))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= MAX_REPORTABLE_LAG_SECONDS)
    .sort((a, b) => a - b);
  const ingestLagSeconds = samples.length ? samples[Math.floor(samples.length / 2)]! : null;
  // `self`: exclude the chosen generation's own rows — this tip is a UNION
  // of cones and rejects, so a same-generation reject newer than the
  // cone-anchored tip elsewhere could otherwise self-report as "newer
  // elsewhere" (see findNewerElsewhere's own doc comment, live.ts).
  const self = scope.generation ? { sourceDb: scope.generation.sourceDb, ordinal: scope.generation.ordinal } : null;
  const newer =
    dataAsOfMs != null && scope.spansGenerations
      ? await findNewerElsewhere(pool, lineId, dataAsOfMs, Number.MAX_SAFE_INTEGER, self)
      : null;
  return {
    kind: classifyHealth(dataAsOfMs, sync, ingestLagSeconds, false),
    ageSeconds: sync.ageSeconds,
    cadenceSeconds: sync.cadenceSeconds,
    halted: halted.recordset.map((r) => r.target_table),
    generation: { ...emptyLiveGenerationNote(), ...noteOf(scope), ...(newer ?? {}) },
  };
}

/* ----------------------------------------------------- data-quality fold */

/**
 * Count of STANDING ERROR/CRITICAL findings in sms.dq_finding — the same two
 * severities SyncHealthBlock counts as "blocking" (web/src/screens/health/
 * SyncHealthBlock.tsx). dq_finding has no resolved/cleared flag (migration
 * 009): every row is a standing fact until whatever wrote it stops finding
 * the condition, so a plain COUNT is the same "blocking findings" figure the
 * screen already shows a few lines below this fold's result. Defensive
 * against an unmigrated database, same as acquisitionHealth: a missing table
 * must not take the whole probe down with it.
 */
export async function dqBlockingFindings(pool: ConnectionPool): Promise<number> {
  const r = await pool
    .request()
    .query<{ n: number }>(`SELECT COUNT(*) AS n FROM sms.dq_finding WHERE severity IN ('ERROR', 'CRITICAL')`);
  return Number(r.recordset[0]?.n ?? 0);
}

/**
 * `sms.sync_run`'s newest `finished_at_utc` for this line, regardless of
 * `rows_written` — see HealthReport.workerLastPassUtc's own doc for why this
 * is deliberately not folded into `status` or read from `acquisitionHealth`
 * (which already reports data AGE, a different question). Defensive against
 * an unmigrated database, same reasoning as dqBlockingFindings above.
 */
export async function workerLastPassUtc(pool: ConnectionPool, lineId: number): Promise<string | null> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ t: Date | null }>(`SELECT MAX(finished_at_utc) AS t FROM sms.sync_run WHERE line_id = @line`);
  const t = r.recordset[0]?.t ?? null;
  return t == null ? null : new Date(t).toISOString();
}

/**
 * `sms.verify_run`'s newest `started_at_utc` for this line — informational
 * only (HealthReport.lastVerifyRunUtc's own doc explains why it is never
 * folded into `status`). Migration 039 is recent enough that a database
 * built before it simply lacks the table; that must not fail the probe.
 */
export async function lastVerifyRunUtc(pool: ConnectionPool, lineId: number): Promise<string | null> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ t: Date | null }>(`SELECT MAX(started_at_utc) AS t FROM sms.verify_run WHERE line_id = @line`);
  const t = r.recordset[0]?.t ?? null;
  return t == null ? null : new Date(t).toISOString();
}

/* ----------------------------------------------------------------- disk */

/** The one fs call the disk check needs, injectable for tests. */
export interface DiskFs {
  /** Bytes available to a non-privileged caller and the block size, or null when the path cannot be statted (unsupported platform, permission, or a path that does not exist — never fatal). */
  statfs(path: string): { availableBytes: number } | null;
}
const realDiskFs: DiskFs = {
  statfs: (path) => {
    try {
      const s = statfsSync(path);
      // `bavail` (available to an unprivileged user) rather than `bfree`
      // (total free, including space reserved for root) — Node's Windows
      // implementation reports the same figure GetDiskFreeSpaceEx does for
      // the caller's own account, which is the number that actually bounds
      // what this process could still write.
      return { availableBytes: Number(s.bavail) * Number(s.bsize) };
    } catch {
      return null;
    }
  },
};

/** MB free on the volume holding `path`, or null when it could not be measured. Read-only, never fatal. */
export function freeDiskMb(path: string, fs: DiskFs = realDiskFs): number | null {
  const s = fs.statfs(path);
  if (!s || !Number.isFinite(s.availableBytes)) return null;
  return Math.round(s.availableBytes / (1024 * 1024));
}

/**
 * Both volumes this process cares about: where the app itself runs from
 * (a stand-in for "the app data/SQL Server volume" — this process has no
 * config value naming the SQL Server data directory, which lives on the
 * server, not necessarily on this host) and where backups land. Each is
 * independent and each is best-effort: a null on one must never suppress
 * the other, and neither throws.
 */
export function diskHealth(appDataDir: string, backupDir: string, fs: DiskFs = realDiskFs): DiskHealth {
  return { appDataFreeMb: freeDiskMb(appDataDir, fs), backupFreeMb: freeDiskMb(backupDir, fs) };
}

/* --------------------------------------------------------------- backup */

/** The fs calls the backup check needs, injectable for tests. */
export interface BackupFs {
  readdir(dir: string): string[];
  mtimeMs(path: string): number;
  /** Current size in bytes of the file at `path`. Only called for files that already passed `readdir`/`mtimeMs`. */
  size(path: string): number;
  /** The marker's raw text, or null when it does not exist or cannot be read — never throws. */
  readText(path: string): string | null;
}
const realFs: BackupFs = {
  readdir: (dir) => readdirSync(dir),
  mtimeMs: (p) => statSync(p).mtimeMs,
  size: (p) => statSync(p).size,
  readText: (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  },
};

/**
 * Only a `.bak` this script itself could plausibly have written: `<name>-
 * <8-digit date>-<6-digit time>.bak`, matching `backup-appdb.ps1`'s own
 * `"$Db-$stamp.bak"` (`Get-Date -Format "yyyyMMdd-HHmmss"`). This is a
 * pre-filter, not the trust boundary — see `backupHealth`'s own doc for why
 * the `.verified.json` marker is what actually decides `verified`, not this
 * pattern alone. It exists so a PDAS backup, a manual `sqlcmd` dump, or any
 * other `.bak` a human drops in the same folder is never even considered,
 * regardless of whether it happens to carry a marker.
 */
const OWN_BAK_NAME_RE = /^[A-Za-z0-9_]+-\d{8}-\d{6}\.bak$/i;

/** The shape `backup-appdb.ps1` writes to `<file>.verified.json` on a successful `RESTORE VERIFYONLY`. */
interface BackupMarker {
  file: string;
  sizeBytes: number;
  verifiedUtc: string;
  method: string;
}

function parseMarker(text: string | null): BackupMarker | null {
  if (text == null) return null;
  try {
    const m = JSON.parse(text) as Partial<BackupMarker>;
    return typeof m.sizeBytes === 'number' && Number.isFinite(m.sizeBytes) ? (m as BackupMarker) : null;
  } catch {
    return null;
  }
}

/**
 * Newest `*.bak` this script produced, in the backup directory, BY VERIFIED
 * STATUS then by mtime — not by mtime alone.
 *
 * A `.bak` counts as verified only when it has a matching `<file>.verified.
 * json` marker (written by `backup-appdb.ps1` right after `RESTORE
 * VERIFYONLY` passes) AND that marker's `sizeBytes` still matches the file's
 * CURRENT size on disk — a file truncated, replaced, or corrupted after the
 * script ran no longer matches its own marker and stops counting as
 * verified, exactly like one that was never verified at all. PDAS backups
 * and anything not matching this script's own naming convention are ignored
 * outright (see OWN_BAK_NAME_RE).
 *
 * When the physically newest `.bak` is NOT verified, the newest VERIFIED one
 * is reported instead (`newestUnverified: true` says so explicitly) — the
 * screen must never state a restorability claim about a file nobody has
 * proven restorable. Read-only; a missing or unreadable directory, or a
 * directory with no verified `.bak` in it at all, is the warning state, not
 * a thrown error.
 */
export function backupHealth(dir: string, fs: BackupFs = realFs, now = Date.now()): BackupHealth {
  const entries: { name: string; mtimeMs: number; verified: boolean }[] = [];
  try {
    for (const name of fs.readdir(dir)) {
      if (!OWN_BAK_NAME_RE.test(name)) continue;
      let m: number;
      try {
        m = fs.mtimeMs(join(dir, name));
      } catch {
        continue;
      }
      const marker = parseMarker(fs.readText(join(dir, `${name}.verified.json`)));
      let verified = false;
      if (marker) {
        try {
          verified = fs.size(join(dir, name)) === marker.sizeBytes;
        } catch {
          verified = false;
        }
      }
      entries.push({ name, mtimeMs: m, verified });
    }
  } catch {
    // missing/unreadable directory: fall through with zero entries, same as before
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (entries.length === 0) {
    return { dir, newestFile: null, newestAtUtc: null, ageDays: null, warning: true, verified: false, newestUnverified: false };
  }

  const actualNewest = entries[0]!;
  const newestUnverified = !actualNewest.verified;
  const reported = actualNewest.verified ? actualNewest : (entries.find((e) => e.verified) ?? null);

  if (!reported) {
    // Nothing verified anywhere in the directory: report the physically
    // newest file for context (so the screen can still say a NAME and AGE),
    // but never claim it is trustworthy.
    const ageDays = Math.max(0, (now - actualNewest.mtimeMs) / 86_400_000);
    return {
      dir,
      newestFile: actualNewest.name,
      newestAtUtc: new Date(actualNewest.mtimeMs).toISOString(),
      ageDays: Math.round(ageDays * 10) / 10,
      warning: true,
      verified: false,
      newestUnverified: true,
    };
  }

  const ageDays = Math.max(0, (now - reported.mtimeMs) / 86_400_000);
  return {
    dir,
    newestFile: reported.name,
    newestAtUtc: new Date(reported.mtimeMs).toISOString(),
    ageDays: Math.round(ageDays * 10) / 10,
    warning: ageDays > BACKUP_WARN_DAYS || newestUnverified,
    verified: true,
    newestUnverified,
  };
}

/* ---------------------------------------------------------------- fold */

/**
 * Pure: the one word a monitor reads, from the six facts — see the module
 * header for why DQ findings and backup age are folded in alongside the
 * original three (pool/size/acquisition). `lowestFreeDiskMb` (W1-C, 29 Sep
 * 2026, failure analysis F-36) is the sixth: optional and defaulted to
 * `null` so every pre-existing positional call site keeps compiling and
 * behaving exactly as before when it does not pass one. `null` means "could
 * not be measured", never "fine" — but an unmeasurable disk must not itself
 * degrade a system that has never claimed to measure it, so only a genuine
 * number below FREE_DISK_WARN_MB counts.
 *
 * `lastVerifyRunUtc`/`workerLastPassUtc` (also W1-C) deliberately have NO
 * parameter here at all: both are informational-only by design (see their
 * own doc comments on HealthReport) and must never move `status`.
 */
export function foldStatus(
  db: DbProbe,
  acq: AcquisitionFacts | null,
  degradedNow: boolean,
  dqBlockingCount: number,
  backupWarning: boolean,
  lowestFreeDiskMb: number | null = null,
): HealthStatus {
  if (!db.ok) return 'down';
  if (degradedNow) return 'degraded';
  if (db.sizeMb != null && (db.sizeMb / EXPRESS_CAP_MB) * 100 >= SIZE_WARN_PCT) return 'degraded';
  if (acq && (acq.kind === 'stale' || acq.kind === 'late' || acq.halted.length > 0)) return 'degraded';
  if (dqBlockingCount > 0) return 'degraded';
  if (backupWarning) return 'degraded';
  if (lowestFreeDiskMb != null && lowestFreeDiskMb < FREE_DISK_WARN_MB) return 'degraded';
  return 'ok';
}

/**
 * RT24-12 (24 Sep 2026 red-team audit): `foldStatus` above degrades on five
 * signals, but `degradedReason` (below getHealth) only ever reported
 * `markDegraded()`'s own reason — every OTHER route into 'degraded' (a full
 * data file, stale/late/halted acquisition, a blocking DQ finding, a stale
 * backup) left the field `null` while `status` read `"degraded"` right
 * beside it. Pure and exported so it can be pinned without a fake pool: one
 * plain-English sentence per signal that is actually true, in the same
 * priority order `foldStatus` itself checks (pool error first — it is the
 * most specific and most actionable), joined with '; ' when more than one
 * fires at once, so an operator sees every reason, not just the first.
 */
export function degradedReasons(
  db: DbProbe,
  acq: AcquisitionFacts | null,
  markedReason: string | null,
  dqBlockingCount: number,
  backupWarning: boolean,
  backupWarningText: string | null,
  lowestFreeDiskMb: number | null = null,
): string | null {
  if (markedReason != null) return markedReason;
  const reasons: string[] = [];
  if (db.sizeMb != null && (db.sizeMb / EXPRESS_CAP_MB) * 100 >= SIZE_WARN_PCT) {
    const pct = Math.round((db.sizeMb / EXPRESS_CAP_MB) * 1000) / 10;
    reasons.push(`database at ${pct}% of its size cap`);
  }
  if (acq) {
    if (acq.kind === 'stale' || acq.kind === 'late') {
      reasons.push(`acquisition ${acq.kind} (age ${acq.ageSeconds ?? 'unknown'} s)`);
    }
    if (acq.halted.length > 0) {
      reasons.push(`acquisition halted on ${acq.halted.join(', ')}`);
    }
  }
  if (dqBlockingCount > 0) {
    reasons.push(`${dqBlockingCount} blocking data-quality finding${dqBlockingCount === 1 ? '' : 's'}`);
  }
  if (backupWarning) {
    reasons.push(backupWarningText != null ? `backup: ${backupWarningText}` : 'backup is missing or stale');
  }
  if (lowestFreeDiskMb != null && lowestFreeDiskMb < FREE_DISK_WARN_MB) {
    reasons.push(`low disk space: ${lowestFreeDiskMb} MB free (below ${FREE_DISK_WARN_MB} MB)`);
  }
  return reasons.length > 0 ? reasons.join('; ') : null;
}

export interface HealthDeps {
  probeDatabase: typeof probeDatabase;
  acquisitionHealth: typeof acquisitionHealth;
  dqBlockingFindings: typeof dqBlockingFindings;
  backupHealth: (dir: string) => BackupHealth;
  diskHealth: (appDataDir: string, backupDir: string) => DiskHealth;
  workerLastPassUtc: typeof workerLastPassUtc;
  lastVerifyRunUtc: typeof lastVerifyRunUtc;
  now: () => number;
}
const realDeps: HealthDeps = {
  probeDatabase,
  acquisitionHealth,
  dqBlockingFindings,
  backupHealth: (dir) => backupHealth(dir),
  diskHealth: (appDataDir, backupDir) => diskHealth(appDataDir, backupDir),
  workerLastPassUtc,
  lastVerifyRunUtc,
  now: Date.now,
};

/**
 * The PDAS write facts getHealth needs — supplied by app.ts from the single
 * PdasWriter instance it already holds (see pdasWrite.ts). Kept as a narrow
 * interface, not the PdasWriter class itself, so this file's own tests never
 * need a real (or fake) database connection to exercise it.
 */
export interface PdasHealthDeps {
  enabled: boolean;
  readbackStatus: () => { unverifiedSinceStartup: string[]; lastVerifiedUtc: string | null };
  probePermissions: () => Promise<PdasPermissionStatus | null>;
}

/**
 * The whole report. `authenticated` governs redaction only — every fact is
 * gathered regardless so `status` is honest for the anonymous probe too,
 * including the DQ finding count and the backup check (see the module
 * header's REDACTION note — this used to be true of database/acquisition
 * only; the backup check in particular used to run only for a signed-in
 * caller, which was fine while nothing derived `status` from it). Acquisition
 * and DQ facts are gathered only when the database answered; asking a dead
 * pool more questions would just be more timeouts. The backup check is a
 * local filesystem read, not a database round trip, so it always runs.
 */
export async function getHealth(
  pool: ConnectionPool,
  opts: { lineId: number; backupDir: string; authenticated: boolean; appDataDir?: string; pdas?: PdasHealthDeps },
  deps: HealthDeps = realDeps,
): Promise<HealthReport> {
  const db = await deps.probeDatabase(pool);
  if (db.ok) clearDegraded();
  let acq: AcquisitionFacts | null = null;
  let dqBlocking = 0;
  let workerLastPass: string | null = null;
  let verifyRunLast: string | null = null;
  if (db.ok) {
    try {
      acq = await deps.acquisitionHealth(pool, opts.lineId);
    } catch {
      acq = null; // a missing table on an unmigrated database: the probe still stands
    }
    try {
      dqBlocking = await deps.dqBlockingFindings(pool);
    } catch {
      dqBlocking = 0; // same reasoning: sms.dq_finding missing must not fail the probe
    }
    try {
      workerLastPass = await deps.workerLastPassUtc(pool, opts.lineId);
    } catch {
      workerLastPass = null; // an unmigrated sms.sync_run must not fail the probe
    }
    try {
      verifyRunLast = await deps.lastVerifyRunUtc(pool, opts.lineId);
    } catch {
      verifyRunLast = null; // sms.verify_run (migration 039) may not exist yet; informational only anyway
    }
  }
  const backup = deps.backupHealth(opts.backupDir);
  // Local filesystem reads, like the backup check — always run regardless of
  // db.ok, and each volume is independent (see diskHealth's own doc).
  const disk = deps.diskHealth(opts.appDataDir ?? process.cwd(), opts.backupDir);
  const diskFigures = [disk.appDataFreeMb, disk.backupFreeMb].filter((n): n is number => n != null);
  const lowestFreeDiskMb = diskFigures.length > 0 ? Math.min(...diskFigures) : null;
  const markedReason = degradedReason();
  const status = foldStatus(db, acq, markedReason != null, dqBlocking, backup.warning, lowestFreeDiskMb);
  // RT24-12: degradedReason must name every signal that actually degraded
  // `status`, not just a pool error — see degradedReasons' own doc above.
  const backupWarningText = backup.warning
    ? backup.newestFile == null
      ? 'no backup found'
      : backup.newestUnverified
        ? 'newest backup not verified'
        : `newest backup is ${backup.ageDays ?? '?'} day(s) old`
    : null;
  const reason = degradedReasons(db, acq, markedReason, dqBlocking, backup.warning, backupWarningText, lowestFreeDiskMb);
  const pct = db.sizeMb == null ? null : Math.round((db.sizeMb / EXPRESS_CAP_MB) * 1000) / 10;
  const a = opts.authenticated;

  // RT24-05: the permission probe is a live PDAS round trip, so it only runs
  // when writes are enabled at all, and its own failure must not take the
  // whole health probe down — same reasoning as acquisitionHealth/dqBlockingFindings above.
  let pdasWrite: PdasWriteHealth | null = null;
  if (opts.pdas) {
    const rb = opts.pdas.readbackStatus();
    let perms: PdasPermissionStatus | null = null;
    if (opts.pdas.enabled) {
      try {
        perms = await opts.pdas.probePermissions();
      } catch {
        perms = null; // the probe itself failed (e.g. the writer pool couldn't connect); report unknown, not down
      }
    }
    pdasWrite = {
      enabled: opts.pdas.enabled,
      canReadBack: perms ? perms.canReadBack : null,
      missingSelect: perms?.missingSelect ?? [],
      missingExecute: perms?.missingExecute ?? [],
      unverifiedSinceStartup: rb.unverifiedSinceStartup,
      lastVerifiedUtc: rb.lastVerifiedUtc,
    };
  }

  return {
    status,
    service: serviceHealth(deps.now()),
    database: {
      ok: db.ok,
      latencyMs: db.latencyMs,
      sizeMb: a ? db.sizeMb : null,
      capMb: EXPRESS_CAP_MB,
      pctOfCap: a ? pct : null,
    },
    acquisition: a && acq
      ? {
          kind: acq.kind,
          ageSeconds: acq.ageSeconds,
          cadenceSeconds: acq.cadenceSeconds,
          halted: acq.halted,
          generation: acq.generation,
        }
      : { kind: null, ageSeconds: null, cadenceSeconds: null, halted: null, generation: null },
    backup: a ? backup : null,
    degradedReason: a ? reason : null,
    pdasWrite: a ? pdasWrite : null,
    disk: a ? disk : null,
    lastVerifyRunUtc: a ? verifyRunLast : null,
    workerLastPassUtc: a ? workerLastPass : null,
  };
}
