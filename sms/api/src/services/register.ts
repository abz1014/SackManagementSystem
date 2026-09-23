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
import type { ConeState } from '@sms/shared';
import { bindStateCase, type StateContext } from './coneState.js';
import { andEpoch, noteOf, resolveGenerationScope, type EventTable, type GenerationNote } from './generation.js';

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
  /**
   * cone + reject: the reading's own product (material_id). Rows from before
   * IFL's 2026-08-05 rebuild carry none and are dropped by this filter — the
   * screen says so from /api/production's `unattributed`.
   */
  product?: number;
  /**
   * cone only: the five-state classification (roadmap Phase 4, 14 Sep 2026).
   * `states` names the states to keep; `classification` is the context the
   * CASE is built from (plausibility window + limit windows), loaded by the
   * route. With a context every cone row also carries a `state` column,
   * whether or not a filter is on. Replaces the `outsideLimitsSegments`
   * filter finding H4 added: "passed by the scale but outside the product's
   * limits" is exactly the 'low' + 'high' population, since the scale's bit
   * governs 'rejected' (shared/src/domain/classification.ts).
   *
   * An empty `states` list matches nothing — never falls back to unfiltered.
   */
  states?: ConeState[];
  classification?: StateContext;
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
  // sack_event is never product-filtered in the register (production.ts
  // makes the same choice), so a sack listing cannot silently shrink under a
  // product filter meant for cones.
  if (f.product != null && type !== 'sack') {
    w.push(`${c('material_id')} = @product`);
    req.input('product', mssql.Int, f.product);
  }
  if (f.states != null && type === 'cone') {
    if (f.states.length === 0 || !f.classification) {
      w.push('1 = 0');
    } else {
      const stateCase = bindStateCase(req, f.classification, alias, 'fs');
      const names = f.states.map((st, i) => {
        req.input(`state${i}`, mssql.VarChar(10), st);
        return `@state${i}`;
      });
      w.push(`(${stateCase}) IN (${names.join(', ')})`);
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
// `product_name` (roadmap Phase 4, 14 Sep 2026): the reading's OWN product
// by name, from the mirror — null for every row from before the column
// existed at source, which is the truth and not a fault.
const PRODUCT_NAME_COL = `COALESCE(p.description, p.lot_code) AS product_name`;
const CONE_COLS = `e.cone_event_id AS event_id, ${IDENTITY_COLS},
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.hanger_num, e.source_station, e.lifter_station, e.weight_g, e.in_range, e.cone_id, e.material_id, e.lot_code,
  e.merge_key_is_unique, e.production_ts_utc_ms, ${PRODUCT_NAME_COL}`;
const SACK_COLS = `e.sack_event_id AS event_id, ${IDENTITY_COLS},
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.sack_num, e.weight_kg, e.in_range, e.material_id, e.lot_code, e.merge_key_is_unique,
  e.production_ts_is_insert_time, e.production_ts_utc_ms`;
// LEFT JOIN reject_code so a labelled code shows its meaning the moment IFL
// answers Q10 — until then label is NULL and the raw codes carry the
// information, which is why they are always returned.
//
// material_id was missing here until 14 Sep 2026 although migration 024 put
// it on reject_event and the transform stamps it: the reject sheet therefore
// had no product of its own to ask about and fell back to the line-wide
// timeline — a retired July material for a September reject.
const REJECT_COLS = `e.reject_event_id AS event_id, ${IDENTITY_COLS}, e.reject_type,
  e.production_ts_utc, e.shift_code, e.shift_date, e.shift_code_legacy,
  e.hanger_num, e.source_station, e.lifter_station,
  e.tube_inspect_code, e.material_inspect_code, e.weight_g, e.material_id,
  e.production_ts_utc_ms, c.label AS reject_label, c.is_pass AS reject_is_pass, ${PRODUCT_NAME_COL}`;
/**
 * Provenance — where a reading came from, on every row (roadmap Phase 3 item
 * 4, 14 Sep 2026). Selected under a `prov_` prefix and folded by
 * foldProvenance() into one `provenance` object on the JSON row, so the
 * twelve lineage columns do not sit loose among the reading's own facts and
 * a screen can render "Where this reading came from" from one field.
 *
 * Every value is the row's own or its epoch's; nothing is looked up
 * elsewhere and nothing is invented:
 *  - `source_table` and `label` come from the epoch row the reading was
 *    ingested under (the join every query already makes). The epoch label
 *    sat on Setup alone until now; since 5 Aug 2026 `source_row_id` names
 *    two rows, and the label beside it is what makes the number meaningful.
 *  - `ingest_ts_utc` is IFL's OWN insert time (their `Date` column — the
 *    naming trap migration 029 documents), surfaced as `sourceInsertUtc`;
 *    `ingested_at_utc` is when SMS read the row, from migration 029.
 *  - `attribution_method` / `attribution_confidence` exist on reject_event
 *    only since migration 029 and are NULL on rejects transformed before the
 *    worker's Phase 3 change. They pass through as null — a null here says
 *    "not recorded", which is the truth, and a fabricated 'none' would not be.
 * Order matters for the CSV: these are its trailing columns, appended after
 * every existing one so no existing column moves.
 */
const PROVENANCE_COLS = `e.source_system AS prov_source_system, ep.source_table AS prov_source_table,
  ep.label AS prov_epoch_label, e.source_row_id AS prov_source_row_id, e.raw_id AS prov_raw_id,
  e.ingest_ts_utc AS prov_source_insert_utc, e.ingested_at_utc AS prov_ingested_at_utc,
  e.ingest_run_id AS prov_ingest_run_id, e.transform_version AS prov_transform_version,
  e.attribution_method AS prov_attribution_method, e.attribution_confidence AS prov_attribution_confidence,
  e.night_belongs_to AS prov_night_belongs_to, e.source_epoch AS prov_epoch_id`;

/** Column alias → JSON key, in the order the CSV's trailing columns take. */
const PROVENANCE_KEYS: readonly [column: string, key: string][] = [
  ['prov_source_system', 'sourceSystem'],
  ['prov_source_table', 'sourceTable'],
  ['prov_epoch_label', 'epochLabel'],
  ['prov_source_row_id', 'sourceRowId'],
  ['prov_raw_id', 'rawId'],
  ['prov_source_insert_utc', 'sourceInsertUtc'],
  ['prov_ingested_at_utc', 'ingestedAtUtc'],
  ['prov_ingest_run_id', 'ingestRunId'],
  ['prov_transform_version', 'transformVersion'],
  ['prov_attribution_method', 'attributionMethod'],
  ['prov_attribution_confidence', 'attributionConfidence'],
  ['prov_night_belongs_to', 'nightBelongsTo'],
  // Appended LAST, 23 Sep 2026, so no existing CSV column moves. The label
  // beside it is what a person reads; the id is what `sms summary --epoch=`
  // and `sms rebuild --epoch=` take, so a row quoted back to an operator can
  // be scoped without a lookup.
  ['prov_epoch_id', 'epochId'],
];

export interface Provenance {
  sourceSystem: string | null;
  sourceTable: string | null;
  epochLabel: string | null;
  sourceRowId: number | string | null;
  rawId: number | string | null;
  sourceInsertUtc: string | null;
  ingestedAtUtc: string | null;
  ingestRunId: string | null;
  transformVersion: number | null;
  attributionMethod: string | null;
  attributionConfidence: string | null;
  nightBelongsTo: string | null;
  /** `sms.source_epoch.epoch_id` this reading was ingested under. */
  epochId: number | null;
}

/**
 * Moves the `prov_*` columns off a recordset row into `row.provenance`.
 * Timestamps become ISO strings here rather than in SQL so the value the
 * screen prints is the same instant express would have serialised anyway,
 * and a missing column (an older fake, a row from before migration 029)
 * folds to null rather than throwing.
 */
export function foldProvenance(row: Record<string, unknown>): Record<string, unknown> {
  const provenance: Record<string, unknown> = {};
  for (const [column, key] of PROVENANCE_KEYS) {
    const v = row[column];
    provenance[key] = v == null ? null : v instanceof Date ? v.toISOString() : v;
    delete row[column];
  }
  row.provenance = provenance as unknown as Provenance;
  return row;
}

const colsFor = (type: EventType) =>
  `${type === 'cone' ? CONE_COLS : type === 'sack' ? SACK_COLS : REJECT_COLS}, ${PROVENANCE_COLS}`;

/**
 * The cone's `state` column (roadmap Phase 4): the one five-state
 * classification, computed in SQL by the CASE coneState.ts builds from the
 * same rule every other consumer uses. Emitted whenever the route supplied a
 * context; a cone listing without one carries no state rather than a guess.
 * It follows the reading's own columns, so the CSV gains one column there
 * and nothing before it moves.
 */
function stateColumn(req: SqlRequest, type: EventType, f: RegisterFilters): string {
  if (type !== 'cone' || !f.classification) return '';
  return `, (${bindStateCase(req, f.classification, ALIAS, 'sc')}) AS state`;
}

// source_epoch is a small, PK-keyed reference table (one row per source table
// per generation), so the join costs a nested-loop seek per row and nothing
// more. LEFT rather than INNER only so a row can never vanish from the
// register because its epoch row was dropped underneath it.
const EPOCH_JOIN = `LEFT JOIN sms.source_epoch ep ON ep.epoch_id = e.source_epoch`;
// sms.product is PK-keyed and a few dozen rows: a seek per row. LEFT so a
// material the mirror has not seen yet still lists, with no name.
const PRODUCT_JOIN = `LEFT JOIN sms.product p ON p.product_id = e.material_id`;
const fromFor = (type: EventType) =>
  type === 'cone'
    ? `sms.cone_event e ${EPOCH_JOIN} ${PRODUCT_JOIN}`
    : type === 'sack'
      ? `sms.sack_event e ${EPOCH_JOIN}`
      : `sms.reject_event e
  LEFT JOIN sms.reject_code c
    ON c.line_id = e.line_id
   AND c.reject_type = e.reject_type
   AND ISNULL(c.tube_code, -999)     = ISNULL(e.tube_inspect_code, -999)
   AND ISNULL(c.material_code, -999) = ISNULL(e.material_inspect_code, -999)
  ${EPOCH_JOIN} ${PRODUCT_JOIN}`;
// `c.line_id = e.line_id` (roadmap Phase 5, 14 Sep 2026): reject codes are
// per line since migration 028 — a second line's scale may use the same pair
// for a different fault — and rejects.ts's Pareto join and the transform's
// seed both match on the line. This join did not, so on the day a second
// line is configured every reject row here would have joined to BOTH lines'
// code rows and listed twice, under the other line's label.
// ISNULL(..., -999) on both sides, as rejects.ts already did: a WEIGHT reject
// carries no inspection codes, so both columns are NULL on the event and on
// its reject_code row, and `NULL = NULL` is never true in SQL. Until 14 Sep
// 2026 the plain equality meant no weight reject ever matched its code row
// in the register, so a label a manager had given the weight-reject code
// showed on the Rejects screen and not on the Readings listing or the sheet.
/** Every query aliases the event table `e` — see bindFilters for why it is explicit. */
const ALIAS = 'e.';

/**
 * WHY THE REGISTER LABELS AND DOES NOT FILTER (23 Sep 2026).
 *
 * Every other consumer of the canonical tables was constrained to ONE source
 * generation in ca34a23/8673ffd, because a mean, a rate or a LAG sequence
 * fitted across IFL's 2026-08-05 rebuild is not a measurement of anything.
 * The register is the one place where that reasoning does not carry: it is a
 * LISTING of individual readings, every row already joins `sms.source_epoch`
 * and carries `provenance.sourceTable` / `provenance.epochLabel`, and a
 * reader who asks for "every reading in this period" and is silently shown
 * one generation's has been lied to more than one who is shown both and told
 * which is which. Filtering here would also break the drill-down hops: a
 * screen's figure links to the rows behind it, and those rows must still be
 * addressable.
 *
 * WHAT WAS NEVERTHELESS WRONG. `total` was a single `COUNT(*)` over both
 * generations with nothing beside it — a pooled figure of exactly the kind
 * `sms summary` stopped printing in 0a0f030, rendered as "N readings" at the
 * top of the page. On the dev sidecar over 2026-08-21 – 2026-09-07 that read
 * 190,306 cones where IFL's own generation holds 55,058, and 8,509 sacks
 * where generation 3 holds 2,310. So the count is now DECOMPOSED rather than
 * filtered: `total` still counts exactly the rows the register lists (it is
 * what pagination is over, and it must stay that), and `generations` says
 * what it is made of. One query does both — the old `COUNT(*)` became a
 * `GROUP BY source_epoch` summed in memory, so this costs no extra round trip
 * and no extra scan.
 *
 * THE CSV EXPORT carries the same breakdown for a different reason. Its rows
 * are individually labelled, so it presents no pooled figure — but its
 * 20,000-row cap is applied to a time-ordered pooled set, so on the range
 * above an export would be 20,000 rows drawn almost entirely from whichever
 * generation sorts first, with the other generation absent and nothing saying
 * so. `truncated` said the list was cut; it could not say a whole generation
 * was.
 */
export interface GenerationTally {
  /** `${sourceDb}#${ordinal}` — one physical generation, as generation.ts keys it. */
  key: string;
  ordinal: number | null;
  sourceDb: string | null;
  label: string | null;
  /** Derived from source_db/provenance, never provenance alone (generation.ts). */
  simulator: boolean;
  /** Rows of this generation matching the register's filters. */
  rows: number;
}

export interface RegisterPage {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * What `total` is made of, newest generation first. One entry means the
   * period holds one generation and `total` is a figure about it. More than
   * one means `total` is a sum across physically distinct source tables and
   * the screen must say so rather than print it bare.
   *
   * OPTIONAL for the same reason `GenerationNote` is (generation.ts):
   * `listEvents` always sets it, and it is declared optional only so that
   * adding it did not break the hand-built `RegisterPage` fakes in files
   * other workers hold open (`services/reports/*.test.ts`). A CONSUMER must
   * read a missing value as "not stated" — never as "one generation".
   */
  generations?: GenerationTally[];
  /**
   * See RegisterDataIssue. Empty on every healthy response — declared
   * OPTIONAL for the same back-compat reason `generations` is: `listEvents`
   * always sets it, and a missing value must read as "not stated", never as
   * "known healthy". WS-R (23 Sep 2026): without this, a tally row with its
   * count column absent silently became `total: NaN`, which
   * `JSON.stringify` serialises as `null` — read by `Sacks.tsx` as a real
   * empty period while `rows` still held real data.
   */
  dataIssues?: RegisterDataIssue[];
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
  const { total, generations, dataIssues } = foldGenerationTally(
    (await countReq.query<TallyRow>(TALLY_SQL(from, where))).recordset,
  );

  const rowsReq = pool.request();
  bindFilters(rowsReq, lineId, type, q, ALIAS);
  const stateCol = stateColumn(rowsReq, type, q);
  rowsReq.input('offset', mssql.Int, offset).input('take', mssql.Int, q.pageSize);
  const res = await rowsReq.query<Record<string, unknown>>(
    `SELECT ${cols}${stateCol} FROM ${from} WHERE ${where}
     ORDER BY ${order}
     OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY`,
  );
  return { rows: res.recordset.map(foldProvenance), total, page: q.page, pageSize: q.pageSize, generations, dataIssues };
}

const tableFor = (type: EventType): EventTable =>
  type === 'cone' ? 'cone_event' : type === 'sack' ? 'sack_event' : 'reject_event';

/**
 * A SECOND defect, found mid-pass (23 Sep 2026) in a different function of
 * this same file: `foldGenerationTally` used a bare `Number(r.n)` and
 * `countEvents` a bare `Number(res.recordset[0]?.n ?? 0)`. A tally/count row
 * that comes back with its `n` column ABSENT — not SQL NULL, the key itself
 * missing, the malformed/truncated-driver-row shape `production.ts` (WS-P,
 * `71757a3`, the same day) already found and fixed elsewhere — turned
 * `Number(undefined)` into `NaN`, which `JSON.stringify` then serialises as
 * `null` (`register.presence.test.ts` asserts this directly). The client
 * (`Sacks.tsx`'s history block: `rows.data?.data.total ?? 0`, then
 * `total === 0 ? <Empty>`) reads that `null` as a real empty period —
 * hiding real rows the LISTING half of the same response still holds.
 *
 * Mirrors `production.ts`'s own `readNum`/`dataIssues` idiom rather than
 * inventing a second one; not imported, because `production.ts` does not
 * export it and this file gains no new dependency for it.
 */
interface ReadResult {
  value: number;
  /** false when the source value was not a finite number — key absent, or malformed. */
  ok: boolean;
}
function readNum(v: unknown): ReadResult {
  return typeof v === 'number' && Number.isFinite(v) ? { value: v, ok: true } : { value: 0, ok: false };
}

/**
 * One entry per numeric field this file could not read as a number from its
 * source row. Always an array, empty on every healthy response — mirrors
 * `production.ts`'s `ProductionDataIssue` exactly (see readNum's own doc for
 * why this shape and not a new one): the affected field still reads as `0`,
 * so the response's SUCCESS SHAPE is unchanged, but a consumer that checks
 * this list can tell a real empty period apart from a malformed row.
 */
export interface RegisterDataIssue {
  /** 'total' — foldGenerationTally's pooled COUNT(*), read by listEvents/exportEventsCsv. 'count' — countEvents' own scoped COUNT(*). */
  field: 'total' | 'count';
  /** The generation key (GenerationTally.key) the malformed row belonged to; null for countEvents, which reads exactly one row. */
  generation: string | null;
  reason: string;
}

export interface EventCount {
  /** Rows matching the filters, within the ONE generation resolveGenerationScope chose for (lineId, from, to). Never a pooled figure. */
  count: number;
  /** Which generation `count` describes, and what (if anything) was excluded — same shape every other scoped report already returns. */
  note: GenerationNote;
  /** See RegisterDataIssue. Empty on every healthy response. */
  dataIssues: RegisterDataIssue[];
}

/**
 * WHY THIS EXISTS BESIDE listEvents (23 Sep 2026, RT-002/RT-029 follow-up).
 *
 * `listEvents`' `total` is deliberately pooled — see "WHY THE REGISTER LABELS
 * AND DOES NOT FILTER" above — because a LISTING must never silently drop a
 * generation's rows. A bare FIGURE has the opposite obligation: `total` read
 * on its own, the way `reports/sack.ts` and `reports/summary.ts` both did
 * until this pass, is exactly the kind of pooled count `sms summary` stopped
 * printing in 0a0f030 (RT-002: 411 pooled vs 14 real on the register's own
 * scale-rejected count, a ~29x inflation). `reports/daily.ts` hit the same
 * defect and, not owning this file, worked around it with a private COUNT
 * query of its own (23 Sep 2026) — this is the fix that query should have
 * been able to call instead.
 *
 * THE DESIGN CHOICE. Rather than give `listEvents` an optional scope
 * parameter, a caller after the LISTING could pass it by accident (a copy-
 * pasted call site, a refactor that hoists a scope up a call chain) and
 * silently start dropping rows from the one screen that must never do that.
 * A count that needs scoping instead gets its OWN function, with its OWN
 * query — nothing named `total` or `count` is reachable through `listEvents`
 * without also getting every row back, so a caller who only wants a figure
 * has no path that both pools and looks correct.
 *
 * Resolves its OWN scope via `resolveGenerationScope`, keyed on
 * `(lineId, from, to)` the same way every other report-owned scope call is —
 * so it agrees with whatever else on the same screen scoped the same window,
 * with no scope threaded in from the caller and no shared signature touched.
 */
export async function countEvents(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  f: RegisterFilters,
): Promise<EventCount> {
  const table = tableFor(type);
  const scope = await resolveGenerationScope(pool, lineId, { from: f.from, to: f.to }, [table]);
  const req = pool.request();
  const where0 = bindFilters(req, lineId, type, f, ALIAS);
  const where = andEpoch(where0, req, scope, table);
  const res = await req.query<{ n: number }>(`SELECT COUNT(*) n FROM ${fromFor(type)} WHERE ${where}`);
  const n = readNum(res.recordset[0]?.n);
  const dataIssues: RegisterDataIssue[] = n.ok
    ? []
    : [{ field: 'count', generation: scope.generation?.key ?? null, reason: 'countEvents aggregate row is missing its count (n)' }];
  return { count: n.value, note: noteOf(scope), dataIssues };
}

interface TallyRow {
  epoch_id: number | null;
  source_db: string | null;
  generation_ordinal: number | null;
  provenance: string | null;
  label: string | null;
  n: number;
}

/**
 * The count, grouped by generation, over exactly the register's own FROM and
 * WHERE — `fromFor` already LEFT JOINs `sms.source_epoch ep`, so this is the
 * same scan `COUNT(*)` was, with a grouping on a column already in hand.
 */
const TALLY_SQL = (from: string, where: string): string =>
  `SELECT ${ALIAS}source_epoch AS epoch_id, ep.source_db, ep.generation_ordinal,
          ep.provenance, ep.label, COUNT(*) n
     FROM ${from} WHERE ${where}
    GROUP BY ${ALIAS}source_epoch, ep.source_db, ep.generation_ordinal, ep.provenance, ep.label`;

/**
 * Epoch rows → generations. Pure and exported so the folding is tested
 * without SQL. Keyed on (source_db, generation_ordinal) and NOT on epoch_id,
 * for the reason generation.ts gives: one physical generation of the plant's
 * tables owns one `sms.source_epoch` row PER SOURCE TABLE, and `reject_event`
 * is fed by two of them (11 and 12 on this sidecar). Keying on the id would
 * report one reject listing as two generations.
 *
 * An epoch with no `sms.source_epoch` row, or one carrying no ordinal, gets
 * its own entry labelled as unregistered rather than being merged into a
 * neighbour — the same choice `sms summary` made in 0a0f030, and for the same
 * reason: epoch 13 on this sidecar is mis-registered and must stay visible.
 */
export function foldGenerationTally(rows: readonly TallyRow[]): {
  total: number;
  generations: GenerationTally[];
  /** epoch_id → generation key, so a row can be attributed without a second query. */
  keyOfEpoch: Map<number, string>;
  /** See RegisterDataIssue. Empty on every healthy tally. */
  dataIssues: RegisterDataIssue[];
} {
  const by = new Map<string, GenerationTally>();
  const keyOfEpoch = new Map<number, string>();
  const dataIssues: RegisterDataIssue[] = [];
  let total = 0;
  for (const r of rows) {
    const ordinal = r.generation_ordinal == null ? null : Number(r.generation_ordinal);
    const key = ordinal == null ? `epoch:${r.epoch_id ?? 'none'}` : `${r.source_db ?? ''}#${ordinal}`;
    if (r.epoch_id != null) keyOfEpoch.set(Number(r.epoch_id), key);
    // WS-R (23 Sep 2026): `n` read defensively — see readNum's own doc for
    // why a missing column must not become a silent, wire-serialisable NaN.
    const n = readNum(r.n);
    if (!n.ok) dataIssues.push({ field: 'total', generation: key, reason: 'tally row is missing its count (n)' });
    total += n.value;
    const cur = by.get(key);
    if (cur) {
      cur.rows += n.value;
      continue;
    }
    by.set(key, {
      key,
      ordinal,
      sourceDb: r.source_db,
      label: ordinal == null ? (r.label ?? 'unregistered source generation') : r.label,
      // Same test as generation.ts: source_db ending _SIM OR a provenance that
      // says so. Provenance alone is not trusted — epochs 13-16 are the
      // simulator's tables recorded as IFL's own and are left standing.
      simulator: r.provenance === 'simulator' || /_SIM$/i.test(r.source_db ?? ''),
      rows: n.value,
    });
  }
  // Newest generation first; unordinalled entries last, so the figure a reader
  // sees at the top is the one their period is mostly about.
  const generations = [...by.values()].sort(
    (a, b) => (b.ordinal ?? -1) - (a.ordinal ?? -1) || b.rows - a.rows,
  );
  return { total, generations, keyOfEpoch, dataIssues };
}

export async function getEventDetail(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  rowId: number,
  /** With it, a cone's row carries its `state` (roadmap Phase 4). */
  classification?: StateContext,
): Promise<Record<string, unknown> | null> {
  const from = fromFor(type);
  // Addressed by the canonical PK on every type (idCol). For cone and sack
  // that is what makes this lookup deterministic at all: source_row_id
  // repeats across epochs, and TOP 1 with no ORDER BY over that non-unique
  // index answered with whichever generation the seek met first.
  const key = `${ALIAS}${idCol(type)}`;
  // The three loose lineage columns predate `provenance` (which now carries
  // them and nine more); kept so nothing that read them flat breaks.
  const cols = `${colsFor(type)}, ${ALIAS}source_system, ${ALIAS}ingest_ts_utc, ${ALIAS}transform_version`;
  const req = pool.request().input('line', mssql.Int, lineId).input('id', mssql.BigInt, rowId);
  const stateCol = stateColumn(req, type, { classification });
  const res = await req.query<Record<string, unknown>>(
    `SELECT TOP 1 ${cols}${stateCol} FROM ${from} WHERE ${ALIAS}line_id=@line AND ${key}=@id`,
  );
  const row = res.recordset[0];
  return row ? foldProvenance(row) : null;
}

const CSV_ROW_CAP = 20_000;

/** Bounded CSV export honouring the same filters/sort as the list view. */
export async function exportEventsCsv(
  pool: ConnectionPool,
  lineId: number,
  type: EventType,
  f: RegisterFilters & { sort: SortField; dir: SortDir },
): Promise<{ csv: string; truncated: boolean; generations: GenerationTally[]; exported: GenerationTally[] }> {
  const from = fromFor(type);
  const cols = colsFor(type);
  const order = `${ALIAS}${sortCol(type, f.sort)} ${f.dir === 'asc' ? 'ASC' : 'DESC'}`;

  // What the filters MATCH, per generation — against which the caller can
  // compare what the cap actually let through. See the RegisterPage header.
  const tallyReq = pool.request();
  const tallyWhere = bindFilters(tallyReq, lineId, type, f, ALIAS);
  const { generations, keyOfEpoch } = foldGenerationTally(
    (await tallyReq.query<TallyRow>(TALLY_SQL(from, tallyWhere))).recordset,
  );

  const req = pool.request();
  const where = bindFilters(req, lineId, type, f, ALIAS);
  const stateCol = stateColumn(req, type, f);
  req.input('cap', mssql.Int, CSV_ROW_CAP + 1);
  const res = await req.query<Record<string, unknown>>(
    `SELECT TOP (@cap) ${cols}${stateCol} FROM ${from} WHERE ${where} ORDER BY ${order}`,
  );
  const truncated = res.recordset.length > CSV_ROW_CAP;
  const rows = (truncated ? res.recordset.slice(0, CSV_ROW_CAP) : res.recordset).map(foldProvenance);

  // What the cap actually let through, per generation — attributed from each
  // row's own epoch id, not inferred from the order. A generation present in
  // `generations` and absent from `exported` was cut entirely; that is the
  // fact `truncated` alone could never state.
  const exported = countExported(rows, generations, keyOfEpoch);
  if (rows.length === 0) return { csv: '', truncated: false, generations, exported };

  // The reading's own columns first, exactly as before; the provenance
  // fields follow as trailing columns named by their JSON path
  // (`provenance.epochLabel`), so a sheet built on the old layout still
  // finds every column where it was and the new ones are unmistakably one
  // group. `provenance` itself is an object and is never emitted as a cell.
  const ownHeaders = Object.keys(rows[0]!).filter((h) => h !== 'provenance');
  const provHeaders = PROVENANCE_KEYS.map(([, key]) => `provenance.${key}`);
  const headers = [...ownHeaders, ...provHeaders];
  const cell = (r: Record<string, unknown>, h: string): unknown =>
    h.startsWith('provenance.') ? (r.provenance as Record<string, unknown>)[h.slice('provenance.'.length)] : r[h];
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
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(cell(r, h))).join(','))];
  return { csv: lines.join('\n'), truncated, generations, exported };
}

/**
 * The generations the exported rows actually contain, with their counts —
 * same shape and order as the matched tally so the two can be read side by
 * side. Pure and exported for the test. A generation that the filters matched
 * but the cap excluded is simply absent here, which is the point.
 */
export function countExported(
  rows: readonly Record<string, unknown>[],
  generations: readonly GenerationTally[],
  keyOfEpoch: ReadonlyMap<number, string>,
): GenerationTally[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const id = (r.provenance as Provenance | undefined)?.epochId;
    const key = id == null ? undefined : keyOfEpoch.get(Number(id));
    if (key === undefined) continue;
    n.set(key, (n.get(key) ?? 0) + 1);
  }
  return generations.filter((g) => n.has(g.key)).map((g) => ({ ...g, rows: n.get(g.key)! }));
}
