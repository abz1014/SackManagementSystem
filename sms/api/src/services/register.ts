/**
 * Event Register — the drill-down screen. Searchable/filterable list over
 * cone_event / sack_event / reject_event with pagination, sort, single-row
 * detail, and a bounded CSV export. Pure read over existing columns.
 *
 * IDENTITY. Every type is addressed by its canonical PK — cone_event_id /
 * sack_event_id / reject_event_id — surfaced to the client under one name,
 * `event_id`, so the permalink, the list row key and the CSV row id are the
 * same number everywhere. Cone and sack used to be addressed by source_row_id.
 * That stopped identifying a row on 2026-08-05, when IFL dropped and recreated
 * the wide tables and every identity restarted at 1: July's id 5 and
 * September's id 5 are different physical cones nine weeks apart, told apart
 * only by `source_epoch` (SEPT-2026-EPOCH-DECISION §4.2). A `TOP 1 … WHERE
 * source_row_id=@id` with no ORDER BY over a non-unique index returned
 * whichever generation the seek met first. source_row_id is still RETURNED,
 * with its epoch's label beside it, because it is the number IFL's own
 * engineers quote against the plant's tables — but it is a display column,
 * never an address. On reject_event it never could address a row: NULLABLE,
 * and unique only per reject_type.
 *
 * reject_event is otherwise NOT shaped like the other two, and two more
 * differences are load-bearing rather than cosmetic:
 *
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

/**
 * One stretch of the product timeline with usable limits — the caller (the
 * `/api/events` route) resolves these via productAt.ts's ProductTimeline
 * before calling in here, because limits vary by WHEN a cone was weighed and
 * this module has no DB access of its own for that lookup.
 */
export interface OutsideLimitsSegment {
  fromMs: number | null;
  toMs: number | null;
  loG: number;
  hiG: number;
}

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
  /**
   * cone only: restrict to cones the scale PASSED but a product's own limits
   * would not — the specific population Weight's disagreement banner and the
   * Home attention list's "outside product limits" finding both promise and,
   * until finding H4 (Sep 2026 audit), both actually opened an unfiltered
   * register instead of this. An empty array means no product in the window
   * ever carried usable limits, and must match nothing, not fall back to
   * unfiltered — that would silently show cones from before the register
   * even existed.
   */
  outsideLimitsSegments?: OutsideLimitsSegment[];
}

export interface RegisterQuery extends RegisterFilters {
  sort: SortField;
  dir: SortDir;
  page: number;
  pageSize: number;
}

const weightCol = (type: EventType) => (type === 'sack' ? 'weight_kg' : 'weight_g');
/**
 * The column that addresses one row for detail/permalinks: the canonical PK,
 * never source_row_id — see IDENTITY in the header for why that distinction
 * is the whole point of this function.
 */
export const idCol = (type: EventType) =>
  type === 'cone' ? 'cone_event_id' : type === 'sack' ? 'sack_event_id' : 'reject_event_id';
const sortCol = (type: EventType, sort: SortField) =>
  sort === 'weight' ? weightCol(type) : 'production_ts_utc';

/**
 * Binds shared filters onto a request and returns the WHERE fragment.
 *
 * `alias` qualifies every column, because every query JOINs (all three to
 * source_epoch for the label, rejects to reject_code as well) and so needs one.
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
  if (f.outsideLimitsSegments != null && type === 'cone') {
    if (f.outsideLimitsSegments.length === 0) {
      w.push('1 = 0');
    } else {
      const segs = f.outsideLimitsSegments.map((seg, i) => {
        const parts = [`${c('in_range')} = 1`, `(${c('weight_g')} < @segLo${i} OR ${c('weight_g')} > @segHi${i})`];
        req.input(`segLo${i}`, mssql.Float, seg.loG);
        req.input(`segHi${i}`, mssql.Float, seg.hiG);
        if (seg.fromMs != null) {
          parts.push(`${c('production_ts_utc_ms')} >= @segFrom${i}`);
          req.input(`segFrom${i}`, mssql.BigInt, seg.fromMs);
        }
        if (seg.toMs != null) {
          parts.push(`${c('production_ts_utc_ms')} < @segTo${i}`);
          req.input(`segTo${i}`, mssql.BigInt, seg.toMs);
        }
        return `(${parts.join(' AND ')})`;
      });
      w.push(`(${segs.join(' OR ')})`);
    }
  }
  return w.join(' AND ');
}

// Every column list opens with the same three facts in the same order: the
// canonical PK as `event_id` (the one row identity the client uses for
// everything), then IFL's own source_row_id with the label of the epoch it
// belongs to. The pair is what an engineer quotes when checking a reading
// against the plant's tables; since the 2026-08-05 rebuild the number alone
// names two rows. The event table is always aliased `e`, the epoch `ep`.
const IDENTITY_COLS = `e.source_row_id, e.source_epoch, ep.label AS source_epoch_label`;
const CONE_COLS = `e.cone_event_id AS event_id, ${IDENTITY_COLS},
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.hanger_num, e.source_station, e.lifter_station, e.weight_g, e.in_range, e.cone_id, e.material_id, e.lot_code,
  e.merge_key_is_unique, e.production_ts_utc_ms`;
const SACK_COLS = `e.sack_event_id AS event_id, ${IDENTITY_COLS},
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.sack_num, e.weight_kg, e.in_range, e.material_id, e.lot_code, e.merge_key_is_unique,
  e.production_ts_is_insert_time, e.production_ts_utc_ms`;
// LEFT JOIN reject_code so a labelled code shows its meaning the moment IFL
// answers Q10 — until then label is NULL and the raw codes carry the
// information, which is why they are always returned.
const REJECT_COLS = `e.reject_event_id AS event_id, ${IDENTITY_COLS}, e.reject_type,
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.hanger_num, e.source_station, e.lifter_station,
  e.tube_inspect_code, e.material_inspect_code, e.weight_g,
  e.production_ts_utc_ms, c.label AS reject_label`;
const colsFor = (type: EventType) =>
  type === 'cone' ? CONE_COLS : type === 'sack' ? SACK_COLS : REJECT_COLS;

// source_epoch is a small, PK-keyed reference table (one row per source table
// per generation), so the join costs a nested-loop seek per row and nothing
// more. LEFT rather than INNER only so a row can never vanish from the
// register because its epoch row was dropped underneath it.
const EPOCH_JOIN = `LEFT JOIN sms.source_epoch ep ON ep.epoch_id = e.source_epoch`;
const fromFor = (type: EventType) =>
  type === 'cone'
    ? `sms.cone_event e ${EPOCH_JOIN}`
    : type === 'sack'
      ? `sms.sack_event e ${EPOCH_JOIN}`
      : `sms.reject_event e
  LEFT JOIN sms.reject_code c
    ON c.reject_type = e.reject_type
   AND c.tube_code = e.tube_inspect_code
   AND c.material_code = e.material_inspect_code
  ${EPOCH_JOIN}`;
/** Every query aliases the event table `e` — see bindFilters for why it is explicit. */
const ALIAS = 'e.';

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
  const from = fromFor(type);
  const cols = colsFor(type);
  const order = `${ALIAS}${sortCol(type, q.sort)} ${q.dir === 'asc' ? 'ASC' : 'DESC'}`;
  const offset = (q.page - 1) * q.pageSize;

  const countReq = pool.request();
  const where = bindFilters(countReq, lineId, type, q, ALIAS);
  const countRes = await countReq.query<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${where}`);
  const total = countRes.recordset[0]?.n ?? 0;

  const rowsReq = pool.request();
  bindFilters(rowsReq, lineId, type, q, ALIAS);
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
  const from = fromFor(type);
  // Addressed by the canonical PK on every type (idCol). For cone and sack
  // that is what makes this lookup deterministic at all: source_row_id
  // repeats across epochs, and TOP 1 with no ORDER BY over that non-unique
  // index answered with whichever generation the seek met first.
  const key = `${ALIAS}${idCol(type)}`;
  const cols = `${colsFor(type)}, ${ALIAS}source_system, ${ALIAS}ingest_ts_utc, ${ALIAS}transform_version`;
  const res = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('id', mssql.BigInt, rowId)
    .query<Record<string, unknown>>(
      `SELECT TOP 1 ${cols} FROM ${from} WHERE ${ALIAS}line_id=@line AND ${key}=@id`,
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
  const from = fromFor(type);
  const cols = colsFor(type);
  const order = `${ALIAS}${sortCol(type, f.sort)} ${f.dir === 'asc' ? 'ASC' : 'DESC'}`;

  const req = pool.request();
  const where = bindFilters(req, lineId, type, f, ALIAS);
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
