/**
 * `sms rebuild --table=<t> --snapshot-id=<id>` — rebuild a canonical table from
 * raw at the current transform_version (ARCHITECTURE §18).
 * HARD GATE: refuses to run without --snapshot-id (proof a pre-rebuild snapshot
 * was taken). Records rebuild_audit. Deletes then re-transforms (idempotent).
 *
 * TWO MORE GATES (roadmap Phase 3 item 5, 14 Sep 2026):
 *
 *  - The snapshot id must LOOK like one. `--snapshot-id=x` satisfied the old
 *    check, and the audit row then said a snapshot named "x" existed. The
 *    pattern below asks for at least eight characters of the kind a backup
 *    name or a timestamp has (backup-appdb.ps1 produces `sms_20260914_1530`),
 *    which is not proof a snapshot was taken but is proof the operator typed
 *    the name of one rather than a placeholder. The id is recorded as given.
 *
 *  - No worker pass may be in progress. The transform lock already keeps the
 *    rebuild's DELETE and re-transform apart from the worker's TRANSFORM, but
 *    the worker's READER runs outside that lock: a reader pass mid-flight
 *    (a `sync_run` row with no finished_at_utc) is writing raw rows and
 *    advancing watermarks that this rebuild is about to reset. Refuse, name
 *    the rows, and let the operator retry once the pass has settled — the
 *    pass is 60 s apart and takes seconds; the rebuild takes minutes.
 */
import mssql from 'mssql';
import { TRANSFORM_VERSION } from '@sms/shared';
import {
  loadSourceStreams,
  runTransform,
  resetTransformWatermarks,
  withTransformLock,
  type TableKind,
} from '@sms/sync-worker';
import { openContext, parseArgs, cliLog } from '../context.js';

const ALLOWED = new Set(['cone_event', 'sack_event', 'reject_event']);

/** A plausible snapshot name: a backup file stem, a timestamp, a tag — eight characters or more. */
export const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{7,}$/;

/** Which raw kinds feed each canonical table — reject_event is fed by two. */
const KINDS_OF: Record<string, TableKind[]> = {
  cone_event: ['cone'],
  sack_event: ['sack'],
  reject_event: ['reject_qcs', 'reject_weight'],
};

export async function rebuild(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const table = String(args.table ?? '');
  const snapshotId = typeof args['snapshot-id'] === 'string' ? args['snapshot-id'] : '';

  if (!ALLOWED.has(table)) {
    console.error(`--table must be one of: ${[...ALLOWED].join(', ')}`);
    return 2;
  }
  if (!snapshotId) {
    console.error(
      'REFUSED: rebuild requires --snapshot-id=<id> proving a fresh canonical snapshot was taken first (§13).',
    );
    return 2;
  }
  if (!SNAPSHOT_ID.test(snapshotId)) {
    console.error(
      `REFUSED: --snapshot-id=${JSON.stringify(snapshotId)} does not look like a snapshot name. ` +
        `Give the backup's own name (e.g. sms_20260914_1530): letters, digits, _ . : - only, at least eight characters.`,
    );
    return 2;
  }

  const ctx = await openContext();
  let rebuildId: number | undefined;
  try {
    // A reader pass in flight: refuse before touching anything. (The row a
    // crashed worker leaves behind — 'running' forever — also trips this;
    // that row is a real fault to look at, not one to rebuild past.)
    const inFlight = await ctx.app
      .request()
      .query<{ n: number }>(`SELECT COUNT(*) n FROM sms.sync_run WHERE finished_at_utc IS NULL`);
    const running = Number(inFlight.recordset[0]?.n ?? 0);
    if (running > 0) {
      console.error(
        `REFUSED: ${running} sync_run row(s) have no finished_at_utc — a worker pass is in progress ` +
          `(or one crashed and left its row open). The reader runs outside the transform lock, so a ` +
          `rebuild now would race it. Wait for the pass to finish and re-run; if the row is stale, ` +
          `investigate sms.sync_run before rebuilding.`,
      );
      return 2;
    }
    // The rows this rebuild owns are the ones stamped with the system code(s)
    // of the source(s) this line's tables are read through (sms.data_source,
    // roadmap Phase 1) — was the literal 'ifl_sql'. Bound as parameters; the
    // two reject kinds may in principle come through different sources, so
    // it is an IN list of the distinct codes.
    const streams = await loadSourceStreams(ctx.app, ctx.cfg.lineId);
    const systems = [...new Set(KINDS_OF[table]!.map((k) => streams[k].systemCode))];
    const withSystems = (r: mssql.Request): { req: mssql.Request; inList: string } => {
      systems.forEach((code, i) => r.input(`sys${i}`, mssql.VarChar(20), code));
      return { req: r, inList: systems.map((_, i) => `@sys${i}`).join(', ') };
    };

    const fromQ = withSystems(ctx.app.request());
    const from = (
      await fromQ.req.query<{ v: number }>(
        `SELECT ISNULL(MIN(transform_version), ${TRANSFORM_VERSION}) v FROM sms.${table} WHERE source_system IN (${fromQ.inList})`,
      )
    ).recordset[0]!.v;

    const audit = await ctx.app
      .request()
      .input('snap', mssql.NVarChar(128), snapshotId)
      .input('from', mssql.Int, from)
      .input('to', mssql.Int, TRANSFORM_VERSION)
      .input('tbl', mssql.VarChar(40), table)
      .query<{ id: number }>(
        `INSERT INTO sms.rebuild_audit (snapshot_id, from_transform_version, to_transform_version, target_table)
         OUTPUT INSERTED.rebuild_id id VALUES (@snap, @from, @to, @tbl)`,
      );
    rebuildId = audit.recordset[0]!.id;

    console.log(`rebuild ${table}: snapshot ${snapshotId}, transform v${from} → v${TRANSFORM_VERSION}`);

    // Everything from here on races the sync-worker's own continuous transform
    // pass against the same canonical table and watermark keys (finding C1,
    // Sep 2026 audit) — hold the shared lock for all of it, not just the
    // transform call, so the DELETE below can't land mid-way through a
    // concurrent pass.
    const rebuilt = await withTransformLock(ctx.cfg.app, async () => {
      // Chunked, not one statement. Clearing cone_event is 204,076 rows: as a
      // single DELETE that is one transaction held open for the whole scan,
      // growing the log by the size of the table — on a plant PC with a modest
      // disk that is how a maintenance command becomes an outage. Small
      // batches keep each statement short and let the log wrap between them.
      // `table` is checked against ALLOWED above, so the interpolation is safe;
      // the system code is a bound parameter.
      let cleared = 0;
      for (;;) {
        const delQ = withSystems(ctx.app.request());
        const del = await delQ.req.query(
          `DELETE TOP (5000) FROM sms.${table} WHERE source_system IN (${delQ.inList})`,
        );
        const n = del.rowsAffected[0] ?? 0;
        cleared += n;
        if (n === 0) break;
      }
      console.log(`cleared ${cleared} existing rows`);
      // The transform is incremental (raw watermark) — reset this stream's
      // watermark or the re-run sees an empty batch and rebuilds nothing. The
      // re-run also re-records this table's ingest-time DQ findings, so clear
      // the old ones first or every rebuild would duplicate the standing set.
      await ctx.app.request().input('tbl2', mssql.VarChar(40), table)
        .query(`DELETE FROM sms.dq_finding WHERE subject_table=@tbl2`);
      await resetTransformWatermarks(ctx.app, table);
      const out = await runTransform(ctx.app, ctx.cfg);
      return out.find((o) => o.table === table)?.written ?? 0;
    });

    await ctx.app
      .request()
      .input('id', mssql.BigInt, rebuildId)
      .input('rows', mssql.Int, rebuilt)
      .query(
        `UPDATE sms.rebuild_audit SET rows_rebuilt=@rows, outcome='success', finished_at_utc=SYSUTCDATETIME() WHERE rebuild_id=@id`,
      );
    console.log(`rebuilt ${rebuilt} rows (audit #${rebuildId})`);
    return 0;
  } catch (err) {
    // Previously absent entirely: any error here left the row's outcome
    // stuck at its default 'running' forever, with canonical already
    // deleted, indistinguishable from a rebuild still in progress.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`rebuild failed: ${message}`);
    cliLog.error('rebuild failed', { table, snapshotId, error: message });
    if (rebuildId !== undefined) {
      try {
        await ctx.app
          .request()
          .input('id', mssql.BigInt, rebuildId)
          .input('msg', mssql.NVarChar(2000), message.slice(0, 2000))
          .query(
            `UPDATE sms.rebuild_audit SET outcome='failed', error_message=@msg, finished_at_utc=SYSUTCDATETIME() WHERE rebuild_id=@id`,
          );
      } catch (auditErr) {
        console.error(`(also failed to record the failure in rebuild_audit: ${String(auditErr)})`);
      }
    }
    return 1;
  } finally {
    await ctx.close();
  }
}
