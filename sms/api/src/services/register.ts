/**
 * Sack & Cone Register — the drill-down screen. Searchable/filterable list
 * over cone_event / sack_event with pagination, sort, single-row detail, and
 * a bounded CSV export. Pure read over existing columns; no new computation.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';

export type EventType = 'cone' | 'sack';
export type SortField = 'time' | 'weight';
export type SortDir = 'asc' | 'desc';

export interface RegisterFilters {
  from?: string;
  to?: string;
  shift?: string;
  station?: number; // cone only — ignored for sack (no station column)
  inRange?: boolean;
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

const weightCol = (type: EventType) => (type === 'cone' ? 'weight_g' : 'weight_kg');
const sortCol = (type: EventType, sort: SortField) =>
  sort === 'weight' ? weightCol(type) : 'production_ts_utc';

/** Binds shared filters onto a request; returns the WHERE clause fragment. */
function bindFilters(req: SqlRequest, lineId: number, type: EventType, f: RegisterFilters): string {
  const w: string[] = ['line_id = @line'];
  req.input('line', mssql.Int, lineId);
  if (f.from) {
    w.push('shift_date >= @from');
    req.input('from', mssql.Date, f.from);
  }
  if (f.to) {
    w.push('shift_date <= @to');
    req.input('to', mssql.Date, f.to);
  }
  if (f.shift) {
    w.push('shift_code = @shift');
    req.input('shift', mssql.VarChar(10), f.shift);
  }
  if (f.station != null && type === 'cone') {
    w.push('source_station = @station');
    req.input('station', mssql.Int, f.station);
  }
  if (f.inRange != null) {
    w.push('in_range = @inRange');
    req.input('inRange', mssql.Bit, f.inRange);
  }
  const col = weightCol(type);
  if (f.wMin != null) {
    w.push(`${col} >= @wMin`);
    req.input('wMin', mssql.Decimal(10, 3), f.wMin);
  }
  if (f.wMax != null) {
    w.push(`${col} <= @wMax`);
    req.input('wMax', mssql.Decimal(10, 3), f.wMax);
  }
  if (f.tsFrom) {
    w.push('production_ts_utc >= @tsFrom');
    req.input('tsFrom', mssql.DateTime2(3), new Date(f.tsFrom));
  }
  if (f.tsTo) {
    w.push('production_ts_utc <= @tsTo');
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
  const table = type === 'cone' ? 'sms.cone_event' : 'sms.sack_event';
  const cols = type === 'cone' ? CONE_COLS : SACK_COLS;
  const order = `${sortCol(type, q.sort)} ${q.dir === 'asc' ? 'ASC' : 'DESC'}`;
  const offset = (q.page - 1) * q.pageSize;

  const countReq = pool.request();
  const where = bindFilters(countReq, lineId, type, q);
  const countRes = await countReq.query<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`);
  const total = countRes.recordset[0]?.n ?? 0;

  const rowsReq = pool.request();
  bindFilters(rowsReq, lineId, type, q);
  rowsReq.input('offset', mssql.Int, offset).input('take', mssql.Int, q.pageSize);
  const res = await rowsReq.query<Record<string, unknown>>(
    `SELECT ${cols} FROM ${table} WHERE ${where}
     ORDER BY ${order}
     OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY`,
  );
  return { rows: res.recordset, total, page: q.page, pageSize: q.pageSize };
}

export async function getEventDetail(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  sourceRowId: number,
): Promise<Record<string, unknown> | null> {
  const table = type === 'cone' ? 'sms.cone_event' : 'sms.sack_event';
  const cols =
    type === 'cone'
      ? `${CONE_COLS}, source_system, ingest_ts_utc, transform_version`
      : `${SACK_COLS}, source_system, ingest_ts_utc, transform_version`;
  const res = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('id', mssql.BigInt, sourceRowId)
    .query<Record<string, unknown>>(
      `SELECT TOP 1 ${cols} FROM ${table} WHERE line_id=@line AND source_row_id=@id`,
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
  const table = type === 'cone' ? 'sms.cone_event' : 'sms.sack_event';
  const cols = type === 'cone' ? CONE_COLS : SACK_COLS;
  const order = `${sortCol(type, f.sort)} ${f.dir === 'asc' ? 'ASC' : 'DESC'}`;

  const req = pool.request();
  const where = bindFilters(req, lineId, type, f);
  req.input('cap', mssql.Int, CSV_ROW_CAP + 1);
  const res = await req.query<Record<string, unknown>>(
    `SELECT TOP (@cap) ${cols} FROM ${table} WHERE ${where} ORDER BY ${order}`,
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
