/**
 * `sms epoch:backfill` — R-17 (DEFECTS.md). A safe tail backfill of historic
 * rows into an already-CLOSED source generation: the 10 Jul - 5 Aug archive
 * IFL has not yet sent belongs to the SAME physical generation as the July
 * sample already registered here as epochs 1-4 (generation_ordinal 1) — see
 * sync-worker/src/backfill.ts's own header for the full account.
 *
 *   sms epoch:backfill --table=<name>|--all --epoch=<id> --source-db=<name>
 *                       [--confirm] [--sampled]
 *
 * --table names ONE physical source table (pack1_TP1U2, sack1_TP1U2, ...);
 * --epoch must be exactly THAT table's own epoch id. --all instead backfills
 * every one of this line's configured tables that shares --epoch's physical
 * generation — the same (source_db, generation_ordinal) grouping
 * api/src/services/generation.ts already uses — so a single command can
 * extend all four July epochs at once without an operator naming each one.
 *
 * --source-db names the database, on the SAME server this line's IFL_DB_*
 * already points at, that holds the archive. It is opened through a plain
 * read pool and never written to.
 *
 * --sampled trades the full row-by-row overlap checksum for a faster
 * CHECKSUM_AGG over every 50th id — see sync-worker/src/backfill.ts's
 * overlapChecksum for the honest cost of that trade. Default is the full
 * check.
 *
 * Prints the target server/database and a dry-run plan (source max id,
 * existing max id already held, the tail range, and the overlap proof's own
 * result) for every table in scope, and refuses without --confirm. On any
 * overlap mismatch, or any table whose epoch is open/unknown/the wrong
 * shape, the WHOLE command refuses with 0 writes — never a partial backfill
 * of some tables and not others in the same --all run.
 */
import mssql from 'mssql';
import { randomUUID } from 'node:crypto';
import {
  createPool,
  loadSourceTables,
  withTransformLock,
  getEpochById,
  siblingEpochs,
  julyDefFor,
  planTableBackfill,
  executeTableBackfill,
  shortRawTable,
  type BackfillEpochRow,
  type TableBackfillPlan,
} from '@sms/sync-worker';
import { openContext, parseArgs, cliLog } from '../context.js';

function fmtId(n: number | null): string {
  return n === null ? '(empty)' : String(n);
}

export async function epochBackfill(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const wantAll = args.all === true;
  const table = typeof args.table === 'string' ? args.table : '';
  if (!wantAll && !table) {
    console.error('specify --table=<sourceTable> or --all');
    return 2;
  }
  const epochIdRaw = args.epoch;
  const epochId = typeof epochIdRaw === 'string' ? Number(epochIdRaw) : NaN;
  if (!Number.isInteger(epochId) || epochId <= 0) {
    console.error(
      'REFUSED: --epoch=<id> is required, naming the CLOSED generation this archive extends. Inserting an ' +
        'entirely new historic generation — one with no epoch row at all yet — is a different, deliberately ' +
        'deferred operation; this command only ever extends an existing epoch. Nothing has been changed.',
    );
    return 2;
  }
  const sourceDbName = typeof args['source-db'] === 'string' ? args['source-db'] : '';
  if (!sourceDbName) {
    console.error('specify --source-db=<name of the database holding the archive>');
    return 2;
  }
  const overlapMode = args.sampled === true ? 'sampled' : 'full';

  const ctx = await openContext({ needIfl: false });
  let sourcePool: mssql.ConnectionPool | null = null;
  try {
    const sourceDbConfig = { ...ctx.cfg.iflData, database: sourceDbName };
    console.log(`\ntarget app db: ${ctx.cfg.app.server}/${ctx.cfg.app.database}`);
    console.log(`source archive: ${sourceDbConfig.server}/${sourceDbConfig.database}\n`);
    sourcePool = await createPool(sourceDbConfig);

    const anchor = await getEpochById(ctx.app, epochId);
    if (!anchor) {
      console.error(
        `REFUSED: no such epoch: ${epochId}. 'sms epoch:list' shows what is registered. Nothing has been changed.`,
      );
      return 2;
    }

    let epochs: BackfillEpochRow[];
    if (wantAll) {
      epochs = await siblingEpochs(ctx.app, ctx.cfg.lineId, anchor);
      if (epochs.length === 0) epochs = [anchor];
    } else {
      if (anchor.source_table !== table) {
        console.error(
          `REFUSED: epoch ${epochId} belongs to ${anchor.source_table}, not ${table}. --table and --epoch must ` +
            `name the same physical source table. Nothing has been changed.`,
        );
        return 2;
      }
      epochs = [anchor];
    }

    // The kind (cone/sack/reject_qcs/reject_weight) is configuration on this
    // line, not something the epoch row itself carries — loadSourceTables is
    // read only for that mapping; its own (September-shape) columns are never
    // used, only (kind, sourceTable).
    const configured = await loadSourceTables(ctx.app, ctx.cfg.lineId);
    const kindByTable = new Map(configured.map((d) => [d.sourceTable, d.key]));

    const plans: TableBackfillPlan[] = [];
    for (const epoch of epochs) {
      const kind = kindByTable.get(epoch.source_table);
      if (!kind) {
        console.error(
          `REFUSED: ${epoch.source_table} (epoch ${epoch.epoch_id}) is not a configured source table for line ` +
            `${ctx.cfg.lineId} (Setup › Sources). Nothing has been changed.`,
        );
        return 2;
      }
      const def = julyDefFor(epoch.source_table, kind);
      let plan: TableBackfillPlan;
      try {
        plan = await planTableBackfill(ctx.app, sourcePool, def, ctx.cfg.lineId, epoch, { mode: overlapMode });
      } catch (err) {
        console.error(`REFUSED: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      plans.push(plan);

      console.log(`  ${epoch.source_table} (epoch ${epoch.epoch_id}, "${epoch.label}")`);
      console.log(`      source now reports max id: ${fmtId(plan.sourceMaxId)}`);
      console.log(`      sms_raw already holds up to id: ${plan.existingMaxId || '(none)'}`);
      console.log(
        `      overlap proof (${plan.overlap.mode}, ${plan.overlap.checkedIds} id(s) checked): ` +
          `${plan.overlap.match ? 'MATCH' : 'MISMATCH'}`,
      );
      if (plan.tailCount > 0) {
        console.log(`      would insert ids ${plan.tailFrom}..${fmtId(plan.tailTo)} (${plan.tailCount} row(s)) into ${shortRawTable(def)}`);
      } else {
        console.log(`      nothing to backfill — the archive holds no ids past what is already stored`);
      }
    }

    if (plans.every((p) => p.tailCount === 0)) {
      console.log('\nnothing to backfill.');
      return 0;
    }

    if (args.confirm !== true) {
      console.log('\nREFUSED: re-run with --confirm to write. Nothing has been changed.');
      return 2;
    }

    const ingestRunId = randomUUID();
    const outcomes = await withTransformLock(ctx.cfg.app, async () => {
      const out = [];
      for (const plan of plans) {
        out.push(await executeTableBackfill(ctx.app, sourcePool!, ctx.cfg.lineId, ingestRunId, plan));
      }
      return out;
    });

    const totalInserted = outcomes.reduce((s, o) => s + o.inserted, 0);
    for (const o of outcomes) {
      console.log(`  ${o.sourceTable}: inserted ${o.inserted} row(s) under epoch ${o.epochId}`);
    }

    await ctx.app
      .request()
      .input('action', mssql.VarChar(40), 'epoch.backfill')
      .input('type', mssql.VarChar(40), 'source_epoch')
      .input('target', mssql.NVarChar(64), epochs.map((e) => e.epoch_id).join(',').slice(0, 64))
      .input(
        'detail',
        mssql.NVarChar(1000),
        `by the CLI (sms epoch:backfill), no signed-in actor; source ${sourceDbConfig.server}/` +
          `${sourceDbConfig.database}; ${totalInserted} row(s) inserted across ${outcomes.length} table(s); ` +
          `overlap mode: ${overlapMode}; ingest_run_id ${ingestRunId}`,
      )
      .query(
        `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
         VALUES (NULL, @action, @type, @target, @detail)`,
      );

    console.log(`\ndone. ${totalInserted} row(s) inserted total. Run 'sms rebuild --epoch=... --confirm' to derive them into canonical.`);
    return 0;
  } catch (err) {
    console.error(`epoch:backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    cliLog.error('epoch:backfill failed', { error: err instanceof Error ? err.message : String(err) });
    return 1;
  } finally {
    await sourcePool?.close().catch(() => {});
    await ctx.close();
  }
}
