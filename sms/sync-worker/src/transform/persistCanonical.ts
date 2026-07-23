/**
 * Idempotent canonical persistence. Insert-if-not-exists keyed on
 * (source_system, source_row_id) — deterministic transform means re-runs are
 * no-ops. Typed bulk load. Used by cone/sack/reject.
 */
import type { ConnectionPool, ISqlType } from 'mssql';
import mssql from 'mssql';

export interface ColSpec {
  name: string;
  type: (() => ISqlType) | ISqlType;
  nullable?: boolean;
}

async function existingSourceIds(
  pool: ConnectionPool,
  table: string,
  extraFilter = '',
): Promise<Set<number>> {
  const r = await pool
    .request()
    .query<{ source_row_id: number }>(
      `SELECT source_row_id FROM ${table} WHERE source_system = 'ifl_sql' ${extraFilter}`,
    );
  // NB: source_row_id is BIGINT — mssql returns it as a STRING. Normalise to
  // Number so the has(Number(...)) lookup in the caller matches (idempotency).
  return new Set(r.recordset.map((x) => Number(x.source_row_id)));
}

export async function persistCanonical<T extends { source_row_id: number }>(
  pool: ConnectionPool,
  table: string,
  cols: ColSpec[],
  rows: T[],
  opts: { extraExistingFilter?: string } = {},
): Promise<{ read: number; written: number }> {
  if (rows.length === 0) return { read: 0, written: 0 };
  const seen = await existingSourceIds(pool, table, opts.extraExistingFilter ?? '');
  const fresh = rows.filter((r) => !seen.has(Number(r.source_row_id)));
  if (fresh.length === 0) return { read: rows.length, written: 0 };

  const tvp = new mssql.Table(table);
  tvp.create = false;
  for (const c of cols) {
    tvp.columns.add(c.name, c.type as ISqlType, { nullable: c.nullable ?? true });
  }
  for (const row of fresh) {
    const r = row as Record<string, unknown>;
    tvp.rows.add(...cols.map((c) => (r[c.name] ?? null) as never));
  }
  await pool.request().bulk(tvp);
  return { read: rows.length, written: fresh.length };
}

// column specs mirror the migrations (identity columns excluded) -------------
const V = mssql.VarChar;
const NV = mssql.NVarChar;

export const CONE_COLS: ColSpec[] = [
  { name: 'line_id', type: mssql.Int, nullable: false },
  { name: 'production_ts_utc', type: mssql.DateTime2(3), nullable: false },
  { name: 'production_ts_utc_ms', type: mssql.BigInt, nullable: false },
  { name: 'ingest_ts_utc', type: mssql.DateTime2(3) },
  { name: 'shift_code', type: V(10), nullable: false },
  { name: 'shift_date', type: mssql.Date, nullable: false },
  { name: 'shift_code_legacy', type: V(10) },
  { name: 'hanger_num', type: mssql.Int },
  { name: 'source_station', type: mssql.Int },
  { name: 'lifter_station', type: mssql.Int },
  { name: 'weight_g', type: mssql.Decimal(10, 2) },
  { name: 'in_range', type: mssql.Bit },
  { name: 'cone_id', type: NV(64) },
  { name: 'cone_id_source', type: V(20) },
  { name: 'material_id', type: mssql.Int },
  { name: 'lot_code', type: NV(64) },
  { name: 'attribution_method', type: V(30) },
  { name: 'attribution_confidence', type: V(10) },
  { name: 'source_system', type: V(20), nullable: false },
  { name: 'source_row_id', type: mssql.BigInt },
  { name: 'raw_id', type: mssql.BigInt },
  { name: 'ingest_run_id', type: mssql.UniqueIdentifier, nullable: false },
  { name: 'ingest_seq', type: mssql.Int, nullable: false },
  { name: 'merge_key_is_unique', type: mssql.Bit, nullable: false },
  { name: 'transform_version', type: mssql.Int, nullable: false },
];

export const SACK_COLS: ColSpec[] = [
  { name: 'line_id', type: mssql.Int, nullable: false },
  { name: 'production_ts_utc', type: mssql.DateTime2(3), nullable: false },
  { name: 'production_ts_utc_ms', type: mssql.BigInt, nullable: false },
  { name: 'ingest_ts_utc', type: mssql.DateTime2(3) },
  { name: 'production_ts_is_insert_time', type: mssql.Bit, nullable: false },
  { name: 'shift_code', type: V(10), nullable: false },
  { name: 'shift_date', type: mssql.Date, nullable: false },
  { name: 'shift_code_legacy', type: V(10) },
  { name: 'sack_num', type: mssql.Int },
  { name: 'weight_kg', type: mssql.Decimal(10, 3) },
  { name: 'in_range', type: mssql.Bit },
  { name: 'material_id', type: mssql.Int },
  { name: 'lot_code', type: NV(64) },
  { name: 'attribution_method', type: V(30) },
  { name: 'attribution_confidence', type: V(10) },
  { name: 'source_system', type: V(20), nullable: false },
  { name: 'source_row_id', type: mssql.BigInt },
  { name: 'raw_id', type: mssql.BigInt },
  { name: 'ingest_run_id', type: mssql.UniqueIdentifier, nullable: false },
  { name: 'ingest_seq', type: mssql.Int, nullable: false },
  { name: 'merge_key_is_unique', type: mssql.Bit, nullable: false },
  { name: 'transform_version', type: mssql.Int, nullable: false },
];

export const REJECT_COLS: ColSpec[] = [
  { name: 'line_id', type: mssql.Int, nullable: false },
  { name: 'reject_type', type: V(10), nullable: false },
  { name: 'production_ts_utc', type: mssql.DateTime2(3), nullable: false },
  { name: 'production_ts_utc_ms', type: mssql.BigInt, nullable: false },
  { name: 'ingest_ts_utc', type: mssql.DateTime2(3) },
  { name: 'shift_code', type: V(10), nullable: false },
  { name: 'shift_date', type: mssql.Date, nullable: false },
  { name: 'shift_code_legacy', type: V(10) },
  { name: 'hanger_num', type: mssql.Int },
  { name: 'source_station', type: mssql.Int },
  { name: 'lifter_station', type: mssql.Int },
  { name: 'tube_inspect_code', type: mssql.Int },
  { name: 'material_inspect_code', type: mssql.Int },
  { name: 'weight_g', type: mssql.Decimal(10, 2) },
  { name: 'source_system', type: V(20), nullable: false },
  { name: 'source_row_id', type: mssql.BigInt },
  { name: 'raw_id', type: mssql.BigInt },
  { name: 'ingest_run_id', type: mssql.UniqueIdentifier, nullable: false },
  { name: 'ingest_seq', type: mssql.Int, nullable: false },
  { name: 'transform_version', type: mssql.Int, nullable: false },
];
