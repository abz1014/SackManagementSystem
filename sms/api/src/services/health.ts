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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import {
  classifyHealth,
  getSyncHealth,
  LAG_SAMPLE_ROWS,
  MAX_REPORTABLE_LAG_SECONDS,
  type LiveHealthKind,
} from './live.js';

/** SQL Server Express's per-database data-file ceiling, in MB (10 GB). */
export const EXPRESS_CAP_MB = 10240;
/** Above this share of the cap the status degrades and the screen says so in a sentence. */
export const SIZE_WARN_PCT = 80;
/** A backup older than this many days is a warning (the schedule is nightly). */
export const BACKUP_WARN_DAYS = 2;

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
}

export interface BackupHealth {
  dir: string;
  newestFile: string | null;
  newestAtUtc: string | null;
  ageDays: number | null;
  /** True when there is no backup or the newest is older than BACKUP_WARN_DAYS. */
  warning: boolean;
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
  const [sync, tip, lag, halted] = await Promise.all([
    getSyncHealth(pool, lineId),
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<{ tip: number | null }>(
        `SELECT MAX(tip) AS tip FROM (
           SELECT MAX(production_ts_utc_ms) AS tip FROM sms.cone_event WHERE line_id = @line
           UNION ALL
           SELECT MAX(production_ts_utc_ms) FROM sms.reject_event WHERE line_id = @line
         ) t`,
      ),
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('take', mssql.Int, LAG_SAMPLE_ROWS)
      .query<{ lagSeconds: number }>(
        `SELECT TOP (@take) DATEDIFF(SECOND, src_ProductionDate, src_Date) AS lagSeconds
           FROM sms_raw.cone_raw
          WHERE line_id = @line AND src_Date IS NOT NULL AND src_ProductionDate IS NOT NULL
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
  return {
    kind: classifyHealth(dataAsOfMs, sync, ingestLagSeconds, false),
    ageSeconds: sync.ageSeconds,
    cadenceSeconds: sync.cadenceSeconds,
    halted: halted.recordset.map((r) => r.target_table),
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

/* --------------------------------------------------------------- backup */

/** The two fs calls the backup check needs, injectable for tests. */
export interface BackupFs {
  readdir(dir: string): string[];
  mtimeMs(path: string): number;
}
const realFs: BackupFs = {
  readdir: (dir) => readdirSync(dir),
  mtimeMs: (p) => statSync(p).mtimeMs,
};

/**
 * Newest `*.bak` in the backup directory by mtime. Read-only; a missing or
 * unreadable directory is "no backup", which is the warning state, not an
 * error — the operator's question is whether a backup exists, and "the
 * folder is not there" answers it.
 */
export function backupHealth(dir: string, fs: BackupFs = realFs, now = Date.now()): BackupHealth {
  let newest: { name: string; mtimeMs: number } | null = null;
  try {
    for (const name of fs.readdir(dir)) {
      if (!/\.bak$/i.test(name)) continue;
      let m: number;
      try {
        m = fs.mtimeMs(join(dir, name));
      } catch {
        continue;
      }
      if (!newest || m > newest.mtimeMs) newest = { name, mtimeMs: m };
    }
  } catch {
    newest = null;
  }
  if (!newest) return { dir, newestFile: null, newestAtUtc: null, ageDays: null, warning: true };
  const ageDays = Math.max(0, (now - newest.mtimeMs) / 86_400_000);
  return {
    dir,
    newestFile: newest.name,
    newestAtUtc: new Date(newest.mtimeMs).toISOString(),
    ageDays: Math.round(ageDays * 10) / 10,
    warning: ageDays > BACKUP_WARN_DAYS,
  };
}

/* ---------------------------------------------------------------- fold */

/**
 * Pure: the one word a monitor reads, from the five facts — see the module
 * header for why DQ findings and backup age are folded in alongside the
 * original three (pool/size/acquisition).
 */
export function foldStatus(
  db: DbProbe,
  acq: AcquisitionFacts | null,
  degradedNow: boolean,
  dqBlockingCount: number,
  backupWarning: boolean,
): HealthStatus {
  if (!db.ok) return 'down';
  if (degradedNow) return 'degraded';
  if (db.sizeMb != null && (db.sizeMb / EXPRESS_CAP_MB) * 100 >= SIZE_WARN_PCT) return 'degraded';
  if (acq && (acq.kind === 'stale' || acq.kind === 'late' || acq.halted.length > 0)) return 'degraded';
  if (dqBlockingCount > 0) return 'degraded';
  if (backupWarning) return 'degraded';
  return 'ok';
}

export interface HealthDeps {
  probeDatabase: typeof probeDatabase;
  acquisitionHealth: typeof acquisitionHealth;
  dqBlockingFindings: typeof dqBlockingFindings;
  backupHealth: (dir: string) => BackupHealth;
  now: () => number;
}
const realDeps: HealthDeps = {
  probeDatabase,
  acquisitionHealth,
  dqBlockingFindings,
  backupHealth: (dir) => backupHealth(dir),
  now: Date.now,
};

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
  opts: { lineId: number; backupDir: string; authenticated: boolean },
  deps: HealthDeps = realDeps,
): Promise<HealthReport> {
  const db = await deps.probeDatabase(pool);
  if (db.ok) clearDegraded();
  let acq: AcquisitionFacts | null = null;
  let dqBlocking = 0;
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
  }
  const backup = deps.backupHealth(opts.backupDir);
  const reason = degradedReason();
  const status = foldStatus(db, acq, reason != null, dqBlocking, backup.warning);
  const pct = db.sizeMb == null ? null : Math.round((db.sizeMb / EXPRESS_CAP_MB) * 1000) / 10;
  const a = opts.authenticated;
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
      ? { kind: acq.kind, ageSeconds: acq.ageSeconds, cadenceSeconds: acq.cadenceSeconds, halted: acq.halted }
      : { kind: null, ageSeconds: null, cadenceSeconds: null, halted: null },
    backup: a ? backup : null,
    degradedReason: a ? reason : null,
  };
}
