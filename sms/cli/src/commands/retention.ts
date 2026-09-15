/**
 * `sms retention [--dry-run]` — prune the tables this application grows for
 * itself, and nothing else (roadmap Phase 11 item 4 — core function 11,
 * 14 Sep 2026).
 *
 * WHAT GOES.
 *   sms.sync_run     rows older than RETENTION_SYNC_RUN_DAYS (default 90),
 *                    KEEPING the newest row per (line, target_table) whatever
 *                    its age: that row is what the Setup screen, /api/health
 *                    and the epoch gate read as "the last pass", and a table
 *                    that has not synced for 91 days must still show as such
 *                    rather than vanish from the list. ~5,760 rows/day at the
 *                    default cadence; nothing pruned it before this.
 *   sms.dq_finding   rows older than RETENTION_DQ_FINDING_DAYS (default 365),
 *                    EXCEPT CRITICAL: a critical finding is cleared by the
 *                    condition ending (transform_failed, persistent_sync_
 *                    failure) or by an operator, never by the calendar.
 *   sms.session      rows already expired. The login route prunes these
 *                    opportunistically; this makes it certain.
 *
 * WHAT NEVER GOES, AND WHY THIS COMMAND SAYS SO EVERY TIME IT RUNS.
 *   sms.audit_log and sms.product_change   the record of who changed what;
 *                    migration 030 makes audit_log append-only at the
 *                    database, so this command could not delete from it if
 *                    it tried.
 *   raw and canonical readings             their retention against the 10 GB
 *                    Express cap is IFL's decision (Phase 11 clarifications:
 *                    "retention of raw and canonical readings"), not the
 *                    developer's default. The command prints that sentence
 *                    rather than a policy IFL has not given.
 *
 * `--dry-run` runs the same statements as SELECT COUNT(*) with the same WHERE
 * clauses and deletes nothing. A real run writes one audit row,
 * `retention.run`, with no actor (the CLI has none) and the counts in detail.
 *
 * Deletes are chunked (TOP 5000 in a loop) for the same reason cutover's
 * are: one DELETE over a year of sync_run rows is one transaction holding
 * the log for the whole scan on a plant PC.
 */
import mssql from 'mssql';
import { openContext, parseArgs, cliLog } from '../context.js';

export interface RetentionPolicy {
  syncRunDays: number;
  dqFindingDays: number;
}

/** A whole number of days from an env key, or the default; refuses nonsense loudly. */
function daysEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number of days, got ${JSON.stringify(raw)}`);
  const n = Number(raw);
  if (n < 1) throw new Error(`${key} must be at least 1, got ${n}`);
  return n;
}

export function retentionPolicy(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  return {
    syncRunDays: daysEnv(env, 'RETENTION_SYNC_RUN_DAYS', 90),
    dqFindingDays: daysEnv(env, 'RETENTION_DQ_FINDING_DAYS', 365),
  };
}

/**
 * The three prunes as (count SQL, delete SQL) pairs sharing one WHERE clause
 * each, so the dry run counts exactly what the real run would remove. The
 * WHERE text is a constant here and asserted by the test — a retention job
 * whose predicate drifts from its documentation is the worst kind.
 */
export const SYNC_RUN_WHERE =
  `sync_run_id IN (
     SELECT sync_run_id FROM (
       SELECT sync_run_id, started_at_utc,
              ROW_NUMBER() OVER (PARTITION BY line_id, target_table ORDER BY sync_run_id DESC) AS rn
         FROM sms.sync_run
     ) r
     WHERE r.rn > 1 AND r.started_at_utc < DATEADD(DAY, -@syncDays, SYSUTCDATETIME()))`;

export const DQ_FINDING_WHERE = `severity <> 'CRITICAL' AND detected_at_utc < DATEADD(DAY, -@dqDays, SYSUTCDATETIME())`;

export const SESSION_WHERE = `expires_at_utc <= SYSUTCDATETIME()`;

interface Prune {
  table: string;
  where: string;
  bind: (r: mssql.Request) => mssql.Request;
}

export function prunes(policy: RetentionPolicy): Prune[] {
  return [
    { table: 'sms.sync_run', where: SYNC_RUN_WHERE, bind: (r) => r.input('syncDays', mssql.Int, policy.syncRunDays) },
    { table: 'sms.dq_finding', where: DQ_FINDING_WHERE, bind: (r) => r.input('dqDays', mssql.Int, policy.dqFindingDays) },
    { table: 'sms.session', where: SESSION_WHERE, bind: (r) => r },
  ];
}

export const NEVER_PRUNED_NOTE =
  'Never pruned by this command: sms.audit_log and sms.product_change (the record of who changed what; ' +
  'audit_log is append-only at the database since migration 030), and every raw (sms_raw.*) and canonical ' +
  '(sms.cone_event / sack_event / reject_event) reading — how long IFL wants readings kept against the ' +
  '10 GB Express cap is their decision and has not been given. See DEPLOY.md, Retention.';

export async function retention(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const dryRun = args['dry-run'] === true;
  const ctx = await openContext();
  try {
    const policy = retentionPolicy();
    console.log(`retention${dryRun ? ' — DRY RUN, nothing will be deleted' : ''}\n`);
    console.log(`  sms.sync_run     older than ${policy.syncRunDays} days, keeping the newest row per (line, table)`);
    console.log(`  sms.dq_finding   older than ${policy.dqFindingDays} days, except CRITICAL`);
    console.log(`  sms.session      already expired\n`);

    const counts: Record<string, number> = {};
    for (const p of prunes(policy)) {
      const c = await p.bind(ctx.app.request()).query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${p.table} WHERE ${p.where}`);
      const n = Number(c.recordset[0]?.n ?? 0);
      counts[p.table] = n;
      if (dryRun) {
        console.log(`  ${p.table.padEnd(18)} ${String(n).padStart(9)} rows would be deleted`);
        continue;
      }
      let deleted = 0;
      for (;;) {
        const d = await p.bind(ctx.app.request()).query(`DELETE TOP (5000) FROM ${p.table} WHERE ${p.where}`);
        const k = d.rowsAffected[0] ?? 0;
        deleted += k;
        if (k === 0) break;
      }
      counts[p.table] = deleted;
      console.log(`  ${p.table.padEnd(18)} ${String(deleted).padStart(9)} rows deleted`);
    }

    if (!dryRun) {
      await ctx.app
        .request()
        .input('action', mssql.VarChar(40), 'retention.run')
        .input('type', mssql.VarChar(40), 'database')
        .input('target', mssql.NVarChar(64), 'sms')
        .input(
          'detail',
          mssql.NVarChar(1000),
          `by the CLI (sms retention), no signed-in actor; sync_run ${counts['sms.sync_run']} (>${policy.syncRunDays}d), ` +
            `dq_finding ${counts['sms.dq_finding']} (>${policy.dqFindingDays}d, non-critical), session ${counts['sms.session']} (expired)`,
        )
        .query(
          `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
           VALUES (NULL, @action, @type, @target, @detail)`,
        );
    }

    console.log(`\n  ${NEVER_PRUNED_NOTE}\n`);
    return 0;
  } catch (err) {
    console.error(`retention failed: ${err instanceof Error ? err.message : String(err)}`);
    cliLog.error('retention failed', { error: err instanceof Error ? err.message : String(err) });
    return 1;
  } finally {
    await ctx.close();
  }
}
