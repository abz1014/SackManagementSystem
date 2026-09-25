/**
 * SOURCE GENERATIONS — the shared predicate, in one place.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * IFL dropped and recreated their four weighing tables on 2026-08-05,
 * restarting every identity at 1 (`SEPT-2026-EPOCH-DECISION.md`).
 * `sms.source_epoch` names each physical generation of each source table so
 * the two can be kept apart. Until this pass almost nothing used it: an
 * inventory on 23 Sep 2026 of every query reading `sms.cone_event`,
 * `sms.sack_event` or `sms.reject_event` found exactly two constrained
 * queries (`spc.ts getWeightSpc`, fixed the same day in 6052b69, and
 * `dq.ts loadPriorSackNums`) and one correct by partitioning
 * (`rejectSpc.ts getRejectSpc`, which groups by `source_epoch` and never
 * pools p̄ across the boundary). Everything else — production, live, health,
 * weights, sacks, rejects, register, reconciliation, calibration, downtime,
 * machines-running, shift-check and every report — pooled generations
 * silently the moment a date range spanned one.
 *
 * That is a defect about IFL's own rebuild, not about this laptop. It is
 * VISIBLE on this laptop because the plant simulator's generation
 * (`DATA_TP1U2_SIM`, 21 Aug - 22 Sep) OVERLAPS IFL's real September
 * generation (`DATA_TP1U2_SEP07`, 5 Aug - 7 Sep) in time: over 21 Aug -
 * 7 Sep `sms.cone_event` holds 190,284 plausible cones of which only 55,058
 * (29 %) are IFL's, and the two means agree to about 1 g because the
 * simulator's distributions were measured from the real data. Three weeks of
 * pooled counts therefore read as normal to everyone. At IFL there is no
 * simulator — there is their own 5 Aug rebuild, and a query spanning it
 * merges two generations of a table whose identities both start at 1.
 *
 * THE DEFAULT, AND WHY
 * --------------------
 * Restrict to ONE generation: the NEWEST generation present in the window,
 * preferring a real generation over a simulator one. Then SAY SO — every
 * caller returns `generation`, `spansGenerations` and
 * `otherGenerationExcluded` so the screen can state what it left out. This is
 * deliberately the same shape and the same rule `spc.ts` adopted in 6052b69,
 * so the application has ONE generation vocabulary rather than a second one
 * that has to be explained beside the first.
 *
 * Alternatives considered and rejected:
 *  - POOL EVERYTHING (today's behaviour). Rejected: a mean, a rate, a LAG
 *    sequence and an identity lookup are all wrong across a table that was
 *    physically recreated. `downtime.ts` is the worst of them — interleaved
 *    generations FILL EACH OTHER'S GAPS, so real stoppages vanish rather
 *    than merely being miscounted.
 *  - THE GENERATION WITH THE MOST ROWS IN THE WINDOW. Rejected: unstable.
 *    The same period's answer would flip generation as data accrues, and
 *    every figure on the screen would jump with it for no reason the reader
 *    can see.
 *  - PARTITION AND REPORT BOTH (the `rejectSpc.ts` shape). Right for a chart
 *    whose x-axis can carry two series; wrong for a single figure, and it
 *    would change every payload shape in the application. Kept where it
 *    already is; not generalised here.
 *
 * Excluding data is the correct answer. Excluding it SILENTLY is the
 * NO OVER-CLAIMING rule read backwards — the screen would imply the period
 * is fully represented when it is not. Hence the disclosure fields; they are
 * not optional decoration.
 *
 * "SIMULATOR" IS READ FROM source_db, NOT FROM provenance
 * ------------------------------------------------------
 * `cli/src/commands/epoch.ts` defaulted `--provenance` to 'ifl_copy' when the
 * flag was omitted, so epochs 13-16 on this development sidecar are the
 * simulator's four tables registered as IFL's own. That default is removed
 * (6b76ae3) and the bad rows are deliberately LEFT STANDING so the
 * registration bug is not hidden. So a generation is treated as simulator
 * output when EITHER its provenance says so OR its `source_db` ends in
 * `_SIM` — `scripts/simulate-plant.mjs` refuses any target whose name does
 * not end in `_SIM` (its own line 96), which is the one invariant actually
 * guaranteed to hold.
 *
 * The `_SIM` test is a SAFETY NET, not the mechanism. The mechanism is
 * "newest generation, one at a time", and it is correct for IFL's rebuild
 * where every generation is real and no name ends in `_SIM`.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';

/** The canonical event tables that carry `source_epoch`. */
export type EventTable = 'cone_event' | 'sack_event' | 'reject_event';

export const EVENT_TABLES: readonly EventTable[] = ['cone_event', 'sack_event', 'reject_event'];

/**
 * Which source table each canonical table's rows come from. `reject_event`
 * is fed by TWO source tables (`rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`),
 * which is why a generation is keyed on (source_db, ordinal) rather than on
 * a single `epoch_id`: one generation spans several `sms.source_epoch` rows.
 */
export interface GenerationRef {
  /** `${sourceDb}#${ordinal}` — stable across the tables of one generation. */
  key: string;
  /** `sms.source_epoch.generation_ordinal`; 1 is the oldest known generation. */
  ordinal: number;
  sourceDb: string | null;
  /** As RECORDED. May be wrong — see the file header. Reported, never trusted. */
  provenance: string | null;
  label: string | null;
  /** Derived from source_db/provenance, not from provenance alone. */
  simulator: boolean;
}

/**
 * What a service returns beside its figures so the screen can say what the
 * period does NOT contain. Mirrors `SpcData`'s fields (spc.ts, 6052b69) on
 * purpose: one vocabulary, one sentence to write in the client.
 */
/**
 * Every service that carries one declares it `generationNote?:` — OPTIONAL,
 * deliberately, and not because it is optional to state. The service always
 * sets it. It is declared optional so that adding it did not break the
 * hand-built result fakes in files other workers hold open (`reports/*`),
 * which a required field would have, mid-flight, in three parallel branches.
 * A CONSUMER must treat a missing value as "not stated" — never as "nothing
 * was excluded".
 */
export interface GenerationNote {
  generation: GenerationRef | null;
  /** True when rows from another generation were present and dropped. */
  spansGenerations: boolean;
  /** How many rows in the window belong to a generation that was NOT used. */
  otherGenerationExcluded: number;
  /**
   * Of `otherGenerationExcluded`, how many came from a PLANT SIMULATOR
   * generation (source_db ending `_SIM`, or provenance 'simulator') —
   * verification 25 Sep 2026, R6/R7: a printed report must name simulated
   * data as simulated, never as "another generation" or "a source rebuild".
   * Optional for the same reason the note itself is (hand-built fakes).
   */
  excludedSimulator?: number;
}

export interface GenerationScope extends GenerationNote {
  /**
   * The `source_epoch` to constrain `table` to, or null for "do not
   * constrain" — which happens when the window holds no epoch-tagged rows at
   * all (a sidecar built before epoch tracking), or when this table has no
   * rows in the chosen generation.
   */
  epochIds(table: EventTable): number[];
}

/** The no-op scope: constrains nothing, claims nothing. */
export const UNSCOPED: GenerationScope = {
  generation: null,
  spansGenerations: false,
  otherGenerationExcluded: 0,
  excludedSimulator: 0,
  epochIds: () => [],
};

/**
 * A generation holding less than this share of the window's REAL rows is a
 * stray, not coverage (verification 25 Sep 2026, M19/M20): IFL's September
 * copy holds one clock-fault cone dated 2026-07-12, and "newest generation
 * present" chose it over the July copy's 67,044 cones for 2 Jul - 4 Aug. The
 * stray is still counted in `otherGenerationExcluded`; it just cannot be the
 * generation a period is read from while a real one covers the period.
 */
export const STRAY_GENERATION_SHARE = 0.01;

export function noteOf(s: GenerationScope): GenerationNote {
  return {
    generation: s.generation,
    spansGenerations: s.spansGenerations,
    otherGenerationExcluded: s.otherGenerationExcluded,
    excludedSimulator: s.excludedSimulator ?? 0,
  };
}

const isSimulator = (r: { provenance: string | null; source_db: string | null }): boolean =>
  r.provenance === 'simulator' || /_SIM$/i.test(r.source_db ?? '');

interface PresentRow {
  tbl: EventTable;
  epoch_id: number | null;
  n: number;
}
interface EpochRow {
  epoch_id: number;
  source_db: string | null;
  generation_ordinal: number | null;
  provenance: string | null;
  label: string | null;
}

export interface GenerationWindow {
  /** Inclusive `shift_date` lower bound. Omit for "from the beginning". */
  from?: string;
  /** Inclusive `shift_date` upper bound. Omit for "to the end". */
  to?: string;
}

/**
 * Resolve the one generation a set of queries should read, over `window`.
 *
 * Deliberately keyed on LINE AND DATE RANGE ONLY — never on the caller's
 * secondary filters (shift, station, product, reject code). A screen issues
 * several queries with different secondary filters and they must all land on
 * the SAME generation, or its own figures stop adding up. It also keeps the
 * choice stable as the reader changes a station filter.
 *
 * One round trip: a UNION ALL of per-table counts, joined in memory to the
 * line's `sms.source_epoch` rows (a handful of rows, PK-keyed).
 */
export async function resolveGenerationScope(
  pool: ConnectionPool,
  lineId: number,
  window: GenerationWindow,
  tables: readonly EventTable[] = EVENT_TABLES,
): Promise<GenerationScope> {
  if (tables.length === 0) return UNSCOPED;

  const req = pool.request().input('line', mssql.Int, lineId);
  const w: string[] = ['line_id = @line'];
  if (window.from) {
    w.push('shift_date >= @genFrom');
    req.input('genFrom', mssql.Date, window.from);
  }
  if (window.to) {
    w.push('shift_date <= @genTo');
    req.input('genTo', mssql.Date, window.to);
  }
  const where = w.join(' AND ');
  // `tables` is a union of three literals, never caller text.
  const parts = tables.map(
    (t) =>
      `SELECT '${t}' AS tbl, source_epoch AS epoch_id, COUNT(*) AS n
       FROM sms.${t} WHERE ${where} GROUP BY source_epoch`,
  );
  const present = (await req.query<PresentRow>(parts.join(' UNION ALL '))).recordset;

  const totalRows = present.reduce((s, r) => s + Number(r.n), 0);
  if (totalRows === 0) return UNSCOPED;

  const epochs = (
    await pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<EpochRow>(
        `SELECT epoch_id, source_db, generation_ordinal, provenance, label
         FROM sms.source_epoch WHERE line_id = @line`,
      )
  ).recordset;
  const byId = new Map<number, EpochRow>(epochs.map((e) => [Number(e.epoch_id), e]));

  // Group the epochs actually present into GENERATIONS. One generation spans
  // several source tables (and therefore several epoch_id values), so the key
  // is (source_db, generation_ordinal) — the pair that is shared across the
  // four tables a single rebuild produced.
  interface Candidate {
    ref: GenerationRef;
    rows: number;
    epochIds: Map<EventTable, number[]>;
  }
  const byKey = new Map<string, Candidate>();
  for (const p of present) {
    if (p.epoch_id == null) continue; // rows ingested before epoch tracking
    const e = byId.get(Number(p.epoch_id));
    if (!e || e.generation_ordinal == null) continue;
    const ordinal = Number(e.generation_ordinal);
    const key = `${e.source_db ?? ''}#${ordinal}`;
    let c = byKey.get(key);
    if (!c) {
      c = {
        ref: {
          key,
          ordinal,
          sourceDb: e.source_db,
          provenance: e.provenance,
          label: e.label,
          simulator: isSimulator(e),
        },
        rows: 0,
        epochIds: new Map(),
      };
      byKey.set(key, c);
    }
    c.rows += Number(p.n);
    const list = c.epochIds.get(p.tbl) ?? [];
    list.push(Number(p.epoch_id));
    c.epochIds.set(p.tbl, list);
  }

  const candidates = [...byKey.values()];
  if (candidates.length === 0) return UNSCOPED; // nothing carries an ordinal

  // Prefer a REAL generation over a simulator one even when the simulator is
  // the newer generation (it is, on this dev copy). With no real generation
  // in the window at all, fall back to the newest simulator one — still ONE
  // generation, still counted honestly, and the caller can see that
  // `generation.simulator` says so.
  const real = candidates.filter((c) => !c.ref.simulator);
  let pool_ = real.length > 0 ? real : candidates;
  // Drop stray generations (see STRAY_GENERATION_SHARE) while a
  // non-stray one remains.
  const poolRows = pool_.reduce((a, c) => a + c.rows, 0);
  const substantial = pool_.filter((c) => c.rows >= poolRows * STRAY_GENERATION_SHARE);
  if (substantial.length > 0) pool_ = substantial;
  // Newest ordinal. Ties (two source databases at the same ordinal) cannot
  // arise from one plant but are broken by row count so the choice is total.
  const chosen = pool_.reduce((a, b) =>
    b.ref.ordinal !== a.ref.ordinal ? (b.ref.ordinal > a.ref.ordinal ? b : a) : b.rows > a.rows ? b : a,
  );

  const excludedSimulator = candidates
    .filter((c) => c !== chosen && c.ref.simulator)
    .reduce((a, c) => a + c.rows, 0);
  // A table with rows in the window from OTHER generations but none in the
  // chosen one must read NOTHING, never "unconstrained" (verification
  // 25 Sep 2026, M20): the management summary's prior period read its cones
  // from the chosen generation and its rejects and sacks, unconstrained,
  // from another. -1 is never an epoch id (IDENTITY from 1). Only rows with
  // NO epoch at all (a sidecar built before epoch tracking) stay unconstrained.
  const taggedTables = new Set<EventTable>();
  for (const p of present) if (p.epoch_id != null && Number(p.n) > 0) taggedTables.add(p.tbl);
  return {
    generation: chosen.ref,
    spansGenerations: totalRows - chosen.rows > 0,
    otherGenerationExcluded: totalRows - chosen.rows,
    excludedSimulator,
    epochIds: (t) => chosen.epochIds.get(t) ?? (taggedTables.has(t) ? [-1] : []),
  };
}

/**
 * The predicate fragment for one table, binding its epoch ids onto `req`.
 * Returns null when nothing should be constrained.
 *
 * `prefix` keeps the parameter names distinct when one request carries more
 * than one table's predicate; `alias` qualifies the column.
 */
export function epochWhere(
  req: SqlRequest,
  scope: GenerationScope,
  table: EventTable,
  opts: { alias?: string; prefix?: string } = {},
): string | null {
  const f = epochFragment(scope, table, opts);
  for (const p of f.params) req.input(p.name, mssql.Int, p.id);
  return f.sql;
}

/**
 * The same predicate, split from the binding, for callers that build one WHERE
 * string and run it on SEVERAL requests (weights.ts does exactly this). The
 * parameter names are deterministic, so the fragment can be built once and the
 * `params` bound onto each request that runs it.
 */
export function epochFragment(
  scope: GenerationScope,
  table: EventTable,
  opts: { alias?: string; prefix?: string } = {},
): { sql: string | null; params: { name: string; id: number }[] } {
  const ids = scope.epochIds(table);
  if (ids.length === 0) return { sql: null, params: [] };
  const alias = opts.alias ?? '';
  const prefix = opts.prefix ?? 'ge';
  const letter = table === 'cone_event' ? 'c' : table === 'sack_event' ? 's' : 'r';
  const params = ids.map((id, i) => ({ name: `${prefix}${letter}${i}`, id }));
  const names = params.map((p) => `@${p.name}`);
  return {
    sql:
      names.length === 1
        ? `${alias}source_epoch = ${names[0]}`
        : `${alias}source_epoch IN (${names.join(', ')})`,
    params,
  };
}

/**
 * The shape `resolveGenerationScope` itself has, minus `pool` — what a
 * caller threads through when it wants to resolve THROUGH a per-request
 * cache instead of calling `resolveGenerationScope` directly. Every existing
 * call site keeps working unchanged: passing no resolver at all still means
 * "call `resolveGenerationScope` on this pool", exactly as before.
 */
export type ScopeResolver = (
  lineId: number,
  window: GenerationWindow,
  tables?: readonly EventTable[],
) => Promise<GenerationScope>;

/**
 * A PER-REQUEST memo over `resolveGenerationScope` (WS-PERF4, 24 Sep 2026).
 *
 * WHY THIS EXISTS. `PERFORMANCE-APP-2026-09-24.md` measured `/api/
 * weight-stations` resolving the identical `(lineId, from, to)` window THREE
 * separate times in one request — `weightStations.ts`'s `stationMaterialCounts`
 * and `rejectRatesByStation`, plus `productAt.ts`'s `productDisagreement`,
 * called from `app.ts`'s own `Promise.all` for that route — six extra SQL
 * round trips (two queries per resolve) beyond the endpoint's real data
 * queries. `resolveGenerationScope`'s own file header explains why each of
 * those three call sites resolves independently BY DESIGN: keyed on
 * `(lineId, from, to, tables)` only, so any two resolves over the same
 * tuple are GUARANTEED to land on the same answer, which is what let six
 * services be scoped by different workers, in parallel, over the same red-
 * team pass, with no shared plumbing. That guarantee is what makes a memo
 * SAFE here — caching "the same question always gets the same answer" never
 * changes what a scoped query sees; it only stops asking the question twice.
 *
 * SCOPED TO ONE REQUEST, NEVER LONGER. Create one of these per HTTP request
 * (in the route handler) and thread it through the services that need to
 * resolve a generation for THAT request. Never hold it on the pool, the
 * `Express` app, or any other object that outlives a single request — a
 * scope resolved for one request's window answering a LATER request is
 * exactly the cross-window pooling defect this generation-scoping work
 * exists to prevent (the D-17/D-18 class: `rejectSpc.ts` and `spc.ts` each
 * once carried their own hand-rolled, driftable copy of this rule).
 *
 * KEYED ON THE FULL TUPLE, INCLUDING `tables` — DELIBERATELY, not just
 * `(lineId, from, to)`. Two calls for the same window but a DIFFERENT table
 * list (e.g. `stationMaterialCounts`'s `['cone_event']` vs a caller that also
 * needs `reject_event`) must not share one answer: `GenerationScope.epochIds`
 * only carries epoch ids for the tables that were actually scanned, so
 * reusing a narrower scope for a wider need would silently return `[]` —
 * "no predicate" — for the table that was never asked about, which is
 * unconstrained, not merely stale. Exact-tuple keying costs nothing here:
 * the two real call sites that share this route's trailing `(from, to)`
 * window (`stationMaterialCounts`, `rejectRatesByStation`) are made to ask
 * for the SAME table list (see `weightStations.ts`), so they still collapse
 * to one resolve; `productDisagreement`'s own, usually DIFFERENT, period
 * window gets its own resolve, correctly, whether or not it happens to
 * coincide with the trailing window.
 *
 * Safe under concurrent callers in the same request (several of these calls
 * run inside a `Promise.all`): the promise is cached BEFORE it is awaited,
 * so two concurrent calls for the same key share the one in-flight promise
 * rather than racing to resolve twice.
 */
export function createScopeCache(pool: ConnectionPool): ScopeResolver {
  const cache = new Map<string, Promise<GenerationScope>>();
  return (lineId, window, tables = EVENT_TABLES) => {
    const key = `${lineId}:${window.from ?? ''}:${window.to ?? ''}:${[...tables].slice().sort().join(',')}`;
    let p = cache.get(key);
    if (!p) {
      p = resolveGenerationScope(pool, lineId, window, tables);
      cache.set(key, p);
    }
    return p;
  };
}

/** `epochWhere` folded into an existing WHERE fragment. */
export function andEpoch(
  where: string,
  req: SqlRequest,
  scope: GenerationScope,
  table: EventTable,
  opts: { alias?: string; prefix?: string } = {},
): string {
  const p = epochWhere(req, scope, table, opts);
  return p ? `${where} AND ${p}` : where;
}
