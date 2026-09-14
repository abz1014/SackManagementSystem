/**
 * `sms cutover --confirm` — throw away everything reproducible from the source
 * and start again from an empty raw layer.
 *
 * WHAT THIS IS NOT. It is no longer the answer to a source rebuild or a
 * repoint. That is `sms epoch:accept`: it registers the generation the source
 * now reports as a NEW open epoch, the old one is closed and kept, and the
 * worker backfills the new generation beside the old rows — history survives.
 * Reach for cutover only when the old rows must NOT survive: a corrupt or
 * mis-ingested raw layer, a development database being reset, a rehearsal
 * being wound back. It deletes every generation, including the ones the source
 * can no longer corroborate; they cannot be re-fetched afterwards.
 *
 * WHY IT STILL EXISTS. Before epochs, a repoint at a source whose ids started
 * again near 1 was silent and total: the reader's watermark was MAX(src_id)
 * out of OUR raw table, so it asked for `id > 203576`, got nothing, and
 * recorded outcome='success' every 60 seconds forever — or, where the new
 * source had grown past the watermark, appended rows under colliding ids so a
 * reject count climbed against a frozen cone denominator. The epoch gate now
 * halts on that before reading. What remains for cutover is the honest reset.
 *
 * WHAT IT CLEARS, AND WHAT IT MUST NOT. The raw and canonical layers are
 * reproducible from the source and go. Everything the app itself owns —
 * users, the product timeline, reject-code labels, rules, adjustments, audit —
 * exists nowhere else and MUST survive. That asymmetry is the whole design:
 * this is not "empty the database".
 *
 * ORDER MATTERS. `sms.source_epoch` is cleared too, but LAST: all four raw
 * tables and all three canonical tables carry an FK to it, so the epoch rows
 * can only go once their rows have. The table is then left EMPTY. Migration
 * 025's bootstrap seed does not run again — the migration is already recorded
 * as applied — so the next `sms epoch:accept --all --confirm` is what
 * registers the live source, and until it runs the worker halts with "no open
 * source generation", which is correct. `sms.sync_run` keeps its history; its
 * `source_epoch` column has no FK and the old ids simply stop resolving.
 */
import mssql from 'mssql';
import { loadSourceTables, resetTransformWatermarks, TABLE_KINDS, TABLE_SHAPES } from '@sms/sync-worker';
import { openContext, parseArgs, cliLog } from '../context.js';

/** Canonical + raw tables, cleared in FK-free dependency order (canonical first). */
const CANONICAL = ['sms.cone_event', 'sms.sack_event', 'sms.reject_event'] as const;
// Every raw table the schema has, by kind — the raw layer is fixed by
// migration, so it is cleared whole, whatever sms.source_table says today.
const RAW = TABLE_KINDS.map((k) => TABLE_SHAPES[k].rawTable);
const WM_TABLES = ['cone_event', 'sack_event', 'reject_event'] as const;

/** Preserved on purpose — app-owned data that exists in no other system. */
const PRESERVED = [
  'app_user',
  'product / product_timeline',
  'reject_code labels',
  'shift_rule / weight_rule / plausibility_rule',
  'calibration_adjustment',
  'admin audit',
];

export async function cutover(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const ctx = await openContext();

  try {
    // Same halt as the worker's: a line with no configured source tables has
    // nothing to cut over TO, and the next step this command prints,
    // `sms epoch:accept --all`, would find nothing to register.
    const tables = await loadSourceTables(ctx.app, ctx.cfg.lineId);

    // Report the damage BEFORE doing anything, so --confirm is an informed act.
    const counts: { name: string; rows: number }[] = [];
    for (const t of [...CANONICAL, ...RAW]) {
      const r = await ctx.app.request().query<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`);
      counts.push({ name: t, rows: Number(r.recordset[0]?.n ?? 0) });
    }
    const total = counts.reduce((n, c) => n + c.rows, 0);
    const gens = await ctx.app.request().query<{ n: number }>(`SELECT COUNT(*) n FROM sms.source_epoch`);

    console.log('cutover — clears the reproducible layers, keeps everything app-owned\n');
    console.log(`  line ${ctx.cfg.lineId} reads: ${tables.map((t) => t.sourceTable).join(', ')}`);
    for (const c of counts) console.log(`  ${c.name.padEnd(28)} ${String(c.rows).padStart(9)} rows`);
    console.log(`  ${'TOTAL'.padEnd(28)} ${String(total).padStart(9)} rows`);
    console.log(
      `  ${'sms.source_epoch'.padEnd(28)} ${String(Number(gens.recordset[0]?.n ?? 0)).padStart(9)} generation(s) — ALL deleted, including archived ones\n`,
    );
    console.log('  preserved:');
    for (const p of PRESERVED) console.log(`    - ${p}`);
    console.log();

    if (args.confirm !== true) {
      console.log('REFUSED: re-run with --confirm to proceed. Nothing has been changed.');
      return 2;
    }

    // 1. canonical, then raw. Chunked: clearing cone_event is 200k+ rows, and a
    //    single DELETE holds one transaction open for the whole scan and grows
    //    the log by the size of the table — on a plant PC that is an outage.
    for (const t of [...CANONICAL, ...RAW]) {
      let cleared = 0;
      for (;;) {
        const del = await ctx.app.request().query(`DELETE TOP (5000) FROM ${t}`);
        const n = del.rowsAffected[0] ?? 0;
        cleared += n;
        if (n === 0) break;
      }
      console.log(`  cleared ${String(cleared).padStart(9)} from ${t}`);
    }

    // 2. transform watermarks back to zero
    for (const t of WM_TABLES) await resetTransformWatermarks(ctx.app, t);
    console.log('  reset transform watermarks');

    // 3. The generation registry, now that nothing references it. Left empty on
    //    purpose: the next `sms epoch:accept --all --confirm` registers whatever
    //    the source reports, and the worker halts until it has.
    const ep = await ctx.app.request().query(`DELETE FROM sms.source_epoch`);
    console.log(`  cleared ${ep.rowsAffected[0] ?? 0} source generation(s) — registry now empty`);

    // 4. DQ findings are ingest-scoped: they describe rows that no longer exist.
    const dq = await ctx.app.request().query(`DELETE FROM sms.dq_finding`);
    console.log(`  cleared ${dq.rowsAffected[0] ?? 0} DQ findings (they described deleted rows)`);

    // 5. Record it. sync_run history is deliberately KEPT — it is the operational
    //    record of what this worker did, and it survives a source change.
    await ctx.app
      .request()
      .input('k', mssql.VarChar(128), 'cutover.last_utc')
      .input('v', mssql.NVarChar(256), new Date().toISOString())
      .query(
        `MERGE sms.app_config AS t USING (SELECT @k k, @v v) s ON t.config_key = s.k
         WHEN MATCHED THEN UPDATE SET config_value = s.v
         WHEN NOT MATCHED THEN INSERT (config_key, config_value) VALUES (s.k, s.v);`,
      );

    console.log(`\ndone. The generation registry is empty and migration 025's seed will not re-run.`);
    console.log(`Next:  sms epoch:accept --all --confirm --provenance <ifl_live|ifl_copy|simulator> --label "..."`);
    console.log(`       sms sync        (backfills the generation just registered)`);
    console.log(`       sms verify      (a STOP after the backfill has settled is a STOP condition)`);
    return 0;
  } catch (err) {
    console.error(`cutover failed: ${err instanceof Error ? err.message : String(err)}`);
    cliLog.error('cutover failed', { error: err instanceof Error ? err.message : String(err) });
    return 1;
  } finally {
    await ctx.close();
  }
}
