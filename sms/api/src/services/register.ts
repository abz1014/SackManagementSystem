/**
 * Event Register — the drill-down screen. Searchable/filterable list over
 * cone_event / sack_event / reject_event with pagination, sort, single-row
 * detail, and a bounded CSV export. Pure read over existing columns.
 *
 * reject_event is NOT shaped like the other two, and three differences are
 * load-bearing rather than cosmetic:
 *
 *  1. IDENTITY. cone/sack are addressed by source_row_id. On reject_event that
 *     column is NULLABLE and is only unique per reject_type, so it cannot
 *     address a row. Rejects are addressed by reject_event_id (the PK) instead,
 *     which is what makes a reject permalink possible at all.
 *  2. NO in_range COLUMN. Binding the in_range filter against reject_event
 *     would be a SQL error, not an empty result — so the filter is skipped for
 *     rejects rather than silently mis-applied.
 *  3. WEIGHT IS SPARSE. Only weight rejects carry weight_g; quality rejects
 *     (2,900 of 3,146 rows) have none, because rejectQCS1_TP1U2 has no weight
 *     column at source. A weight filter therefore silently excludes every
 *     quality reject, and sorting by weight puts them all together at one end.
 *     Callers are told via `weightSparse` so the UI can say so.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';

export type EventType = 'cone' | 'sack' | 'reject';
export type SortField = 'time' | 'weight';
export type SortDir = 'asc' | 'desc';

export interface RegisterFilters {
  from?: string;
  to?: string;
  shift?: string;
  station?: number; // cone + reject; ignored for sack (no station column)
  inRange?: boolean; // cone + sack only; reject_event has no such column
  rejectType?: 'quality' | 'weight'; // reject only
  wMin?: number;
  wMax?: number;
  tsFrom?: string; // fine-grained deep-link window, ANDed with the day-level from/to
  tsTo?: string;
}

export interface RegisterQuery extends RegisterFilters {
  sort: SortField;
  dir: SortDir;
  page: number;
  pageSize: number;
}

const weightCol = (type: EventType) => (type === 'sack' ? 'weight_kg' : 'weight_g');
/** The column that addresses one row for detail/permalinks. */
export const idCol = (type: EventType) => (type === 'reject' ? 'reject_event_id' : 'source_row_id');
const tableFor = (type: EventType) =>
  type === 'cone' ? 'sms.cone_event' : type === 'sack' ? 'sms.sack_event' : 'sms.reject_event';
const sortCol = (type: EventType, sort: SortField) =>
  sort === 'weight' ? weightCol(type) : 'production_ts_utc';

/**
 * Binds shared filters onto a request and returns the WHERE fragment.
 *
 * `alias` qualifies every column, because the reject query needs a JOIN (to pick
 * up the code label) and therefore an alias, while cone/sack query a bare table.
 * Passed explicitly rather than patched onto the finished SQL afterwards — a
 * regex that prefixes column names in an already-built clause works until
 * someone adds a filter whose name overlaps another token, and then fails
 * somewhere far from the cause.
 */
function bindFilters(
  req: SqlRequest,
  lineId: number,
  type: EventType,
  f: RegisterFilters,
  alias = '',
): string {
  const c = (name: string) => `${alias}${name}`;
  const w: string[] = [`${c('line_id')} = @line`];
  req.input('line', mssql.Int, lineId);
  if (f.from) {
    w.push(`${c('shift_date')} >= @from`);
    req.input('from', mssql.Date, f.from);
  }
  if (f.to) {
    w.push(`${c('shift_date')} <= @to`);
    req.input('to', mssql.Date, f.to);
  }
  if (f.shift) {
    w.push(`${c('shift_code')} = @shift`);
    req.input('shift', mssql.VarChar(10), f.shift);
  }
  // sack_event has no station column; cone and reject both do.
  if (f.station != null && type !== 'sack') {
    w.push(`${c('source_station')} = @station`);
    req.input('station', mssql.Int, f.station);
  }
  // reject_event has no in_range column — binding it would throw, not filter.
  if (f.inRange != null && type !== 'reject') {
    w.push(`${c('in_range')} = @inRange`);
    req.input('inRange', mssql.Bit, f.inRange);
  }
  if (f.rejectType != null && type === 'reject') {
    w.push(`${c('reject_type')} = @rejectType`);
    req.input('rejectType', mssql.VarChar(10), f.rejectType);
  }
  const wcol = c(weightCol(type));
  if (f.wMin != null) {
    w.push(`${wcol} >= @wMin`);
    req.input('wMin', mssql.Decimal(10, 3), f.wMin);
  }
  if (f.wMax != null) {
    w.push(`${wcol} <= @wMax`);
    req.input('wMax', mssql.Decimal(10, 3), f.wMax);
  }
  if (f.tsFrom) {
    w.push(`${c('production_ts_utc')} >= @tsFrom`);
    req.input('tsFrom', mssql.DateTime2(3), new Date(f.tsFrom));
  }
  if (f.tsTo) {
    w.push(`${c('production_ts_utc')} <= @tsTo`);
    req.input('tsTo', mssql.DateTime2(3), new Date(f.tsTo));
  }
  return w.join(' AND ');
}

const CONE_COLS = `source_row_id, production_ts_utc, shift_code, shift_date, shift_code_legacy,
  hanger_num, source_station, lifter_station, weight_g, in_range, cone_id, material_id, lot_code,
  merge_key_is_unique, production_ts_utc_ms`;
const SACK_COLS = `source_row_id, production_ts_utc, shift_code, shift_date, shift_code_legacy,
  sack_num, weight_kg, in_range, material_id, lot_code, merge_key_is_unique,
  production_ts_is_insert_time, production_ts_utc_ms`;
// Aliased to reject_event_id so the client has one stable row identity across
// all three types. LEFT JOIN reject_code so a labelled code shows its meaning
// the moment IFL answers Q10 — until then label is NULL and the raw codes carry
// the information, which is why they are always returned.
const REJECT_COLS = `e.reject_event_id AS source_row_id, e.reject_event_id, e.reject_type,
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.hanger_num, e.source_station, e.lifter_station,
  e.tube_inspect_code, e.material_inspect_code, e.weight_g,
  e.source_row_id AS source_id, e.production_ts_utc_ms, c.label AS reject_label`;
const REJECT_FROM = `sms.reject_event e
  LEFT JOIN sms.reject_code c
    ON c.reject_type = e.reject_type
   AND c.tube_code = e.tube_inspect_code
   AND c.material_code = e.material_inspect_code`;

export interface RegisterPage {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listEvents(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  q: RegisterQuery,
): Promise<RegisterPage> {
  const isReject = type === 'reject';
  const alias = isReject ? 'e.' : '';
  const from = isReject ? REJECT_FROM : tableFor(type);
  const cols = isReject ? REJECT_COLS : type === 'cone' ? CONE_COLS : SACK_COLS;
  const order = `${alias}${sortCol(type, q.sort)} ${q.dir === 'asc' ? 'ASC' : 'DESC'}`;
  const offset = (q.page - 1) * q.pageSize;

  const countReq = pool.request();
  const where = bindFilters(countReq, lineId, type, q, alias);
  const countRes = await countReq.query<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${where}`);
  const total = countRes.recordset[0]?.n ?? 0;

  const rowsReq = pool.request();
  bindFilters(rowsReq, lineId, type, q, alias);
  rowsReq.input('offset', mssql.Int, offset).input('take', mssql.Int, q.pageSize);
  const res = await rowsReq.query<Record<string, unknown>>(
    `SELECT ${cols} FROM ${from} WHERE ${where}
     ORDER BY ${order}
     OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY`,
  );
  return { rows: res.recordset, total, page: q.page, pageSize: q.pageSize };
}

export async function getEventDetail(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  rowId: number,
): Promise<Record<string, unknown> | null> {
  const isReject = type === 'reject';
  const alias = isReject ? 'e.' : '';
  const from = isReject ? REJECT_FROM : tableFor(type);
  // Rejects are addressed by reject_event_id: source_row_id is nullable there and
  // unique only per reject_type, so it cannot identify a row on its own.
  const key = `${alias}${idCol(type)}`;
  const base = isReject ? REJECT_COLS : type === 'cone' ? CONE_COLS : SACK_COLS;
  const cols = `${base}, ${alias}source_system, ${alias}ingest_ts_utc, ${alias}transform_version`;
  const res = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('id', mssql.BigInt, rowId)
    .query<Record<string, unknown>>(
      `SELECT TOP 1 ${cols} FROM ${from} WHERE ${alias}line_id=@line AND ${key}=@id`,
    );
  return res.recordset[0] ?? null;
}

const CSV_ROW_CAP = 20_000;

/** Bounded CSV export honouring the same filters/sort as the list view. */
export async function exportEventsCsv(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  f: RegisterFilters & { sort: SortField; dir: SortDir },
): Promise<{ csv: string; truncated: boolean }> {
  const isReject = type === 'reject';
  const alias = isReject ? 'e.' : '';
  const from = isReject ? REJECT_FROM : tableFor(type);
  const cols = isReject ? REJECT_COLS : type === 'cone' ? CONE_COLS : SACK_COLS;
  const order = `${alias}${sortCol(type, f.sort)} ${f.dir === 'asc' ? 'ASC' : 'DESC'}`;

  const req = pool.request();
  const where = bindFilters(req, lineId, type, f, alias);
  req.input('cap', mssql.Int, CSV_ROW_CAP + 1);
  const res = await req.query<Record<string, unknown>>(
    `SELECT TOP (@cap) ${cols} FROM ${from} WHERE ${where} ORDER BY ${order}`,
  );
  const truncated = res.recordset.length > CSV_ROW_CAP;
  const rows = truncated ? res.recordset.slice(0, CSV_ROW_CAP) : res.recordset;
  if (rows.length === 0) return { csv: '', truncated: false };

  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    // CSV/formula-injection guard: a cell starting with =, +, -, @ or a tab/CR
    // is executed as a formula by Excel/Sheets on open. All current columns
    // are numeric/boolean/timestamp/NULL, but lot_code will hold free text
    // from IFL once Q1 product attribution lands — prefix defensively now
    // rather than waiting for that to become exploitable.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))];
  return { csv: lines.join('\n'), truncated };
}
