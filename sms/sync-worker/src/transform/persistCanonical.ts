/**
 * Idempotent canonical persistence. Insert-if-not-exists keyed on raw_id (our
 * own identity — see existingRawIds for why not IFL's source_row_id), so a
 * deterministic transform makes re-runs no-ops. Typed bulk load. Used by
 * cone/sack/reject.
 */
import type { ConnectionPool, ISqlType } from 'mssql';
import mssql from 'mssql';

export interface ColSpec {
  name: string;
  type: (() => ISqlType) | ISqlType;
  nullable?: boolean;
}

/**
 * Which raw rows are ALREADY in canonical, keyed on raw_id.
 *
 * raw_id, not source_row_id. source_row_id is IFL's counter and IFL resets it
 * (2026-08-05: every identity back to 1), so at a generation boundary July's
 * id 5 and September's id 5 are different cones and a source_row_id lookup
 * discards the new one as already-seen — and the transform then advances its
 * watermark past it, so it is never revisited. raw_id is OUR identity: an
 * IDENTITY column, monotone across generations, never reused, and enforced
 * unique on canonical by UX_*_raw_id (migration 026). It also keeps the scan
 * bound meaningful — `source_row_id >= 1` is no bound at all at every epoch
 * boundary, whereas raw_id only ever grows.
 *
 * `sourceSystem` is the rows' configured system code (sms.data_source, roadmap
 * Phase 1) — the probe is scoped to the adapter the batch came through, as it
 * always was, but the value is a bound parameter now rather than the literal
 * 'ifl_sql'.
 */
export async function existingRawIds(
  pool: ConnectionPool,
  table: string,
  sourceSystem: string,
  extraFilter = '',
  minRawId?: number,
): Promise<Set<number>> {
  const req = pool.request().input('sys', mssql.VarChar(20), sourceSystem);
  // Bound the scan to ids the batch could actually collide with. Without this
  // the scan is O(total history) per pass, the same unbounded-growth shape the
  // transform watermark was added to remove.
  let bound = '';
  if (minRawId != null) {
    req.input('minId', mssql.BigInt, minRawId);
    bound = 'AND raw_id >= @minId';
  }
  const r = await req.query<{ raw_id: number }>(
    `SELECT raw_id FROM ${table} WHERE source_system = @sys ${bound} ${extraFilter}`,
  );
  // NB: raw_id is BIGINT — mssql returns it as a STRING. Normalise to Number
  // so the has(Number(...)) lookup in the caller matches (idempotency).
  return new Set(r.recordset.map((x) => Number(x.raw_id)));
}

export async function persistCanonical<T extends { raw_id: number }>(
  pool: ConnectionPool,
  table: string,
  cols: ColSpec[],
  rows: T[],
  opts: { sourceSystem: string; extraExistingFilter?: string; minRawId?: number },
): Promise<{ read: number; written: number }> {
  if (rows.length === 0) return { read: 0, written: 0 };
  const seen = await existingRawIds(pool, table, opts.sourceSystem, opts.extraExistingFilter ?? '', opts.minRawId);
  const fresh = rows.filter((r) => !seen.has(Number(r.raw_id)));
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
  { name: 'source_epoch', type: mssql.Int, nullable: false },
  { name: 'production_ts_utc', type: mssql.DateTime2(3), nullable: false },
  { name: 'production_ts_utc_ms', type: mssql.BigInt, nullable: false },
  { name: 'ingest_ts_utc', type: mssql.DateTime2(3) },
  { name: 'shift_code', type: V(10), nullable: false },
  { name: 'shift_date', type: mssql.Date, nullable: false },
  { name: 'shift_code_legacy', type: V(10) },
  { name: 'night_belongs_to', type: V(15) },
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
  // When SMS read the raw row (its read_at_utc) — real UTC, unlike
  // ingest_ts_utc above, which is IFL's insert time (migration 029).
  { name: 'ingested_at_utc', type: mssql.DateTime2(3) },
  { name: 'ingest_seq', type: mssql.Int, nullable: false },
  { name: 'merge_key_is_unique', type: mssql.Bit, nullable: false },
  { name: 'transform_version', type: mssql.Int, nullable: false },
];

export const SACK_COLS: ColSpec[] = [
  { name: 'line_id', type: mssql.Int, nullable: false },
  { name: 'source_epoch', type: mssql.Int, nullable: false },
  { name: 'production_ts_utc', type: mssql.DateTime2(3), nullable: false },
  { name: 'production_ts_utc_ms', type: mssql.BigInt, nullable: false },
  { name: 'ingest_ts_utc', type: mssql.DateTime2(3) },
  { name: 'production_ts_is_insert_time', type: mssql.Bit, nullable: false },
  { name: 'shift_code', type: V(10), nullable: false },
  { name: 'shift_date', type: mssql.Date, nullable: false },
  { name: 'shift_code_legacy', type: V(10) },
  { name: 'night_belongs_to', type: V(15) },
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
  // When SMS read the raw row (its read_at_utc) — real UTC, unlike
  // ingest_ts_utc above, which is IFL's insert time (migration 029).
  { name: 'ingested_at_utc', type: mssql.DateTime2(3) },
  { name: 'ingest_seq', type: mssql.Int, nullable: false },
  { name: 'merge_key_is_unique', type: mssql.Bit, nullable: false },
  { name: 'transform_version', type: mssql.Int, nullable: false },
];

export const REJECT_COLS: ColSpec[] = [
  { name: 'line_id', type: mssql.Int, nullable: false },
  { name: 'source_epoch', type: mssql.Int, nullable: false },
  { name: 'reject_type', type: V(10), nullable: false },
  { name: 'production_ts_utc', type: mssql.DateTime2(3), nullable: false },
  { name: 'production_ts_utc_ms', type: mssql.BigInt, nullable: false },
  { name: 'ingest_ts_utc', type: mssql.DateTime2(3) },
  { name: 'shift_code', type: V(10), nullable: false },
  { name: 'shift_date', type: mssql.Date, nullable: false },
  { name: 'shift_code_legacy', type: V(10) },
  { name: 'night_belongs_to', type: V(15) },
  { name: 'hanger_num', type: mssql.Int },
  { name: 'source_station', type: mssql.Int },
  { name: 'lifter_station', type: mssql.Int },
  { name: 'tube_inspect_code', type: mssql.Int },
  { name: 'material_inspect_code', type: mssql.Int },
  { name: 'weight_g', type: mssql.Decimal(10, 2) },
  // Added by migration 024: IFL now stamps MaterialId on both reject tables, and
  // a reject rate computed per product needs the key on both sides of the ratio.
  { name: 'material_id', type: mssql.Int },
  // Migration 029: how the material id was resolved, by the same rule as cones.
  { name: 'attribution_method', type: V(30) },
  { name: 'attribution_confidence', type: V(10) },
  { name: 'source_system', type: V(20), nullable: false },
  { name: 'source_row_id', type: mssql.BigInt },
  { name: 'raw_id', type: mssql.BigInt },
  { name: 'ingest_run_id', type: mssql.UniqueIdentifier, nullable: false },
  { name: 'ingested_at_utc', type: mssql.DateTime2(3) },
  { name: 'ingest_seq', type: mssql.Int, nullable: false },
  { name: 'transform_version', type: mssql.Int, nullable: false },
];
