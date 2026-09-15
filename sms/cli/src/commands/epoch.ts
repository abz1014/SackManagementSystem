/**
 * `sms epoch:*` — manage source generations.
 *
 *   sms epoch:list
 *   sms epoch:accept --all|--table=<t> --confirm [--label "…"] [--provenance ifl_copy]
 *   sms epoch:purge  --epoch=5,6,7,8 --confirm
 *   sms epoch:drop   --epoch=N --confirm
 *
 * Accepting a generation is deliberately an operator act, not something the
 * worker does for itself. A `create_date` cannot distinguish "the vendor rebuilt
 * the table" from "IFL_DB_NAME_DATA points at the wrong database", and those need
 * opposite responses — so the worker halts and a human looks.
 */
import mssql from 'mssql';
import { loadSourceTables, readSourceIdentity, openEpoch, createAdapter, withTransformLock } from '@sms/sync-worker';
import { openContext, parseArgs, cliLog } from '../context.js';
import { inFlightProblem, passesInFlight, requireBackupFlag } from '../guards.js';

const asList = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

export async function epochList(): Promise<number> {
  const ctx = await openContext();
  try {
    const r = await ctx.app.request().query<{
      epoch_id: number;
      source_table: string;
      source_server: string;
      source_db: string;
      source_created_key: string;
      schema_fingerprint: string;
      provenance: string;
      label: string;
      state_: string;
      rows_: number;
      first_: string | null;
      last_: string | null;
    }>(`
      WITH raw_ AS (
        SELECT source_epoch, src_ProductionDate ts FROM sms_raw.cone_raw
        UNION ALL SELECT source_epoch, src_Date            FROM sms_raw.sack_raw
        UNION ALL SELECT source_epoch, src_ProductionDate  FROM sms_raw.reject_qcs_raw
        UNION ALL SELECT source_epoch, src_ProductionDate  FROM sms_raw.reject_weight_raw
      )
      SELECT e.epoch_id, e.source_table, e.source_server, e.source_db, e.source_created_key,
             e.schema_fingerprint, e.provenance, e.label,
             CASE WHEN e.closed_utc IS NULL THEN 'OPEN' ELSE 'closed' END AS state_,
             ISNULL(COUNT(r.source_epoch), 0) AS rows_,
             CONVERT(varchar(19), MIN(r.ts), 120) AS first_,
             CONVERT(varchar(19), MAX(r.ts), 120) AS last_
        FROM sms.source_epoch e
        LEFT JOIN raw_ r ON r.source_epoch = e.epoch_id
       GROUP BY e.epoch_id, e.source_table, e.source_server, e.source_db, e.source_created_key,
                e.schema_fingerprint, e.provenance, e.label, e.closed_utc
       ORDER BY e.epoch_id`);

    console.log(
      `\n${'id'.padStart(3)}  ${'table'.padEnd(20)} ${'db'.padEnd(17)} ${'provenance'.padEnd(10)} ` +
        `${'state'.padEnd(6)} ${'rows'.padStart(8)}  window`,
    );
    console.log('-'.repeat(108));
    for (const e of r.recordset) {
      const win = e.rows_ > 0 ? `${e.first_} → ${e.last_}` : '(no rows)';
      console.log(
        `${String(e.epoch_id).padStart(3)}  ${e.source_table.padEnd(20)} ${e.source_db.padEnd(17)} ` +
          `${e.provenance.padEnd(10)} ${e.state_.padEnd(6)} ${String(e.rows_).padStart(8)}  ${win}`,
      );
      console.log(
        `     ${e.label} · created ${e.source_created_key} · fp ${e.schema_fingerprint}`,
      );
    }
    console.log();
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function epochAccept(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const wantAll = args.all === true;
  const table = typeof args.table === 'string' ? args.table : '';
  if (!wantAll && !table) {
    console.error('specify --all or --table=<sourceTable>');
    return 2;
  }
  const ctx = await openContext({ needIfl: true });
  try {
    // The tables a generation can be accepted for are the line's configured
    // ones (sms.source_table, roadmap Phase 1) — a table renamed in Setup ›
    // Sources is a new generation, and this is the command that registers it.
    const configured = await loadSourceTables(ctx.app, ctx.cfg.lineId);
    const defs = wantAll ? configured : configured.filter((d) => d.sourceTable === table);
    if (defs.length === 0) {
      console.error(
        `unknown table: ${table}. Configured for line ${ctx.cfg.lineId}: ` +
          `${configured.map((d) => d.sourceTable).join(', ')}`,
      );
      return 2;
    }

    const provenance = typeof args.provenance === 'string' ? args.provenance : 'ifl_copy';
    if (!['ifl_live', 'ifl_copy', 'simulator'].includes(provenance)) {
      console.error(`--provenance must be ifl_live | ifl_copy | simulator`);
      return 2;
    }

    console.log(`\nsource: ${ctx.cfg.iflData.server}/${ctx.cfg.iflData.database}\n`);
    const plan: { def: (typeof defs)[number]; now: Awaited<ReturnType<typeof readSourceIdentity>>; openId: number | null; ordinal: number; max: number | null }[] = [];

    for (const def of defs) {
      const now = await readSourceIdentity(ctx.ifl, def, ctx.cfg.iflData);
      const open = await openEpoch(ctx.app, ctx.cfg.lineId, def.sourceTable);
      // Through the registry, like the worker (Phase 2) — the only reader of
      // the source this command has is the configured adapter.
      const sourceMax = await createAdapter(def.systemCode, ctx.ifl, def).maxSourceId();
      const ord = await ctx.app
        .request()
        .input('line', mssql.Int, ctx.cfg.lineId)
        .input('tbl', mssql.VarChar(64), def.sourceTable)
        .query<{ n: number }>(
          `SELECT ISNULL(MAX(generation_ordinal), 0) + 1 n FROM sms.source_epoch
            WHERE line_id = @line AND source_table = @tbl`,
        );

      // Already registered and open? Then there is nothing to accept.
      if (
        open &&
        open.source_server === now.server &&
        open.source_db === now.database &&
        open.source_created_key === now.createdKey &&
        open.schema_fingerprint === now.fingerprint
      ) {
        console.log(`  ${def.sourceTable.padEnd(22)} already open as epoch ${open.epoch_id} — nothing to do`);
        continue;
      }

      plan.push({
        def,
        now,
        openId: open?.epoch_id ?? null,
        ordinal: Number(ord.recordset[0]?.n ?? 1),
        max: sourceMax,
      });

      console.log(`  ${def.sourceTable}`);
      if (open) {
        console.log(`      closing epoch ${open.epoch_id} ("${open.label}")`);
        console.log(`        was: ${open.source_server}/${open.source_db} created ${open.source_created_key} fp ${open.schema_fingerprint}`);
      } else {
        console.log(`      no open generation (first registration)`);
      }
      console.log(`        new: ${now.server}/${now.database} created ${now.createdKey} fp ${now.fingerprint}`);
      console.log(`        source MAX(id) = ${plan[plan.length - 1]!.max ?? 'none (empty)'}`);
    }

    if (plan.length === 0) {
      console.log('\nnothing to accept.');
      return 0;
    }
    if (args.confirm !== true) {
      console.log('\nREFUSED: re-run with --confirm to register. Nothing has been changed.');
      return 2;
    }

    // parseArgs only understands --key=value. A bare `--label "September copy"`
    // parses as a flag plus a stray word, and the generation silently gets the
    // default name — which is exactly what happened on the first real accept.
    if (args.label === true) {
      console.error('--label needs an equals sign: --label="September copy". Registering with the default name.');
    }
    const label = typeof args.label === 'string' ? args.label : '';
    for (const p of plan) {
      if (p.openId !== null) {
        await ctx.app
          .request()
          .input('id', mssql.Int, p.openId)
          .query(`UPDATE sms.source_epoch SET closed_utc = SYSUTCDATETIME() WHERE epoch_id = @id`);
      }
      const ins = await ctx.app
        .request()
        .input('line', mssql.Int, ctx.cfg.lineId)
        .input('tbl', mssql.VarChar(64), p.def.sourceTable)
        .input('srv', mssql.NVarChar(128), p.now.server)
        .input('db', mssql.NVarChar(128), p.now.database)
        .input('key', mssql.VarChar(40), p.now.createdKey)
        .input('fp', mssql.Char(32), p.now.fingerprint)
        .input('prov', mssql.VarChar(20), provenance)
        .input('ord', mssql.Int, p.ordinal)
        .input('lbl', mssql.NVarChar(64), label || `${p.def.sourceTable} gen ${p.ordinal}`)
        // The FULL column list at acceptance (migration 029, Phase 2): the
        // baseline the worker compares the live table against on every pass.
        .input('cols', mssql.NVarChar(mssql.MAX), JSON.stringify(p.now.columnList))
        .query<{ id: number }>(
          `INSERT INTO sms.source_epoch
             (line_id, source_table, source_server, source_db, source_created_key,
              schema_fingerprint, provenance, generation_ordinal, label, registered_by, column_list)
           OUTPUT INSERTED.epoch_id id
           VALUES (@line, @tbl, @srv, @db, @key, @fp, @prov, @ord, @lbl, 'cli:epoch-accept', @cols)`,
        );
      console.log(`  registered epoch ${ins.recordset[0]!.id} for ${p.def.sourceTable}`);
    }
    console.log(`\ndone. Run 'sms sync' to backfill the new generation.`);
    return 0;
  } catch (err) {
    console.error(`epoch:accept failed: ${err instanceof Error ? err.message : String(err)}`);
    cliLog.error('epoch:accept failed', { error: err instanceof Error ? err.message : String(err) });
    return 1;
  } finally {
    await ctx.close();
  }
}

/**
 * Delete an epoch's ROWS, keeping the epoch row as a tombstone.
 *
 * The tombstone is the point: the record of what was once in this database has
 * to survive the deletion of the rows, or a future operator cannot tell an id
 * range that was purged from one that was never ingested.
 *
 * Gated like cutover since roadmap Phase 11 (14 Sep 2026): `--backup=<path>`
 * naming an existing .bak, no pass in flight, deletes under the transform
 * lock. See guards.ts for why each.
 */
export async function epochPurge(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const ids = asList(args.epoch).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    console.error('specify --epoch=N or --epoch=N,M,...');
    return 2;
  }
  const backup = requireBackupFlag(args, 'sms epoch:purge');
  if (!backup.ok) {
    console.error(backup.problem);
    return 2;
  }

  const ctx = await openContext();
  try {
    const list = ids.join(',');
    const counts = await ctx.app.request().query<{ t: string; n: number }>(`
      SELECT 'sms.cone_event' t, COUNT(*) n FROM sms.cone_event   WHERE source_epoch IN (${list})
      UNION ALL SELECT 'sms.sack_event',   COUNT(*) FROM sms.sack_event   WHERE source_epoch IN (${list})
      UNION ALL SELECT 'sms.reject_event', COUNT(*) FROM sms.reject_event WHERE source_epoch IN (${list})
      UNION ALL SELECT 'sms_raw.cone_raw', COUNT(*) FROM sms_raw.cone_raw WHERE source_epoch IN (${list})
      UNION ALL SELECT 'sms_raw.sack_raw', COUNT(*) FROM sms_raw.sack_raw WHERE source_epoch IN (${list})
      UNION ALL SELECT 'sms_raw.reject_qcs_raw',    COUNT(*) FROM sms_raw.reject_qcs_raw    WHERE source_epoch IN (${list})
      UNION ALL SELECT 'sms_raw.reject_weight_raw', COUNT(*) FROM sms_raw.reject_weight_raw WHERE source_epoch IN (${list})`);

    const meta = await ctx.app.request().query<{ epoch_id: number; label: string; provenance: string }>(
      `SELECT epoch_id, label, provenance FROM sms.source_epoch WHERE epoch_id IN (${list}) ORDER BY epoch_id`,
    );
    if (meta.recordset.length === 0) {
      console.error(`no such epoch(s): ${list}`);
      return 2;
    }

    console.log(`\npurging epoch(s) ${list} — rows deleted, epoch rows kept as tombstones\n`);
    for (const m of meta.recordset) {
      console.log(`  ${String(m.epoch_id).padStart(3)}  ${m.provenance.padEnd(10)} ${m.label}`);
    }
    console.log();
    let total = 0;
    for (const c of counts.recordset) {
      total += Number(c.n);
      console.log(`  ${c.t.padEnd(28)} ${String(c.n).padStart(9)} rows`);
    }
    console.log(`  ${'TOTAL'.padEnd(28)} ${String(total).padStart(9)} rows`);
    console.log(`  backup named: ${backup.path}\n`);

    if (args.confirm !== true) {
      console.log('REFUSED: re-run with --confirm to proceed. Nothing has been changed.');
      return 2;
    }

    const inFlight = await passesInFlight(ctx.app);
    if (inFlight > 0) {
      console.error(inFlightProblem(inFlight, 'sms epoch:purge'));
      return 2;
    }

    // Canonical first, then raw: canonical references raw_id. Chunked so the
    // transaction log stays small on a plant PC. Under the transform lock so
    // the worker cannot be transforming the raw rows being deleted.
    const targets = [
      'sms.cone_event',
      'sms.sack_event',
      'sms.reject_event',
      'sms_raw.cone_raw',
      'sms_raw.sack_raw',
      'sms_raw.reject_qcs_raw',
      'sms_raw.reject_weight_raw',
    ];
    await withTransformLock(ctx.cfg.app, async () => {
      for (const t of targets) {
        let cleared = 0;
        for (;;) {
          const del = await ctx.app
            .request()
            .query(`DELETE TOP (5000) FROM ${t} WHERE source_epoch IN (${list})`);
          const n = del.rowsAffected[0] ?? 0;
          cleared += n;
          if (n === 0) break;
        }
        if (cleared > 0) console.log(`  cleared ${String(cleared).padStart(9)} from ${t}`);
      }

      await ctx.app.request().query(
        `UPDATE sms.source_epoch
            SET closed_utc = ISNULL(closed_utc, SYSUTCDATETIME()),
                note = CONCAT(ISNULL(note, N''), N' Rows purged ',
                              CONVERT(varchar(19), SYSUTCDATETIME(), 126), N'.')
          WHERE epoch_id IN (${list})`,
      );
    });
    await ctx.app
      .request()
      .input('action', mssql.VarChar(40), 'epoch.purge')
      .input('type', mssql.VarChar(40), 'source_epoch')
      .input('target', mssql.NVarChar(64), list.slice(0, 64))
      .input('detail', mssql.NVarChar(1000), `by the CLI (sms epoch:purge), no signed-in actor; ${total} rows purged; backup named: ${backup.path}`)
      .query(
        `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
         VALUES (NULL, @action, @type, @target, @detail)`,
      );
    console.log(`\ndone. Epoch row(s) kept as tombstones — 'sms epoch:list' still shows them.`);
    return 0;
  } catch (err) {
    console.error(`epoch:purge failed: ${err instanceof Error ? err.message : String(err)}`);
    cliLog.error('epoch:purge failed', { error: err instanceof Error ? err.message : String(err) });
    return 1;
  } finally {
    await ctx.close();
  }
}

/** Undo a registration that should not have happened. Refuses if rows exist. */
export async function epochDrop(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const id = Number(args.epoch);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('specify --epoch=N');
    return 2;
  }
  const ctx = await openContext();
  try {
    const c = await ctx.app.request().query<{ n: number }>(`
      SELECT (SELECT COUNT(*) FROM sms_raw.cone_raw          WHERE source_epoch = ${id})
           + (SELECT COUNT(*) FROM sms_raw.sack_raw          WHERE source_epoch = ${id})
           + (SELECT COUNT(*) FROM sms_raw.reject_qcs_raw    WHERE source_epoch = ${id})
           + (SELECT COUNT(*) FROM sms_raw.reject_weight_raw WHERE source_epoch = ${id}) AS n`);
    const rows = Number(c.recordset[0]?.n ?? 0);
    if (rows > 0) {
      console.error(
        `REFUSED: epoch ${id} still holds ${rows} raw rows. Use 'sms epoch:purge --epoch=${id} --confirm' ` +
          `if you mean to delete them; dropping the epoch row would orphan them.`,
      );
      return 2;
    }
    if (args.confirm !== true) {
      console.log(`would delete epoch ${id} (0 rows attached). Re-run with --confirm.`);
      return 2;
    }
    await ctx.app.request().query(`DELETE FROM sms.source_epoch WHERE epoch_id = ${id}`);
    console.log(`deleted epoch ${id}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
