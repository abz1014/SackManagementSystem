/**
 * Reject analysis (Q10). Pareto of reject reasons using the RAW codes, joined
 * to the reject_code lookup for labels (NULL until IFL provides the code list).
 * Total counts/trend work now; only the reason *labels* wait on Q10.
 *
 * FILTERS (roadmap Phase 5, 14 Sep 2026). The gap analysis found the Pareto
 * accepted a date range and nothing else: shift lived on /api/production
 * only, product on /api/production only, station on the register rows only,
 * and the reject code was a grouping that could never be a WHERE. Every
 * reject query in this file now takes one `RejectFilters` and binds it
 * through one function, so the Pareto, the per-day breakdown and the reason
 * sheet cannot disagree about which rejects a filter selects — and
 * rejectSpc.ts binds the same shape, so the trend agrees with them too.
 *
 * `tsTo` is the replay guard period.ts documents: an upper bound on the
 * production INSTANT so `?at=` shows only what existed at that moment. Line
 * had it (through /api/production) and this screen did not, which is why the
 * two disagreed on the same shift under replay.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';
import type { Db } from './audit.js';
import {
  andEpoch, epochWhere, noteOf, resolveGenerationScope, UNSCOPED,
  type GenerationNote, type GenerationScope,
} from './generation.js';

/**
 * Resolve the source generation for a filter bag and return the bag with it
 * attached. Every public entry point in this file starts with this, so all of
 * its own queries — and everything it calls, `getUnmatchedRejects` included —
 * read ONE generation (generation.ts, 23 Sep 2026).
 */
async function scoped(
  pool: ConnectionPool,
  lineId: number,
  f: RejectFilters,
): Promise<{ f: RejectFilters; note: GenerationNote }> {
  if (f.scope) return { f, note: noteOf(f.scope) };
  const scope = await resolveGenerationScope(pool, lineId, { from: f.from, to: f.to });
  return { f: { ...f, scope }, note: noteOf(scope) };
}

/**
 * One reject code, as a filter. `quality` codes are a (tube, material) pair
 * from the inspection station; `weight` rejects carry no code at all (the
 * scale threw them out, rejectWeight1_TP1U2 has no code column). Null codes
 * are legal on a quality reject and are matched as such, never dropped.
 */
export type RejectCodeFilter =
  | { kind: 'weight' }
  | { kind: 'quality'; tube: number | null; material: number | null };

/**
 * The URL form: `code=weight`, or `code=<tube>-<material>` with `null` for a
 * missing half (`code=null-3`). Returns null for anything else so the route
 * can answer 400 rather than silently matching nothing.
 */
export function parseCodeParam(raw: string): RejectCodeFilter | null {
  if (raw === 'weight') return { kind: 'weight' };
  const m = /^(\d{1,9}|null)-(\d{1,9}|null)$/.exec(raw);
  if (!m) return null;
  const part = (s: string) => (s === 'null' ? null : Number(s));
  return { kind: 'quality', tube: part(m[1]!), material: part(m[2]!) };
}

/** The URL form of a code, the inverse of parseCodeParam. */
export function codeParamOf(c: { rejectType: string; tubeCode: number | null; materialCode: number | null }): string {
  return c.rejectType === 'weight' ? 'weight' : `${c.tubeCode ?? 'null'}-${c.materialCode ?? 'null'}`;
}

export interface RejectFilters {
  /** Production-day bounds (shift_date), inclusive. */
  from?: string;
  to?: string;
  shift?: 'morning' | 'evening' | 'night';
  /** ISO instant; caps production_ts_utc_ms so a replay counts only what existed then. */
  tsTo?: string;
  station?: number;
  /** material_id. NULL on every row from before the 2026-08-05 rebuild — see `unattributed`. */
  product?: number;
  code?: RejectCodeFilter;
  /**
   * The SOURCE GENERATION these filters are confined to (generation.ts,
   * 23 Sep 2026). Carried ON THE FILTER BAG rather than as a parameter so it
   * propagates through every `{ ...f }` spread in this file and through
   * `getUnmatchedRejects` without a signature change — three workers hold
   * files that call `bindRejectFilters`, and a required parameter would have
   * broken them mid-flight.
   *
   * Omitted (undefined) means UNCONSTRAINED, which is what every caller did
   * before this pass. That is deliberately a no-op rather than a hard error:
   * see the report accompanying this commit for the call sites that are still
   * unconstrained and why each one is.
   */
  scope?: GenerationScope;
}

/**
 * Binds every filter onto `req` and returns the WHERE fragment, columns
 * qualified with `alias`. `withCode` is false where the code is the thing
 * being grouped or where the population is the DENOMINATOR (every reject,
 * whatever its code) — the same rule rejectSpc.ts applies to reject_type.
 *
 * The code predicate uses ISNULL(..., -999) on the event side exactly as the
 * reject_code join does: `NULL = NULL` is never true in SQL, so a quality
 * reject with a null half of its pair would otherwise be unselectable.
 */
export function bindRejectFilters(
  req: SqlRequest,
  lineId: number,
  f: RejectFilters,
  alias = '',
  withCode = true,
): string {
  const c = (name: string) => `${alias}${name}`;
  const scope = f.scope ?? UNSCOPED;
  const w: string[] = [`${c('line_id')} = @line`];
  req.input('line', mssql.Int, lineId);
  if (f.from) { w.push(`${c('shift_date')} >= @from`); req.input('from', mssql.Date, f.from); }
  if (f.to) { w.push(`${c('shift_date')} <= @to`); req.input('to', mssql.Date, f.to); }
  if (f.shift) { w.push(`${c('shift_code')} = @shift`); req.input('shift', mssql.VarChar(10), f.shift); }
  if (f.tsTo) { w.push(`${c('production_ts_utc_ms')} <= @tsTo`); req.input('tsTo', mssql.BigInt, new Date(f.tsTo).getTime()); }
  if (f.station != null) { w.push(`${c('source_station')} = @station`); req.input('station', mssql.Int, f.station); }
  if (f.product != null) { w.push(`${c('material_id')} = @product`); req.input('product', mssql.Int, f.product); }
  if (withCode && f.code) {
    w.push(`${c('reject_type')} = @codeType`);
    req.input('codeType', mssql.VarChar(10), f.code.kind);
    if (f.code.kind === 'quality') {
      w.push(`ISNULL(${c('tube_inspect_code')}, -999) = @codeTube`);
      w.push(`ISNULL(${c('material_inspect_code')}, -999) = @codeMaterial`);
      req.input('codeTube', mssql.Int, f.code.tube ?? -999);
      req.input('codeMaterial', mssql.Int, f.code.material ?? -999);
    }
  }
  return andEpoch(w.join(' AND '), req, scope, 'reject_event', { alias });
}

/**
 * The same filters applied to cone_event, for a denominator. Cones have no
 * reject type or code, so those never bind; everything else is the same
 * column under the same name on both tables.
 *
 * KNOWN GAP, reported not fixed (23 Sep 2026 reject-denominator brief, item
 * 4): unlike weights.ts (`plausibleWhere`, cone weight_g BETWEEN 1500 and
 * 2100 g by default), this applies NO plausibility predicate and does not
 * require `weight_g IS NOT NULL`, so the population behind a reject rate's
 * `produced`/cones count is not exactly the population behind the Weight
 * screen's own cone count — two populations under one name, structurally.
 * Measured impact today: 4 rows differ on the September generation, 221 on
 * July, against totals in the hundred-thousands — immaterial to any rate
 * this file or rejectSpc.ts currently reports. Not fixed here because doing
 * so needs the per-line plausibility window, which every other caller of
 * this function fetches asynchronously from `sms.plausibility_rule`
 * (`coneState.ts getPlausibilityRule`) before building filters; threading
 * that through `bindConeFilters`, `bindRejectFilters` and every synchronous
 * caller in this file and rejectSpc.ts is a real refactor, not a one-line
 * change, and was judged not worth the risk for a currently-immaterial
 * discrepancy in the same pass as the denominator fix above.
 */
export function bindConeFilters(req: SqlRequest, lineId: number, f: RejectFilters, alias = ''): string {
  // The generation predicate must name CONE_EVENT's epoch, not reject_event's
  // — one generation spans several `sms.source_epoch` rows, one per source
  // table, so the ids differ per table. Strip the scope from the delegated
  // call and re-apply it against the right table here.
  const where = bindRejectFilters(req, lineId, { ...f, code: undefined, scope: undefined }, alias, false);
  return andEpoch(where, req, f.scope ?? UNSCOPED, 'cone_event', { alias });
}

/**
 * cone_event's own merge key (transform.ts `coneKey`): production instant +
 * hanger. A reject_event row matching an existing cone_event row on this key
 * is the SAME physical cone, weighed then separately rejected — not a second
 * unit. Shared here so every "was this reject already counted as a cone"
 * check in the app (rejectSpc.ts's p-chart, this file's day/code breakdown,
 * production.ts's report denominator) uses the identical predicate. See
 * rejectSpc.ts's file header (23 Sep 2026) for the measurement this rests
 * on: matching rejectQCS1_TP1U2/rejectWeight1_TP1U2 to pack1_TP1U2 on
 * (ProductionDate, HangerNum) finds a match for 98%+ of quality rejects and
 * 41/41 (Sept) / 244/246 (July) weight rejects.
 */
export function coneMatchPredicate(rejectAlias: string, coneAlias: string): string {
  return `${coneAlias}.line_id = ${rejectAlias}.line_id
      AND ${coneAlias}.production_ts_utc_ms = ${rejectAlias}.production_ts_utc_ms
      AND ISNULL(${coneAlias}.hanger_num, -1) = ISNULL(${rejectAlias}.hanger_num, -1)`;
}

/**
 * Rejects with NO matching cone_event row — the ONLY rejects that belong in
 * a reject-rate denominator alongside cones (see `coneMatchPredicate`). A
 * rejected cone is still an inspected unit, but 98%+ of rejects are already
 * counted once in `produced`/`cones` because the reject_event row and the
 * cone_event row are the same physical cone logged twice; adding every
 * reject to the denominator double-counts those. Every reject-rate
 * calculation in the app must call this (or rejectSpc.ts's own bucketed
 * version of the same query) rather than adding cones + every reject.
 *
 * `group` is a SQL expression evaluated against the `re` alias (the same
 * shape production.ts's own `groupExpr` uses, re-aliased), or omitted for a
 * single ungrouped total keyed `'total'`.
 */
export async function getUnmatchedRejects(
  pool: ConnectionPool,
  lineId: number,
  f: RejectFilters,
  group?: string,
): Promise<Map<string, number>> {
  const req = pool.request();
  const where = bindRejectFilters(req, lineId, { ...f, code: undefined }, 're.', false);
  // The cone side of the match is generation-constrained TOO. Without it a
  // reject from one generation can be "matched" by a cone from another that
  // happens to share (production instant, hanger) — which on this dev copy is
  // not hypothetical, because the simulator replays the real plant's own
  // timing distributions. A reject wrongly counted as matched drops straight
  // out of the reject-rate DENOMINATOR, so the error is silent in both
  // directions.
  const coneEpoch = epochWhere(req, f.scope ?? UNSCOPED, 'cone_event', { alias: 'ce.', prefix: 'um' });
  const groupClause = group ? `GROUP BY ${group}` : '';
  const selectGroup = group ?? `'total'`;
  const r = await req.query<{ grp: string; n: number }>(`
    SELECT ${selectGroup} AS grp, COUNT(*) AS n
      FROM sms.reject_event re
     WHERE ${where}
       AND NOT EXISTS (
         SELECT 1 FROM sms.cone_event ce WHERE ${coneMatchPredicate('re', 'ce')}${coneEpoch ? ` AND ${coneEpoch}` : ''}
       )
     ${groupClause}
  `);
  return new Map(r.recordset.map((x) => [String(x.grp), Number(x.n)]));
}

/**
 * The reject_code lookup join, per line since migration 028. ISNULL on both
 * sides: a weight reject's pair is NULL/NULL on the event AND on its code row.
 */
const CODE_JOIN = `LEFT JOIN sms.reject_code rc
      ON rc.line_id = re.line_id
     AND rc.reject_type = re.reject_type
     AND ISNULL(rc.tube_code, -999)     = ISNULL(re.tube_inspect_code, -999)
     AND ISNULL(rc.material_code, -999) = ISNULL(re.material_inspect_code, -999)`;

export interface RejectReason {
  rejectCodeId: number | null;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  label: string | null;
  displayLabel: string;
  count: number;
  pct: number;
  cumulativePct: number;
}

/**
 * Present only on a product-filtered call, and for the same reason
 * production.ts carries one: product attribution is asymmetric across the
 * 2026-08-05 rebuild. Every July-generation reject has material_id NULL
 * because the source column did not exist, so `?product=` silently answers
 * with September rows only. `rows` is the count of rejects in the requested
 * range with NO attribution, `of` every reject in it — both WITHOUT the
 * product filter — so the screen can say "N of M rejects in this period
 * predate product recording".
 */
export interface UnattributedRejects {
  rows: number;
  of: number;
}

export interface RejectParetoResult {
  total: number;
  reasons: RejectReason[];
  unattributed: UnattributedRejects | null;
  /** Which source generation these counts came from, and what was left out. */
  generationNote?: GenerationNote;
}

function displayFor(r: { rejectType: string; tubeCode: number | null; materialCode: number | null; label: string | null }): string {
  if (r.label) return r.label;
  if (r.rejectType === 'weight') return 'Weight out of range';
  return `Tube ${r.tubeCode ?? '—'} · Mat ${r.materialCode ?? '—'}`;
}

async function countUnattributed(pool: ConnectionPool, lineId: number, f: RejectFilters): Promise<UnattributedRejects | null> {
  if (f.product == null) return null;
  const req = pool.request();
  const where = bindRejectFilters(req, lineId, { ...f, product: undefined }, 're.');
  const r = await req.query<{ n: number; no_attr: number }>(
    `SELECT COUNT(*) n, SUM(CASE WHEN re.material_id IS NULL THEN 1 ELSE 0 END) no_attr
       FROM sms.reject_event re WHERE ${where}`,
  );
  const row = r.recordset[0];
  return { rows: Number(row?.no_attr ?? 0), of: Number(row?.n ?? 0) };
}

export async function getRejectPareto(
  pool: ConnectionPool,
  lineId: number,
  f0: RejectFilters = {},
): Promise<RejectParetoResult> {
  const { f, note } = await scoped(pool, lineId, f0);
  const req = pool.request();
  const where = bindRejectFilters(req, lineId, f, 're.');

  const r = await req.query<{
    reject_code_id: number | null;
    reject_type: string;
    tube_inspect_code: number | null;
    material_inspect_code: number | null;
    label: string | null;
    n: number;
  }>(`
    SELECT rc.reject_code_id, re.reject_type, re.tube_inspect_code, re.material_inspect_code,
           rc.label, COUNT(*) AS n
    FROM sms.reject_event re
    ${CODE_JOIN}
    WHERE ${where}
    GROUP BY rc.reject_code_id, re.reject_type, re.tube_inspect_code, re.material_inspect_code, rc.label
    ORDER BY n DESC
  `);

  const total = r.recordset.reduce((s, x) => s + Number(x.n), 0);
  let cum = 0;
  const reasons: RejectReason[] = r.recordset.map((x) => {
    const n = Number(x.n);
    cum += n;
    const base = {
      rejectType: x.reject_type,
      tubeCode: x.tube_inspect_code,
      materialCode: x.material_inspect_code,
      label: x.label,
    };
    return {
      rejectCodeId: x.reject_code_id == null ? null : Number(x.reject_code_id),
      ...base,
      displayLabel: displayFor(base),
      count: n,
      pct: total > 0 ? Math.round((1000 * n) / total) / 10 : 0,
      cumulativePct: total > 0 ? Math.round((1000 * cum) / total) / 10 : 0,
    };
  });
  const unattributed = await countUnattributed(pool, lineId, f);
  return { total, reasons, unattributed, generationNote: note };
}

/* ------------------------------------------------------- per day, per code */

/**
 * The day axis is the PRODUCTION day — `shift_date`, 06:00 to 06:00 under
 * the line's shift rule, the same key every other day-grained figure in the
 * application uses. IFL has not confirmed whether their reject reporting
 * counts by production day or by calendar date (gap analysis §7); the
 * response says which this is so a screen can print it rather than imply it.
 */
export const REJECT_DAY_BASIS = 'production_day' as const;

export interface RejectDayCodeRow {
  /** YYYY-MM-DD production day. */
  day: string;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  rejectCodeId: number | null;
  label: string | null;
  displayLabel: string;
  isPass: boolean | null;
  /** Rejects of this code on this day, under the filters. */
  count: number;
  /** Cones weighed that day, under the same shift/station/product/tsTo filters. */
  cones: number;
  /**
   * Cones + that day's rejects with no matching cone_event row — the rate's
   * denominator (corrected 23 Sep 2026: most rejects already ARE a
   * cone_event row, weighed then separately rejected; see
   * `coneMatchPredicate` / rejectSpc.ts's file header). Never divide `count`
   * by `cones` alone.
   */
  inspected: number;
  ratePct: number | null;
}

export interface RejectDayCodeResult {
  dayBasis: typeof REJECT_DAY_BASIS;
  /**
   * The label is unchanged (`cones_plus_rejects`) but the meaning was
   * corrected 23 Sep 2026: "rejects" here means only the day's rejects with
   * no matching cone_event row, not every reject of the day — see
   * `getUnmatchedRejects`. Renaming the literal would ripple into the web
   * client's own copy of this type for no behavioural gain, so it stays.
   */
  denominator: 'cones_plus_rejects';
  /** Distinct production days with at least one reject (or cone) in range. */
  days: number;
  total: number;
  rows: RejectDayCodeRow[];
  /** Which source generation these counts came from, and what was left out. */
  generationNote?: GenerationNote;
}

/**
 * Rejects grouped by (production day, code), each with that day's own cone
 * count so the row can carry a rate. The denominator population is the day's
 * cones plus only the day's rejects with no matching cone_event row
 * (corrected 23 Sep 2026 — see `getUnmatchedRejects`), so a code that is 3%
 * of a day's rejects reads as 3% × (rejects ÷ inspected), not as 3% of the
 * cones.
 */
export async function getRejectsByDayCode(
  pool: ConnectionPool,
  lineId: number,
  f0: RejectFilters = {},
): Promise<RejectDayCodeResult> {
  const { f, note } = await scoped(pool, lineId, f0);
  const codeReq = pool.request();
  const codeWhere = bindRejectFilters(codeReq, lineId, f, 're.');
  const byCode = await codeReq.query<{
    day: string; reject_type: string; tube_inspect_code: number | null; material_inspect_code: number | null;
    reject_code_id: number | null; label: string | null; is_pass: boolean | null; n: number;
  }>(`
    SELECT CONVERT(varchar(10), re.shift_date, 120) AS day, re.reject_type, re.tube_inspect_code, re.material_inspect_code,
           rc.reject_code_id, rc.label, rc.is_pass, COUNT(*) AS n
    FROM sms.reject_event re
    ${CODE_JOIN}
    WHERE ${codeWhere}
    GROUP BY CONVERT(varchar(10), re.shift_date, 120), re.reject_type, re.tube_inspect_code, re.material_inspect_code,
             rc.reject_code_id, rc.label, rc.is_pass
  `);

  // The denominator addend (corrected 23 Sep 2026, this file's own copy of
  // the finding H1 follow-up defect — see rejectSpc.ts's file header): NOT
  // every reject of the day, only those with no matching cone_event row.
  // Most rejects (98%+) are the same physical cone as an existing cone_event
  // row and are already counted once in `cones` below; adding all of them
  // again double-counted every day's inspection reject rate.
  const unmatchedOf = await getUnmatchedRejects(pool, lineId, f, "CONVERT(varchar(10), re.shift_date, 120)");

  const coneReq = pool.request();
  const coneWhere = bindConeFilters(coneReq, lineId, f, 'ce.');
  const cones = await coneReq.query<{ day: string; n: number }>(
    `SELECT CONVERT(varchar(10), ce.shift_date, 120) AS day, COUNT(*) AS n
       FROM sms.cone_event ce WHERE ${coneWhere}
      GROUP BY CONVERT(varchar(10), ce.shift_date, 120)`,
  );

  const dayKey = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  const conesOf = new Map(cones.recordset.map((x) => [dayKey(x.day), Number(x.n)]));

  const rows: RejectDayCodeRow[] = byCode.recordset.map((x) => {
    const day = dayKey(x.day);
    const n = Number(x.n);
    const dayCones = conesOf.get(day) ?? 0;
    const inspected = dayCones + (unmatchedOf.get(day) ?? 0);
    const base = {
      rejectType: x.reject_type,
      tubeCode: x.tube_inspect_code == null ? null : Number(x.tube_inspect_code),
      materialCode: x.material_inspect_code == null ? null : Number(x.material_inspect_code),
      label: x.label,
    };
    return {
      day,
      ...base,
      rejectCodeId: x.reject_code_id == null ? null : Number(x.reject_code_id),
      displayLabel: displayFor(base),
      isPass: x.is_pass == null ? null : Boolean(x.is_pass),
      count: n,
      cones: dayCones,
      inspected,
      ratePct: inspected > 0 ? Math.round((1000 * n) / inspected) / 10 : null,
    };
  });
  // Day ascending, then the biggest reason first within the day.
  rows.sort((a, b) => a.day.localeCompare(b.day) || b.count - a.count);
  const days = new Set([...rows.map((r) => r.day), ...conesOf.keys()]).size;
  return {
    dayBasis: REJECT_DAY_BASIS,
    denominator: 'cones_plus_rejects',
    days,
    total: rows.reduce((s, r) => s + r.count, 0),
    rows,
    generationNote: note,
  };
}

/* ------------------------------------------------------------ reason sheet */

export interface RejectReasonRow {
  eventId: number;
  productionTsUtc: string;
  shiftCode: string;
  station: number | null;
  materialId: number | null;
  productLabel: string | null;
  weightG: number | null;
  /** IFL's own row id and the generation it belongs to — one id, labelled. */
  sourceRowId: number | null;
  epochLabel: string | null;
  /**
   * The epoch's own generation number and simulator flag (Task B, 28 Sep
   * 2026, mirroring Health defect 4 / register.ts's own Provenance fields)
   * — the pair `batchName()` takes, so ReasonSheet.tsx can print "IFL data
   * batch 3" instead of the raw `epochLabel` table name. Null/false when
   * the row predates epoch tracking (nothing to join).
   */
  epochOrdinal: number | null;
  epochSimulator: boolean;
  attributionMethod: string | null;
}

export interface RejectReasonResult {
  day: string;
  dayBasis: typeof REJECT_DAY_BASIS;
  code: { rejectType: string; tubeCode: number | null; materialCode: number | null };
  /** null until the transform has seeded a lookup row for this pair. */
  rejectCodeId: number | null;
  label: string | null;
  displayLabel: string;
  isPass: boolean | null;
  total: number;
  page: number;
  pageSize: number;
  rows: RejectReasonRow[];
  /** Which source generation these rows came from, and what was left out. */
  generationNote?: GenerationNote;
}

/**
 * One day's rejects of one code, for the reason sheet: when, which station,
 * which product (the row's own material_id, never today's), the weight when
 * the row has one (weight rejects only), and the source row with its
 * generation label — since the 2026-08-05 rebuild the number alone names two
 * rows. Paged, oldest first, so the sheet reads as the day unfolded.
 */
export async function listRejectsOfDayCode(
  pool: ConnectionPool,
  lineId: number,
  q: { day: string; code: RejectCodeFilter; station?: number; product?: number; shift?: RejectFilters['shift']; page: number; pageSize: number },
): Promise<RejectReasonResult> {
  const { f, note } = await scoped(pool, lineId, {
    from: q.day, to: q.day, code: q.code, station: q.station, product: q.product, shift: q.shift,
  });

  const codeRow = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('type', mssql.VarChar(10), q.code.kind)
    .input('tube', mssql.Int, q.code.kind === 'quality' ? (q.code.tube ?? -999) : -999)
    .input('material', mssql.Int, q.code.kind === 'quality' ? (q.code.material ?? -999) : -999)
    .query<{ reject_code_id: number; label: string | null; is_pass: boolean | null }>(
      `SELECT reject_code_id, label, is_pass FROM sms.reject_code
        WHERE line_id = @line AND reject_type = @type
          AND ISNULL(tube_code, -999) = @tube AND ISNULL(material_code, -999) = @material`,
    );
  const code = codeRow.recordset[0];

  const countReq = pool.request();
  const where = bindRejectFilters(countReq, lineId, f, 'e.');
  const count = await countReq.query<{ n: number }>(`SELECT COUNT(*) n FROM sms.reject_event e WHERE ${where}`);

  const rowsReq = pool.request();
  bindRejectFilters(rowsReq, lineId, f, 'e.');
  rowsReq.input('offset', mssql.Int, (q.page - 1) * q.pageSize).input('take', mssql.Int, q.pageSize);
  const rows = await rowsReq.query<{
    event_id: number; production_ts_utc: Date; shift_code: string; source_station: number | null;
    material_id: number | null; description: string | null; lot_code: string | null; weight_g: number | null;
    source_row_id: number | null; epoch_label: string | null; epoch_ordinal: number | null; epoch_source_db: string | null;
    attribution_method: string | null;
  }>(`
    SELECT e.reject_event_id AS event_id, e.production_ts_utc, e.shift_code, e.source_station,
           e.material_id, p.description, p.lot_code, e.weight_g,
           e.source_row_id, ep.label AS epoch_label, ep.generation_ordinal AS epoch_ordinal, ep.source_db AS epoch_source_db,
           e.attribution_method
    FROM sms.reject_event e
    LEFT JOIN sms.product p ON p.product_id = e.material_id
    LEFT JOIN sms.source_epoch ep ON ep.epoch_id = e.source_epoch
    WHERE ${where}
    ORDER BY e.production_ts_utc ASC, e.reject_event_id ASC
    OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY
  `);

  const base = {
    rejectType: q.code.kind,
    tubeCode: q.code.kind === 'quality' ? q.code.tube : null,
    materialCode: q.code.kind === 'quality' ? q.code.material : null,
    label: code?.label ?? null,
  };
  return {
    day: q.day,
    dayBasis: REJECT_DAY_BASIS,
    code: { rejectType: base.rejectType, tubeCode: base.tubeCode, materialCode: base.materialCode },
    rejectCodeId: code == null ? null : Number(code.reject_code_id),
    label: base.label,
    displayLabel: displayFor(base),
    isPass: code?.is_pass == null ? null : Boolean(code.is_pass),
    total: Number(count.recordset[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.recordset.map((x) => ({
      eventId: Number(x.event_id),
      productionTsUtc: x.production_ts_utc instanceof Date ? x.production_ts_utc.toISOString() : String(x.production_ts_utc),
      shiftCode: x.shift_code,
      station: x.source_station == null ? null : Number(x.source_station),
      materialId: x.material_id == null ? null : Number(x.material_id),
      // The same words currentProduct.ts uses for a product, so the sheet and
      // the Line screen name it identically.
      productLabel: x.material_id == null ? null : x.description || x.lot_code || `Product ${x.material_id}`,
      weightG: x.weight_g == null ? null : Number(x.weight_g),
      sourceRowId: x.source_row_id == null ? null : Number(x.source_row_id),
      epochLabel: x.epoch_label ?? null,
      epochOrdinal: x.epoch_ordinal == null ? null : Number(x.epoch_ordinal),
      // Mirrors generation.ts's own isSimulator source_db check (operations.ts's
      // local copy, same reasoning): the plant simulator's rows carry their
      // recorded provenance mislabelled as 'ifl_copy', so source_db is the
      // only signal trusted here.
      epochSimulator: /_SIM$/i.test(x.epoch_source_db ?? ''),
      attributionMethod: x.attribution_method ?? null,
    })),
    generationNote: note,
  };
}

/* ------------------------------------------------------------- dictionary */

export const REJECT_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export type RejectSeverity = (typeof REJECT_SEVERITIES)[number];

export interface RejectCodeRow {
  rejectCodeId: number;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  label: string | null;
  isPass: boolean | null;
  severity: RejectSeverity | null;
}

/**
 * The line's reject codes — every (type, tube, material) combination the
 * transform has observed, with whatever label / pass flag / severity has been
 * entered. Codes are per line since migration 028 (rc.line_id, and the join
 * above matches on it), because a second line's scale may use the same
 * numbers for different faults.
 */
export async function listRejectCodes(pool: ConnectionPool, lineId: number): Promise<RejectCodeRow[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    reject_code_id: number; reject_type: string; tube_code: number | null; material_code: number | null;
    label: string | null; is_pass: boolean | null; severity: string | null;
  }>(
    `SELECT reject_code_id, reject_type, tube_code, material_code, label, is_pass, severity
       FROM sms.reject_code WHERE line_id = @line
      ORDER BY reject_type, tube_code, material_code`,
  );
  return r.recordset.map((x) => ({
    rejectCodeId: Number(x.reject_code_id),
    rejectType: x.reject_type,
    tubeCode: x.tube_code == null ? null : Number(x.tube_code),
    materialCode: x.material_code == null ? null : Number(x.material_code),
    label: x.label,
    isPass: x.is_pass == null ? null : Boolean(x.is_pass),
    severity: (x.severity as RejectSeverity | null) ?? null,
  }));
}

export interface RejectCodePatch {
  /** `undefined` leaves the field alone; `null` clears it. Same for all three. */
  label?: string | null;
  isPass?: boolean | null;
  severity?: RejectSeverity | null;
}

/**
 * Update a reject code's label / pass flag / severity (Q10 answer entry).
 * The only write in this codebase that overwrites rather than versions —
 * reject_code is a small lookup table, not an event stream, so a full history
 * table would be over-engineering. What it must not do is lose the old value
 * silently: OUTPUT deleted.* captures it in the same statement so the caller
 * can put it in the audit log, which is where this row's history now lives
 * instead of nowhere.
 *
 * Only the fields PRESENT are written. The distinction matters: the Rejects
 * screen renames a label and sends no isPass at all, and until 14 Sep 2026
 * that absent value arrived here as null and was written — every rename
 * wiped the code's pass flag. Each column has its own set flag in the SQL so
 * the same mistake cannot be made for severity.
 */
export async function updateRejectCode(
  db: Db,
  lineId: number,
  rejectCodeId: number,
  p: RejectCodePatch,
): Promise<{ rowsAffected: number; oldLabel: string | null; oldIsPass: boolean | null; oldSeverity: RejectSeverity | null }> {
  const r = await db
    .request()
    .input('id', mssql.BigInt, rejectCodeId)
    .input('line', mssql.Int, lineId)
    .input('setLabel', mssql.Bit, p.label !== undefined)
    .input('label', mssql.NVarChar(128), p.label ?? null)
    .input('setPass', mssql.Bit, p.isPass !== undefined)
    .input('pass', mssql.Bit, p.isPass ?? null)
    .input('setSeverity', mssql.Bit, p.severity !== undefined)
    .input('severity', mssql.VarChar(10), p.severity ?? null)
    .query<{ old_label: string | null; old_is_pass: boolean | null; old_severity: string | null }>(
      `UPDATE sms.reject_code
          SET label = CASE WHEN @setLabel = 1 THEN @label ELSE label END,
              is_pass = CASE WHEN @setPass = 1 THEN @pass ELSE is_pass END,
              severity = CASE WHEN @setSeverity = 1 THEN @severity ELSE severity END
       OUTPUT deleted.label AS old_label, deleted.is_pass AS old_is_pass, deleted.severity AS old_severity
       WHERE reject_code_id = @id AND line_id = @line`,
    );
  const row = r.recordset[0];
  return {
    rowsAffected: r.rowsAffected[0] ?? 0,
    oldLabel: row?.old_label ?? null,
    oldIsPass: row?.old_is_pass == null ? null : Boolean(row.old_is_pass),
    oldSeverity: (row?.old_severity as RejectSeverity | null) ?? null,
  };
}
