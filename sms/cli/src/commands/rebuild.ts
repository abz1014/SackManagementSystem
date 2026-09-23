/**
 * `sms rebuild --table=<t> --snapshot-id=<id> (--epoch=N[,M] | --all-generations) --confirm`
 * — delete a canonical table's rows and re-derive them from `sms_raw.*` at the
 * current transform_version (ARCHITECTURE §18).
 *
 * GENERATION SCOPE (23 Sep 2026) — the reason this file was reopened.
 *
 * Until today this command had NO generation scope at all. Its DELETE read
 * `WHERE source_system IN (...)` and nothing else, so one
 * `sms rebuild --table=cone_event` deleted EVERY generation's cone rows in one
 * statement and re-derived all of them. Measured on this development sidecar
 * (23 Sep 2026, read-only `sqlcmd -E -d sms`): that is 487,936 rows across
 * three generations — epoch 1 (142,511 cones, the July `DATA_TP1U2` copy),
 * epoch 9 (132,552, the September `_SEP07` copy) and epoch 13 (212,873, the
 * simulator) — when the operator's intent was almost always one of them. The
 * same shape on `sack_event` is 20,612 rows over three generations and on
 * `reject_event` 14,104 over six.
 *
 * WHY THAT IS NOT MERELY UNTIDY. `sms.source_epoch` is the entire defence
 * against mixing IFL's two data generations (they dropped and recreated all
 * four weighing tables on 2026-08-05, restarting every identity at 1), and a
 * command that operates across all of them at once is the one command in the
 * system most able to undo that defence quietly. Three specific costs, none of
 * which a wider `--table` scope makes obvious to whoever types it:
 *
 *   1. The transform is NOT a pure replay. `runTransform` resolves the shift
 *      rule, the plausibility rule and the station roster ON FILE NOW
 *      (runTransform.ts:403-409), so re-deriving a closed generation restamps
 *      its `shift_code` under today's rule rather than the one in force when
 *      those rows were first transformed. Intended for the generation you
 *      meant to restamp; silent for the two you did not.
 *   2. `sms.dq_finding` was cleared for the whole table
 *      (`DELETE FROM sms.dq_finding WHERE subject_table=@tbl2`), across every
 *      generation, INCLUDING severity CRITICAL — and `transform_zero_write`,
 *      the CRITICAL finding that says rows were not written and the watermark
 *      was held back, is raised with exactly these `subject_table` values
 *      (runTransform.ts:375). A rebuild could therefore delete the alarm
 *      saying the previous rebuild lost rows. `sms retention` already refuses
 *      to touch a CRITICAL finding on age grounds ("cleared by the condition
 *      ending or by an operator, never by the calendar"); this command was
 *      deleting them outright.
 *   3. The DELETE was not scoped by `line_id` either, although every canonical
 *      row carries one and `runTransform` only ever re-derives `cfg.lineId`.
 *
 * WHAT IS AND IS NOT RECOVERABLE — measured, not assumed. Canonical rows are
 * a function of `sms_raw.*`, which this command never touches; on this sidecar
 * raw and canonical agree row-for-row on all twelve (table, generation) pairs,
 * so the rows themselves come back. What does not come back is (a) the
 * `dq_finding` history above and (b) the stamping of any generation that was
 * re-derived under rules that have changed since. The rows are recoverable;
 * their provenance and the standing alarms about them are not.
 *
 * THE DEFAULT IS NO DEFAULT, for the same reason `epoch:accept` now has none
 * (6b76ae3): the failure mode of "all generations" is the unrecoverable one,
 * and a destructive command must not pick that for an operator who did not
 * say it. `--epoch=` or `--all-generations` must be given, and neither is
 * implied.
 *
 * THE GATES THIS COMMAND ALREADY HAD, kept:
 *
 *  - `--snapshot-id` must LOOK like a snapshot name. `--snapshot-id=x`
 *    satisfied the original check and the audit row then claimed a snapshot
 *    named "x" existed. The pattern below asks for at least eight characters
 *    of the kind a backup name or a timestamp has (backup-appdb.ps1 produces
 *    `sms_20260914_1530`) — not proof a snapshot was taken, but proof the
 *    operator typed the name of one rather than a placeholder.
 *  - No worker pass may be in progress. The transform lock keeps the rebuild's
 *    DELETE apart from the worker's TRANSFORM, but the worker's READER runs
 *    outside that lock: a pass in flight (a `sync_run` row with no
 *    `finished_at_utc`) is writing raw rows and advancing watermarks this
 *    rebuild is about to reset.
 *
 * and one added: `--confirm`, after a printed plan naming every generation of
 * the table, which of them will be deleted, how many rows that is, and what
 * will be left alone.
 */
import mssql from 'mssql';
import { TRANSFORM_VERSION } from '@sms/shared';
import {
  loadSourceStreams,
  runTransform,
  resetTransformWatermarks,
  withTransformLock,
  TABLE_SHAPES,
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

/**
 * `--epoch=9` / `--epoch=9,11`. Same shape and same filter as `epoch:purge`
 * (epoch.ts), deliberately: two destructive commands that name generations
 * must name them the same way.
 */
export function parseEpochList(v: unknown): number[] {
  if (typeof v !== 'string') return [];
  return [...new Set(v.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))].sort(
    (a, b) => a - b,
  );
}

/** A parameterised `IN (...)`; `bind` must be called on every fresh request. */
export function inClause(prefix: string, values: number[]): {
  sql: string;
  bind: (req: mssql.Request) => mssql.Request;
} {
  return {
    sql: `(${values.map((_, i) => `@${prefix}${i}`).join(', ')})`,
    bind: (req) => {
      values.forEach((v, i) => req.input(`${prefix}${i}`, mssql.Int, v));
      return req;
    },
  };
}

/** One generation of one of this table's source tables, with what it holds. */
export interface GenerationRow {
  epochId: number;
  sourceTable: string;
  sourceDb: string;
  provenance: string;
  open: boolean;
  label: string;
  canonicalRows: number;
  rawRows: number;
}

const n = (v: number): string => v.toLocaleString('en-US');

/**
 * The plan, as printed. Returned as lines rather than written directly so the
 * test can assert the sentences an operator reads — a destructive command's
 * output IS part of its contract.
 */
export function planLines(
  table: string,
  appLabel: string,
  lineId: number,
  snapshotId: string,
  fromVersion: number,
  gens: GenerationRow[],
  scope: number[],
): string[] {
  const inScope = gens.filter((g) => scope.includes(g.epochId));
  const untouched = gens.filter((g) => !scope.includes(g.epochId));
  const delRows = inScope.reduce((s, g) => s + g.canonicalRows, 0);
  const rawRows = inScope.reduce((s, g) => s + g.rawRows, 0);
  const keepRows = untouched.reduce((s, g) => s + g.canonicalRows, 0);
  const out: string[] = [
    '',
    'sms rebuild — DELETES canonical rows and re-derives them from sms_raw.*',
    '',
    `  app         ${appLabel}   (line ${lineId})`,
    `  table       sms.${table}`,
    `  snapshot    ${snapshotId}`,
    `  transform   v${fromVersion} → v${TRANSFORM_VERSION}`,
    '',
    'Generations of this table known to this line',
    `   ${'id'.padStart(3)}  ${'source table'.padEnd(20)} ${'database'.padEnd(18)} ${'provenance'.padEnd(10)} ` +
      `${'state'.padEnd(6)} ${'canonical'.padStart(10)} ${'raw'.padStart(10)}  scope`,
  ];
  for (const g of gens) {
    out.push(
      `   ${String(g.epochId).padStart(3)}  ${g.sourceTable.padEnd(20)} ${g.sourceDb.padEnd(18)} ` +
        `${g.provenance.padEnd(10)} ${(g.open ? 'OPEN' : 'closed').padEnd(6)} ` +
        `${n(g.canonicalRows).padStart(10)} ${n(g.rawRows).padStart(10)}  ${scope.includes(g.epochId) ? 'REBUILD' : '—'}`,
    );
  }
  if (gens.length === 0) out.push('   (none registered for this line)');
  out.push(
    '',
    `  WILL DELETE      ${n(delRows)} row(s) from sms.${table}, generation(s) ${scope.join(', ')}`,
    `  WILL RE-DERIVE   them from ${n(rawRows)} raw row(s); sms_raw.* is NOT touched by this command`,
    `  WILL LEAVE       ${n(keepRows)} row(s) of generation(s) ${untouched.map((g) => g.epochId).join(', ') || '(none)'} untouched`,
    '',
    '  NOT a pure replay: the shift rule, plausibility rule and station roster ON FILE NOW are',
    '  applied, so a re-derived row is stamped under TODAY\'s rules, not the ones in force when it',
    '  was first transformed. That is the point when you meant it and silent when you did not.',
  );
  if (delRows > rawRows) {
    out.push(
      '',
      `  ⚠ MORE CANONICAL THAN RAW (${n(delRows)} vs ${n(rawRows)}): some of what would be deleted has no`,
      '    raw row to come back from and WILL BE LOST. Stop and find out why before confirming.',
    );
  }
  return out;
}

export async function rebuild(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const table = String(args.table ?? '');
  const snapshotId = typeof args['snapshot-id'] === 'string' ? args['snapshot-id'] : '';
  const wantedEpochs = parseEpochList(args.epoch);
  const allGenerations = args['all-generations'] === true;

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
  if (allGenerations && wantedEpochs.length > 0) {
    console.error(
      'REFUSED: --epoch and --all-generations both given. Say one or the other. Nothing has been changed.',
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

    const lineId = ctx.cfg.lineId;
    // The rows this rebuild owns are the ones stamped with the system code(s)
    // of the source(s) this line's tables are read through (sms.data_source,
    // roadmap Phase 1) — was the literal 'ifl_sql'. Bound as parameters; the
    // two reject kinds may in principle come through different sources, so
    // it is an IN list of the distinct codes.
    const kinds = KINDS_OF[table]!;
    const streams = await loadSourceStreams(ctx.app, lineId);
    const systems = [...new Set(kinds.map((k) => streams[k].systemCode))];
    const sourceTables = [...new Set(kinds.map((k) => streams[k].sourceTable))];
    const withSystems = (r: mssql.Request): { req: mssql.Request; inList: string } => {
      systems.forEach((code, i) => r.input(`sys${i}`, mssql.VarChar(20), code));
      r.input('line', mssql.Int, lineId);
      return { req: r, inList: systems.map((_, i) => `@sys${i}`).join(', ') };
    };

    /* ---------------------------------------------- the plan, read-only */

    // Every generation of every source table that feeds this canonical table.
    const epochReq = ctx.app.request().input('line', mssql.Int, lineId);
    sourceTables.forEach((t, i) => epochReq.input(`t${i}`, mssql.VarChar(64), t));
    const epochs = (
      await epochReq.query<{
        epoch_id: number;
        source_table: string;
        source_db: string;
        provenance: string;
        label: string;
        closed_utc: Date | null;
      }>(
        `SELECT epoch_id, source_table, source_db, provenance, label, closed_utc
           FROM sms.source_epoch
          WHERE line_id = @line AND source_table IN (${sourceTables.map((_, i) => `@t${i}`).join(', ')})
          ORDER BY epoch_id`,
      )
    ).recordset;

    // Canonical rows this command would own, per generation. Scoped by
    // line_id as well as by system code — every canonical row carries one and
    // runTransform only ever re-derives this line's.
    const canonQ = withSystems(ctx.app.request());
    const canonByEpoch = new Map<number, number>();
    for (const r of (
      await canonQ.req.query<{ e: number; n: number }>(
        `SELECT source_epoch e, COUNT(*) n FROM sms.${table}
          WHERE line_id = @line AND source_system IN (${canonQ.inList})
          GROUP BY source_epoch`,
      )
    ).recordset) {
      canonByEpoch.set(Number(r.e), Number(r.n));
    }

    // Raw rows behind them — what a re-derive would actually have to work
    // from. Raw is never written by this command; it is counted so the plan
    // can say whether the rows it deletes can come back at all.
    const rawByEpoch = new Map<number, number>();
    for (const kind of kinds) {
      const rawTable = TABLE_SHAPES[kind].rawTable;
      for (const r of (
        await ctx.app
          .request()
          .input('line', mssql.Int, lineId)
          .query<{ e: number; n: number }>(
            `SELECT source_epoch e, COUNT(*) n FROM ${rawTable} WHERE line_id = @line GROUP BY source_epoch`,
          )
      ).recordset) {
        rawByEpoch.set(Number(r.e), (rawByEpoch.get(Number(r.e)) ?? 0) + Number(r.n));
      }
    }

    const gens: GenerationRow[] = epochs.map((e) => ({
      epochId: Number(e.epoch_id),
      sourceTable: e.source_table,
      sourceDb: e.source_db,
      provenance: e.provenance,
      open: e.closed_utc === null,
      label: e.label,
      canonicalRows: canonByEpoch.get(Number(e.epoch_id)) ?? 0,
      rawRows: rawByEpoch.get(Number(e.epoch_id)) ?? 0,
    }));
    const known = gens.map((g) => g.epochId);

    // NO DEFAULT — see the file header. Printed with the real generations of
    // this database, so the operator chooses from what is actually there.
    if (!allGenerations && wantedEpochs.length === 0) {
      const all = gens.reduce((s, g) => s + g.canonicalRows, 0);
      console.error(
        `\nREFUSED: sms rebuild must be told WHICH source generation to rebuild. There is no default.\n` +
          `  --epoch=N[,M]      rebuild those generations only\n` +
          `  --all-generations  rebuild every generation of sms.${table} at once\n` +
          `Generations of sms.${table} on this database (line ${lineId}):\n` +
          gens
            .map(
              (g) =>
                `  --epoch=${String(g.epochId).padEnd(4)} ${g.sourceTable.padEnd(20)} ${g.sourceDb.padEnd(18)} ` +
                  `${g.provenance.padEnd(10)} ${(g.open ? 'OPEN' : 'closed').padEnd(6)} ${n(g.canonicalRows).padStart(10)} rows  ${g.label}`,
            )
            .join('\n') +
          (gens.length === 0 ? '  (none registered)' : '') +
          `\nUntil 23 Sep 2026 this command scoped by source_system alone and would have deleted and ` +
          `re-derived all ${n(all)} of these rows together. Nothing has been changed.`,
      );
      return 2;
    }

    const unknown = wantedEpochs.filter((e) => !known.includes(e));
    if (unknown.length > 0) {
      console.error(
        `\nREFUSED: epoch(s) ${unknown.join(', ')} are not generations of ${sourceTables.join(' / ')} on line ${lineId}. ` +
          `Generations of sms.${table}: ${known.join(', ') || '(none)'}. Run 'sms epoch:list'. Nothing has been changed.`,
      );
      return 2;
    }
    const scope = allGenerations ? known : wantedEpochs;
    if (scope.length === 0) {
      console.error(
        `\nREFUSED: there are no registered generations of sms.${table} on line ${lineId} to rebuild. ` +
          `Run 'sms epoch:list'. Nothing has been changed.`,
      );
      return 2;
    }
    const epochQ = inClause('ep', scope);

    // The version the rows in scope were last transformed at — scoped to the
    // same generations, not to the whole table: a closed generation still at
    // v1 must not be reported as the "from" version of a rebuild that does
    // not include it.
    const fromReq = withSystems(ctx.app.request());
    epochQ.bind(fromReq.req);
    const from = (
      await fromReq.req.query<{ v: number }>(
        `SELECT ISNULL(MIN(transform_version), ${TRANSFORM_VERSION}) v FROM sms.${table}
          WHERE line_id = @line AND source_system IN (${fromReq.inList}) AND source_epoch IN ${epochQ.sql}`,
      )
    ).recordset[0]!.v;

    for (const l of planLines(
      table,
      `${ctx.cfg.app.server}/${ctx.cfg.app.database}`,
      lineId,
      snapshotId,
      from,
      gens,
      scope,
    )) {
      console.log(l);
    }

    if (args.confirm !== true) {
      console.log('\nREFUSED: re-run with --confirm to proceed. Nothing has been changed.');
      return 2;
    }

    /* ---------------------------------------------- from here it deletes */

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

    // sms.rebuild_audit has no column for the generation scope (migration 010
    // predates source_epoch by fifteen migrations), so the scope is recorded
    // where it cannot be lost: sms.audit_log, which migration 030 makes
    // append-only. Without this, two rebuild_audit rows for cone_event are
    // indistinguishable whether one rebuilt one generation and the other all
    // three. Adding the column to rebuild_audit is the better fix and is left
    // for whoever next opens that migration set.
    await ctx.app
      .request()
      .input('action', mssql.VarChar(40), 'rebuild.run')
      .input('type', mssql.VarChar(40), 'canonical_table')
      .input('target', mssql.NVarChar(64), table)
      .input(
        'detail',
        mssql.NVarChar(1000),
        `by the CLI (sms rebuild), no signed-in actor; line ${lineId}; generation(s) ${scope.join(',')} ` +
          `of ${known.join(',') || '(none)'}; snapshot ${snapshotId}; transform v${from} → v${TRANSFORM_VERSION}; ` +
          `rebuild_audit #${rebuildId}`,
      )
      .query(
        `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
         VALUES (NULL, @action, @type, @target, @detail)`,
      );

    console.log(
      `\nrebuild ${table}: generation(s) ${scope.join(', ')}, snapshot ${snapshotId}, transform v${from} → v${TRANSFORM_VERSION}`,
    );

    // Everything from here on races the sync-worker's own continuous transform
    // pass against the same canonical table and watermark keys (finding C1,
    // Sep 2026 audit) — hold the shared lock for all of it, not just the
    // transform call, so the DELETE below can't land mid-way through a
    // concurrent pass.
    const rebuilt = await withTransformLock(ctx.cfg.app, async () => {
      // Chunked, not one statement. Clearing cone_event is hundreds of
      // thousands of rows: as a single DELETE that is one transaction held
      // open for the whole scan, growing the log by the size of the table —
      // on a plant PC with a modest disk that is how a maintenance command
      // becomes an outage. Small batches keep each statement short and let
      // the log wrap between them. `table` is checked against ALLOWED above,
      // so the interpolation is safe; the system code, the line and every
      // epoch id are bound parameters.
      let cleared = 0;
      for (;;) {
        const delQ = withSystems(ctx.app.request());
        epochQ.bind(delQ.req);
        const del = await delQ.req.query(
          `DELETE TOP (5000) FROM sms.${table}
            WHERE line_id = @line AND source_system IN (${delQ.inList}) AND source_epoch IN ${epochQ.sql}`,
        );
        const k = del.rowsAffected[0] ?? 0;
        cleared += k;
        if (k === 0) break;
      }
      console.log(`cleared ${n(cleared)} existing rows`);

      // DQ findings. `sms.dq_finding` carries no generation, so there is no
      // way to clear only the findings of the generations being rebuilt —
      // which is precisely why this is now conditional:
      //
      //  - a targeted rebuild clears NOTHING. Deleting by subject_table would
      //    take findings belonging to generations this run is not re-deriving,
      //    and nothing would ever put them back. The cost of not deleting is
      //    that a stale finding for the rebuilt generation may sit beside the
      //    new one (persistFindings dedups on check+table+detail, and the
      //    detail carries a row count that a one-batch re-derive changes), so
      //    the plan says so rather than pretending it is clean.
      //  - an --all-generations rebuild re-derives every row of the table, so
      //    every row-derived finding WILL be recomputed and clearing them is
      //    safe — except CRITICAL, which is never deleted by either path.
      //    `transform_zero_write` (runTransform.ts:375) is CRITICAL and lands
      //    on exactly these subject_table values: it is the alarm saying rows
      //    were not written, and a rebuild deleting it is how a real loss
      //    would become invisible. `sms retention` already refuses to clear a
      //    CRITICAL finding on age; this refuses to clear one on rebuild.
      if (allGenerations) {
        const d = await ctx.app
          .request()
          .input('tbl2', mssql.VarChar(40), table)
          .query(`DELETE FROM sms.dq_finding WHERE subject_table=@tbl2 AND severity <> 'CRITICAL'`);
        console.log(
          `cleared ${n(d.rowsAffected[0] ?? 0)} non-critical dq_finding row(s) for ${table} (every generation is being re-derived)`,
        );
      } else {
        console.log(
          `sms.dq_finding NOT cleared: it carries no generation, so clearing it would take findings ` +
            `belonging to generations this run is not re-deriving. Stale rows may remain beside the new ones.`,
        );
      }

      // The transform is incremental (raw watermark) — reset this stream's
      // watermark or the re-run sees an empty batch and rebuilds nothing.
      // Reset to zero even for a targeted rebuild: the transform's own
      // freshness filter (runTransform's onlyFresh, keyed on raw_id) drops
      // every raw row whose canonical row still exists, so the generations
      // left alone above are re-read and then skipped, never duplicated. It
      // costs one full scan of the raw stream; correctness over speed at the
      // one command that deletes.
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
    console.log(`rebuilt ${n(rebuilt)} rows (audit #${rebuildId})`);
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
