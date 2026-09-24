/**
 * Generalized production query (ARCHITECTURE §9). Filtered by date range /
 * shift / station / product, grouped by day|shift|station|none. Parameterised.
 * Merges cone, reject, and sack aggregates by the group key in JS.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';
import {
  bindStateCase, foldStateCounts, limitProvenance, loadStateContext, plausibleWhere,
  type LimitProvenance, type StateContext, type StateCounts,
} from './coneState.js';
import { getUnmatchedRejects, type RejectFilters } from './rejects.js';
import {
  andEpoch, noteOf, resolveGenerationScope,
  type EventTable, type GenerationNote, type GenerationScope,
} from './generation.js';

/**
 * 'product' since roadmap Phase 8 (15 Sep 2026): the product report. The key
 * is the reading's OWN material_id (cones, rejects and sacks all carry one
 * since IFL's 2026-08-05 rebuild); rows from before it group under 'none',
 * which is how the report says "readings before product recording" from the
 * same query rather than a second one.
 */
export type GroupBy = 'day' | 'shift' | 'station' | 'product' | 'none';

/** The group key for readings with no product. */
export const NO_PRODUCT_GROUP = 'none';

export interface ProductionParams {
  from?: string; // YYYY-MM-DD (shift_date)
  to?: string;
  shift?: string; // morning|evening|night
  station?: number;
  product?: number; // material_id (null in Phase 1 → yields empty)
  /**
   * Upper bound on the production INSTANT, not the day — what makes a replay
   * (`?at=`) show only what existed at that moment.
   *
   * Without it this endpoint answered with the whole shift while /api/live
   * truncated at the replay instant, so under replay the Line screen's sack
   * and cone counts read roughly DOUBLE the Wall display's for the same
   * shift, mid-shift. period.ts documents `tsTo` as exactly this guard; it
   * simply was never plumbed through to here.
   */
  tsTo?: string;
  groupBy: GroupBy;
  /**
   * Also count the cones per classification state (roadmap Phase 4, 14 Sep
   * 2026). Opt-in because it loads the limits history and the plausibility
   * rule; the route always asks, the report asks once for its totals.
   */
  withStates?: boolean;
  /** A pre-loaded context, so a caller issuing several calls loads it once. */
  stateContext?: StateContext;
}

export interface ProductionRow {
  group: string;
  cones: number;
  rejectedCones: number;
  /**
   * `rejectedCones` with no matching cone_event row (corrected 23 Sep 2026 —
   * see rejects.ts `getUnmatchedRejects`) — the reject-rate DENOMINATOR
   * addend. Most rejects ARE an existing cone_event row, weighed then
   * separately rejected, and are already counted once in `cones`; adding
   * every reject again double-counts those. report.ts's `toReportLine` is
   * the one place this becomes a rate; every report built on `getProduction`
   * (daily, product, sack, the management summary) goes through it, so they
   * cannot diverge from each other or from rejectSpc.ts's own p-chart, which
   * computes the identical population directly.
   */
  unmatchedRejects?: number;
  sacks: number | null;
  sackWeightKg: number | null;
  conesInRangePct: number | null;
  /**
   * THE SACK EQUIVALENT of `conesInRangePct`, and named at length on purpose
   * (23 Sep 2026). Until this existed the sack report's per-day rows carried
   * `conesInRangePct` and nothing else — a CONE figure on a SACK report — so
   * "how did sack packing go over the period?" could not be answered or
   * charted from any endpoint. A field called `inRangePct` sitting beside a
   * cone figure of the same shape is how that confusion started; this one
   * says which readings and whose verdict in its own name.
   *
   * WHOSE VERDICT: the SCALE's. This is `sack_event.in_range`, the bit
   * IFL's own `sack1_TP1U2.inRange` column carries, and nothing else. Per
   * CLAUDE.md's ONE STATUS VOCABULARY rule it is named as the scale's, and
   * there is deliberately NO second "within product tolerance" companion
   * beside it, because no such tolerance exists to compute one from —
   * verified 23 Sep 2026 against the attached copies: `sack1_TP1U2` holds
   * only (id, Date, Shift, Area, SackNum, Weight, inRange, MaterialId), and
   * `PDAS.Materials`'s MaterialSetpointWeight / WeightOffsetMinus /
   * WeightOffsetPlus are the CONE setpoint (~1950 g), not a sack limit.
   * IFL's data carries no sack tolerance at all. Do not invent one.
   *
   * Null when the group weighed no sack carrying a verdict, and null on a
   * station grouping (sacks have no station — see `bindFilters`). The
   * DENOMINATOR is sacks whose flag is non-null, not every sack: the column
   * is nullable, and a sack the scale never judged is neither passed nor
   * failed. (It differs from `conesInRangePct`'s COUNT(*) denominator for
   * that reason; on every generation held here both flags are 100 % non-null,
   * so the two agree today and this only ever matters if that changes.)
   *
   * DECLARED OPTIONAL, and not because stating it is optional — `getProduction`
   * always sets it on every row it builds. It is optional for exactly the
   * reason `generationNote?:` is (generation.ts, one commit earlier): a
   * REQUIRED field would have broken the hand-built row fakes in report and
   * summary test files that other workers hold open mid-flight. A CONSUMER
   * must read a missing value as "not stated", never as 0 %.
   */
  sacksPassedScalePct?: number | null;
}

/**
 * Which numeric field a data issue is about. Per-row fields carry the row's
 * `group` key alongside; the three whole-response fields (`unattributed.*`,
 * `implausible`) carry `group: null`.
 */
export type ProductionField =
  | 'cones' | 'conesInRangePct' | 'rejectedCones'
  | 'sacks' | 'sackWeightKg' | 'sacksPassedScalePct'
  | 'unattributed.cones' | 'unattributed.rejects'
  | 'implausible';

/**
 * WS-P (remediation programme, 23 Sep 2026 red-team audit): a SQL recordset
 * row that comes back with an expected COLUMN ABSENT — not SQL NULL, the key
 * itself missing, the shape a malformed/truncated driver row takes — used to
 * be read with a bare `?? 0` or a bare property access and silently become a
 * real-looking `0`, indistinguishable from "the line genuinely produced
 * nothing this period". `production.presence.test.ts` proves this against a
 * fake pool with the key deleted (not nulled).
 *
 * One entry per (field, group) that could not be read as a number from its
 * source row. Always present, empty on every healthy response — a CONSUMER
 * checks this list, not the numeric value, to tell "no data" (a real zero,
 * from a well-formed row — SQL COUNT/SUM without GROUP BY always returns
 * exactly one row, even over zero matching source rows, so this path is
 * never reached for a genuinely idle period) apart from "a field absent from
 * a row that was present" (this list). The affected numeric field itself
 * still reads as `0` (or `null` where `null` already means "not
 * applicable") so the response's SUCCESS SHAPE is unchanged — no field
 * silently vanishes from the JSON body the way an unset `undefined` would.
 */
export interface ProductionDataIssue {
  field: ProductionField;
  group: string | null;
  reason: string;
}

/** A row's numeric field, read defensively. */
interface ReadResult {
  value: number;
  /** false when the source value was not a finite number — key absent, or malformed. */
  ok: boolean;
}
function readNum(v: unknown): ReadResult {
  return typeof v === 'number' && Number.isFinite(v) ? { value: v, ok: true } : { value: 0, ok: false };
}

/** SQL expression that yields the grouping key per dimension. */
function groupExpr(g: GroupBy, stationCol = 'source_station'): string {
  switch (g) {
    case 'day':
      return "CONVERT(varchar(10), shift_date, 120)";
    case 'shift':
      return 'shift_code';
    case 'station':
      return `CAST(${stationCol} AS varchar(12))`;
    case 'product':
      return `ISNULL(CAST(material_id AS varchar(12)), '${NO_PRODUCT_GROUP}')`;
    case 'none':
      return "'total'";
  }
}

/**
 * Same grouping key, qualified for `getUnmatchedRejects`'s `re.` alias
 * (its NOT EXISTS join needs both tables aliased). `undefined` for 'none' —
 * that function treats an omitted group as a single ungrouped total.
 */
function unmatchedGroupExpr(g: GroupBy): string | undefined {
  switch (g) {
    case 'day':
      return "CONVERT(varchar(10), re.shift_date, 120)";
    case 'shift':
      return 're.shift_code';
    case 'station':
      return 'CAST(re.source_station AS varchar(12))';
    case 'product':
      return `ISNULL(CAST(re.material_id AS varchar(12)), '${NO_PRODUCT_GROUP}')`;
    case 'none':
      return undefined;
  }
}

/**
 * Common WHERE + parameter binding for a table. `hasStation` gates station
 * filters.
 *
 * `scope`/`table` add the SOURCE-GENERATION predicate (generation.ts, 23 Sep
 * 2026). Until then every query in this file pooled IFL's pre- and
 * post-2026-08-05 generations the moment a range spanned the rebuild — and on
 * this dev copy pooled the plant simulator's cones with IFL's real ones, 29 %
 * of the rows being real over 21 Aug - 7 Sep. The caller resolves the scope
 * ONCE and passes the same one to every table, so the cone, sack and reject
 * figures on one response are all drawn from the same physical generation.
 */
function bindFilters(
  req: SqlRequest,
  p: ProductionParams,
  lineId: number,
  hasStation: boolean,
  scope: GenerationScope,
  table: EventTable,
): string {
  const w: string[] = ['line_id = @line'];
  req.input('line', mssql.Int, lineId);
  if (p.from) {
    w.push('shift_date >= @from');
    req.input('from', mssql.Date, p.from);
  }
  if (p.to) {
    w.push('shift_date <= @to');
    req.input('to', mssql.Date, p.to);
  }
  if (p.shift) {
    w.push('shift_code = @shift');
    req.input('shift', mssql.VarChar(10), p.shift);
  }
  // production_ts_utc_ms leads the merge index on all three tables, so this
  // stays an index seek rather than turning the scan wider.
  if (p.tsTo) {
    w.push('production_ts_utc_ms <= @tsTo');
    req.input('tsTo', mssql.BigInt, new Date(p.tsTo).getTime());
  }
  if (p.station != null && hasStation) {
    w.push('source_station = @station');
    req.input('station', mssql.Int, p.station);
  }
  if (p.product != null && hasStation) {
    // material_id is NULL on every row from before the 2026-08-05 source
    // rebuild (the column did not exist at source), so this filter drops that
    // whole generation; getProduction reports how many via `unattributed`.
    w.push('material_id = @product');
    req.input('product', mssql.Int, p.product);
  }
  return andEpoch(w.join(' AND '), req, scope, table);
}

/**
 * Present only on a product-filtered call, and the reason it exists: product
 * attribution is asymmetric across the 2026-08-05 source rebuild. Every
 * July-generation cone carries material_id NULL because the column did not
 * exist at source then, and back-filling it would be fabrication. So
 * `?product=` over a range spanning both generations silently answers with
 * the September rows only, for a period the screen says covers both
 * (SEPT-2026-EPOCH-DECISION §4.6). `rows` is the count of cones in the
 * requested range with NO attribution at all, `of` every cone in the range —
 * both counted WITHOUT the product filter — so the screen can say "N of M
 * readings in this period predate product recording" instead of narrowing
 * the period without saying so. Sacks are never product-filtered here (see
 * bindFilters), so they are never silently dropped.
 *
 * Cones AND rejects, reported separately (roadmap Phase 5 item 5, 14 Sep
 * 2026). This used to count cone_event only, so a product-filtered
 * `rejectedCones` silently dropped every pre-rebuild reject with nothing on
 * the response to say so — the caveat covered half the figures it stood over.
 */
export interface UnattributedCount {
  rows: number;
  of: number;
}
export interface Unattributed {
  cones: UnattributedCount;
  rejects: UnattributedCount;
}

/**
 * Cones in the range by the ONE classification (roadmap Phase 4): the same
 * CASE the register's state column is built from, over the same filters the
 * `cones` count uses, so `states` sums to `cones`. `implausible` is the
 * readings the population rule excluded from every weight statistic — they
 * are 'unknown' here, and the report prints "N readings, of which M
 * implausible excluded" from these two numbers.
 */
export interface ProductionStates {
  states: StateCounts;
  implausible: number;
  /**
   * Whether the product-tolerance half of those states — 'within', 'low' and
   * 'high' — was decided against limits whose start date is known. Computed
   * from the SAME StateContext the CASE above was built from, never from a
   * second lookup, so the disclosure can never describe different windows
   * from the ones that produced the counts.
   *
   * DECLARED OPTIONAL for the same reason `sacksPassedScalePct?` and
   * `generationNote?` above are: `getProduction` always sets it, but a
   * required field would break the hand-built fakes in report and summary
   * test files other workers hold open mid-flight. A CONSUMER must read a
   * missing value as "not stated" — never as "the start dates are known".
   */
  provenance?: LimitProvenance;
}

export interface ProductionResult {
  groupBy: GroupBy;
  rows: ProductionRow[];
  /** null on an unfiltered call — nothing was narrowed, so there is nothing to say. */
  unattributed: Unattributed | null;
  /** Cones per state — present only when `withStates` was asked for. */
  states: StateCounts | null;
  /** Readings the population rule excluded as implausible; with `states`. */
  implausible: number | null;
  /**
   * Which SOURCE GENERATION these figures were drawn from, and how many rows
   * in the same period belong to another one and were therefore NOT counted
   * (generation.ts, 23 Sep 2026). Never omit this from a screen that spans
   * generations: excluding data is correct, excluding it silently makes the
   * period look fully represented when it is not.
   */
  generationNote?: GenerationNote;
  /**
   * Whether `states` rests on limits whose start date this system knows, and
   * the sentence to print once if it does not (coneState.ts limitProvenance).
   *
   * Present only alongside `states`, because it describes those five counts
   * and nothing else on this payload: `rows`' cone and sack counts, the
   * kilograms and the scale's own pass figures are measured at the machine
   * and no limits version has ever touched them.
   */
  limitProvenance?: LimitProvenance;
  /**
   * See `ProductionDataIssue`. Always an array, empty when nothing was
   * affected — never omit this checking a "degraded" flag some other way,
   * because the whole point is to say WHICH field/group, not just that
   * something somewhere was off.
   */
  dataIssues: ProductionDataIssue[];
}

export async function getProduction(
  pool: ConnectionPool,
  lineId: number,
  p: ProductionParams,
): Promise<ProductionResult> {
  const g = groupExpr(p.groupBy);
  const byStation = p.groupBy === 'station';
  // 'none' → single aggregate row: label with the literal, NO GROUP BY
  // (SQL Server rejects GROUP BY on a constant).
  const groupClause = p.groupBy === 'none' ? '' : `GROUP BY ${g}`;

  // ONE resolution for the whole response. Every query below — cones, states,
  // rejects, unmatched rejects, sacks, and the unattributed counts — is bound
  // to the SAME generation, so a cones-per-sack or a reject rate computed
  // across them is a ratio of one population and not of two.
  const scope = await resolveGenerationScope(pool, lineId, { from: p.from, to: p.to });

  // Collected across every query below; returned verbatim as `dataIssues`.
  const issues: ProductionDataIssue[] = [];

  // The unattributed count, when a product filter is on: the same range and
  // station/shift filters, minus the product, so `of` is the population the
  // caller believes the period covers.
  let unattributed: Unattributed | null = null;
  if (p.product != null) {
    const countUnattributed = async (table: 'sms.cone_event' | 'sms.reject_event'): Promise<UnattributedCount> => {
      const uReq = pool.request();
      const uWhere = bindFilters(uReq, { ...p, product: undefined }, lineId, true, scope, table === 'sms.cone_event' ? 'cone_event' : 'reject_event');
      const u = await uReq.query<{ n: number; no_attr: number }>(
        `SELECT COUNT(*) n, SUM(CASE WHEN material_id IS NULL THEN 1 ELSE 0 END) no_attr
         FROM ${table} WHERE ${uWhere}`,
      );
      const u0 = u.recordset[0];
      const noAttr = readNum(u0?.no_attr);
      const total = readNum(u0?.n);
      const field: ProductionField = table === 'sms.cone_event' ? 'unattributed.cones' : 'unattributed.rejects';
      // One issue for the pair, not two: `rows`/`of` are always read and
      // reported together (see UnattributedCount), so a consumer never sees
      // one half flagged without the other.
      if (!noAttr.ok || !total.ok) {
        issues.push({ field, group: null, reason: `${table} unattributed-count row is missing a column (no_attr/n)` });
      }
      return { rows: noAttr.value, of: total.value };
    };
    unattributed = {
      cones: await countUnattributed('sms.cone_event'),
      rejects: await countUnattributed('sms.reject_event'),
    };
  }

  // cones (with in-range %)
  const coneReq = pool.request();
  const coneWhere = bindFilters(coneReq, p, lineId, true, scope, 'cone_event');
  const cones = await coneReq.query<{ grp: string; n: number; inr: number }>(
    `SELECT ${g} AS grp, COUNT(*) n, SUM(CASE WHEN in_range=1 THEN 1 ELSE 0 END) inr
     FROM sms.cone_event WHERE ${coneWhere} ${groupClause}`,
  );

  // cones per state, over the SAME filters, whatever the grouping (one row
  // per state for the whole range — the screens ask for the totals).
  let classification: ProductionStates | null = null;
  if (p.withStates) {
    const ctx = p.stateContext ?? (await loadStateContext(pool, lineId));
    const stReq = pool.request();
    const stWhere = bindFilters(stReq, p, lineId, true, scope, 'cone_event');
    const stateCase = bindStateCase(stReq, ctx, '', 'cs');
    const plausible = plausibleWhere(stReq, 'weight_g', ctx.plausibility);
    const st = await stReq.query<{ state: string; n: number; implausible: number }>(
      `SELECT ${stateCase} AS state, COUNT(*) n,
              SUM(CASE WHEN weight_g IS NOT NULL AND NOT (${plausible}) THEN 1 ELSE 0 END) implausible
       FROM sms.cone_event WHERE ${stWhere}
       GROUP BY ${stateCase}`,
    );
    let implausibleIssue = false;
    const implausibleTotal = st.recordset.reduce((acc, r) => {
      const n = readNum(r.implausible);
      if (!n.ok) implausibleIssue = true;
      return acc + n.value;
    }, 0);
    if (implausibleIssue) {
      issues.push({ field: 'implausible', group: null, reason: 'a cone-state aggregate row is missing its implausible count' });
    }
    classification = {
      states: foldStateCounts(st.recordset),
      implausible: implausibleTotal,
      provenance: limitProvenance(ctx),
    };
  }

  // rejected cones
  const rejReq = pool.request();
  const rejWhere = bindFilters(rejReq, p, lineId, true, scope, 'reject_event');
  const rejects = await rejReq.query<{ grp: string; n: number }>(
    `SELECT ${g} AS grp, COUNT(*) n FROM sms.reject_event WHERE ${rejWhere} ${groupClause}`,
  );

  // The reject-rate denominator addend — rejects with no matching cone_event
  // row, same shape/filters as `rejects` above (see ProductionRow.
  // unmatchedRejects and rejects.ts `getUnmatchedRejects`).
  const unmatchedFilters: RejectFilters = {
    from: p.from, to: p.to, shift: p.shift as RejectFilters['shift'], tsTo: p.tsTo,
    station: p.station, product: p.product, scope,
  };
  const unmatchedOf = await getUnmatchedRejects(pool, lineId, unmatchedFilters, unmatchedGroupExpr(p.groupBy));

  // sacks — no station dimension; skip when grouping by station
  let sacks: { grp: string; n: number; kg: number; judged: number; passed: number }[] = [];
  if (!byStation) {
    const sackReq = pool.request();
    const sackWhere = bindFilters(sackReq, p, lineId, false, scope, 'sack_event');
    // `judged`/`passed` are the SCALE's own verdict and its denominator —
    // see ProductionRow.sacksPassedScalePct. Same query, same filters, same
    // generation as the count and the kilograms beside them, so a sack's
    // weight and the scale's verdict on it can never come from two
    // different populations.
    const res = await sackReq.query<{ grp: string; n: number; kg: number; judged: number; passed: number }>(
      `SELECT ${g} AS grp, COUNT(*) n, ISNULL(SUM(weight_kg),0) kg,
              SUM(CASE WHEN in_range IS NOT NULL THEN 1 ELSE 0 END) judged,
              SUM(CASE WHEN in_range = 1 THEN 1 ELSE 0 END) passed
       FROM sms.sack_event WHERE ${sackWhere} ${groupClause}`,
    );
    sacks = res.recordset;
  }

  // weight basis (Q4/Q5)
  const wr = await pool.request().input('line', mssql.Int, lineId).query<{ basis: string; tare: number }>(
    `SELECT TOP 1 basis, sack_tare_kg AS tare FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  const wrRow = wr.recordset[0];
  // JUSTIFIED `?? 'as_recorded'`: an EMPTY recordset here is not a malformed
  // row, it is a real, legitimate state — no weight_rule row has ever been
  // configured for this line — and 'as_recorded' is the documented default
  // basis (Q4/Q5 unresolved). Not the defect class this file is being
  // audited for: there is no row to have a hole in.
  const basis = wrRow?.basis ?? 'as_recorded';
  // `tare` DOES get the same presence check as everything below, but only
  // when a row is actually present: a present-but-holed row (tare deleted)
  // is exactly the malformed shape, unlike the empty-recordset case above.
  let tare = 0;
  if (wrRow) {
    const tareRead = readNum(wrRow.tare);
    if (!tareRead.ok) {
      issues.push({ field: 'sackWeightKg', group: null, reason: 'weight_rule row is missing its tare (sack_tare_kg)' });
    }
    tare = tareRead.value;
  }

  // merge by group key
  const map = new Map<string, ProductionRow>();
  const row = (grp: string): ProductionRow =>
    map.get(grp) ??
    map.set(grp, { group: grp, cones: 0, rejectedCones: 0, unmatchedRejects: 0, sacks: byStation ? null : 0, sackWeightKg: byStation ? null : 0, conesInRangePct: null, sacksPassedScalePct: null }).get(grp)!;

  for (const c of cones.recordset) {
    const r = row(c.grp);
    const n = readNum(c.n);
    r.cones = n.value;
    if (!n.ok) {
      // The denominator itself is unreadable, so the % is unknowable too —
      // flagged separately (a consumer reading only conesInRangePct must not
      // have to cross-reference the 'cones' entry to learn its 0/null is
      // not a real one).
      issues.push({ field: 'cones', group: c.grp, reason: 'cone_event aggregate row is missing its count (n)' });
      issues.push({ field: 'conesInRangePct', group: c.grp, reason: 'cone_event aggregate row is missing its count (n); in-range % unknowable' });
      r.conesInRangePct = null;
      continue;
    }
    if (n.value === 0) {
      r.conesInRangePct = null; // a REAL zero: no cones this group, nothing to rate
      continue;
    }
    const inr = readNum(c.inr);
    if (!inr.ok) {
      issues.push({ field: 'conesInRangePct', group: c.grp, reason: 'cone_event aggregate row is missing its in-range sum (inr)' });
      r.conesInRangePct = null;
      continue;
    }
    r.conesInRangePct = Math.round((1000 * inr.value) / n.value) / 10;
  }
  for (const rj of rejects.recordset) {
    const r = row(rj.grp);
    const n = readNum(rj.n);
    r.rejectedCones = n.value;
    if (!n.ok) {
      issues.push({ field: 'rejectedCones', group: rj.grp, reason: 'reject_event aggregate row is missing its count (n)' });
    }
  }
  // `unmatchedOf` may hold a group ('total', a day, a station...) that never
  // appeared in `rejects.recordset` only if COUNT(*) itself is 0 there,
  // which cannot happen — a NOT EXISTS subset can never be non-empty when
  // its superset is. row() still creates the group safely either way.
  // `unmatchedOf`'s values are already Number()'d inside
  // rejects.ts::getUnmatchedRejects (that file's own concern, not this
  // one's) — no second presence check here.
  for (const [grp, n] of unmatchedOf) row(grp).unmatchedRejects = n;
  for (const s of sacks) {
    const r = row(s.grp);
    const n = readNum(s.n);
    r.sacks = n.value;
    if (!n.ok) {
      issues.push({ field: 'sacks', group: s.grp, reason: 'sack_event aggregate row is missing its count (n)' });
    }

    const kgSum = readNum(s.kg);
    if (!kgSum.ok) {
      issues.push({ field: 'sackWeightKg', group: s.grp, reason: 'sack_event aggregate row is missing its weight sum (kg)' });
    }
    let kg = kgSum.value;
    if (basis === 'net') kg -= tare * n.value;
    r.sackWeightKg = Math.round(kg * 10) / 10;

    const judged = readNum(s.judged);
    const passed = readNum(s.passed);
    if (!judged.ok || !passed.ok) {
      issues.push({ field: 'sacksPassedScalePct', group: s.grp, reason: 'sack_event aggregate row is missing its scale-verdict counts (judged/passed)' });
      r.sacksPassedScalePct = null;
    } else {
      // Null, not 0: no sack carrying a verdict is "not stated", and rendering
      // it as 0 % would say the scale failed every sack in the group.
      r.sacksPassedScalePct = judged.value > 0 ? Math.round((1000 * passed.value) / judged.value) / 10 : null;
    }
  }

  // 'station' and 'product' groups are numeric strings (varchar-cast for the
  // shared group key) — a plain string sort orders them "1,10,11,...,2,3"
  // alphabetically. Sort numerically for those dimensions, with the
  // no-product group last; string sort is correct for the rest (day = ISO
  // date, shift = already a fixed short list, none = single row).
  const numericKey = byStation || p.groupBy === 'product';
  const num = (g: string) => (g === NO_PRODUCT_GROUP ? Number.POSITIVE_INFINITY : Number(g));
  const rows = [...map.values()].sort((a, b) =>
    numericKey ? num(a.group) - num(b.group) : a.group.localeCompare(b.group),
  );
  return {
    groupBy: p.groupBy, rows, unattributed,
    states: classification?.states ?? null,
    // JUSTIFIED `?? null`: this reads `classification`, an already-validated
    // in-memory object built above (implausibleTotal is a readNum() output,
    // never a raw SQL value) — `?? null` here only distinguishes
    // "withStates wasn't asked for" from a real 0, not a hole in a row.
    implausible: classification?.implausible ?? null,
    ...(classification ? { limitProvenance: classification.provenance } : {}),
    generationNote: noteOf(scope),
    dataIssues: issues,
  };
}
