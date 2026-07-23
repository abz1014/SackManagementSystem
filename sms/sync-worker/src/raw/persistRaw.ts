/**
 * Idempotent verbatim insert into sms_raw.* (ARCHITECTURE §3).
 * Raw is append-only: rows already present (by line_id, src_id) are skipped,
 * so the overlap re-read window (§7) is absorbed with no duplicates.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { IflTableDef, ColType } from '../reader/iflTables.js';
import type { RawRecord } from '../reader/IflSqlAdapter.js';

function mssqlType(t: ColType) {
  switch (t) {
    case 'int':
      return mssql.Int;
    case 'datetime':
      return mssql.DateTime;
    case 'varchar':
      return mssql.VarChar(50);
    case 'decimal':
      return mssql.Decimal(18, 6);
    case 'bit':
      return mssql.Bit;
  }
}

export interface PersistResult {
  read: number;
  written: number;
}

export async function persistRaw(
  pool: ConnectionPool,
  def: IflTableDef,
  lineId: number,
  ingestRunId: string,
  records: RawRecord[],
): Promise<PersistResult> {
  if (records.length === 0) return { read: 0, written: 0 };

  // ids present in this batch's range → skip already-stored rows (idempotency).
  // NB: reduce, not Math.min(...ids) — spreading 100k+ ids overflows the stack.
  let minId = Number.POSITIVE_INFINITY;
  let maxId = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    const id = Number(r.src_id);
    if (id < minId) minId = id;
    if (id > maxId) maxId = id;
  }
  const existing = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('lo', mssql.Int, minId)
    .input('hi', mssql.Int, maxId)
    .query<{ src_id: number }>(
      `SELECT src_id FROM ${def.rawTable}
       WHERE line_id = @line AND src_id BETWEEN @lo AND @hi`,
    );
  const seen = new Set(existing.recordset.map((r) => r.src_id));
  const fresh = records.filter((r) => !seen.has(Number(r.src_id)));
  if (fresh.length === 0) return { read: records.length, written: 0 };

  // typed bulk load of the new rows
  const table = new mssql.Table(def.rawTable);
  table.create = false;
  table.columns.add('line_id', mssql.Int, { nullable: false });
  table.columns.add('ingest_run_id', mssql.UniqueIdentifier, { nullable: false });
  for (const c of def.columns) {
    table.columns.add(c.raw, mssqlType(c.type), { nullable: c.raw !== 'src_id' });
  }
  type BulkVal = string | number | boolean | Date | Buffer | null;
  for (const rec of fresh) {
    const vals: BulkVal[] = [lineId, ingestRunId];
    for (const c of def.columns) vals.push((rec[c.raw] as BulkVal) ?? null);
    table.rows.add(...vals);
  }
  await pool.request().bulk(table);
  return { read: records.length, written: fresh.length };
}
