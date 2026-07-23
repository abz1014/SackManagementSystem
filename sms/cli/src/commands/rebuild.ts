/**
 * `sms rebuild --table=<t> --snapshot-id=<id>` — rebuild a canonical table from
 * raw at the current transform_version (ARCHITECTURE §18).
 * HARD GATE: refuses to run without --snapshot-id (proof a pre-rebuild snapshot
 * was taken). Records rebuild_audit. Deletes then re-transforms (idempotent).
 */
import mssql from 'mssql';
import { TRANSFORM_VERSION } from '@sms/shared';
import { runTransform } from '@sms/sync-worker';
import { openContext, parseArgs } from '../context.js';

const ALLOWED = new Set(['cone_event', 'sack_event', 'reject_event']);

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

  const ctx = await openContext();
  try {
    const from = (
      await ctx.app.request().query<{ v: number }>(
        `SELECT ISNULL(MIN(transform_version), ${TRANSFORM_VERSION}) v FROM sms.${table} WHERE source_system='ifl_sql'`,
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
    const rebuildId = audit.recordset[0]!.id;

    console.log(`rebuild ${table}: snapshot ${snapshotId}, transform v${from} → v${TRANSFORM_VERSION}`);
    await ctx.app.request().query(`DELETE FROM sms.${table} WHERE source_system='ifl_sql'`);
    const out = await runTransform(ctx.app, ctx.cfg);
    const rebuilt = out.find((o) => o.table === table)?.written ?? 0;

    await ctx.app
      .request()
      .input('id', mssql.BigInt, rebuildId)
      .input('rows', mssql.Int, rebuilt)
      .query(
        `UPDATE sms.rebuild_audit SET rows_rebuilt=@rows, outcome='success', finished_at_utc=SYSUTCDATETIME() WHERE rebuild_id=@id`,
      );
    console.log(`rebuilt ${rebuilt} rows (audit #${rebuildId})`);
    return 0;
  } finally {
    await ctx.close();
  }
}
