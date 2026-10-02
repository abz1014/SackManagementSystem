/**
 * Sack cells — the ONE grouping every sack report reads (IFL reports,
 * 1 Oct 2026; Task D-R5).
 *
 * WHY IT EXISTS. Five of IFL's eight reports are tables of sacks: the rejected
 * sack report, the SPS packing report, the weight range report, the packing
 * weight summary, and the existing Sack report. Each one needs a count, a
 * kilogram total, an average, a spread and the scale's own verdict — by date,
 * by shift, by yarn count. Written five times, five slightly different
 * populations would have appeared (the existing report already had two: its
 * average divided every sack's weight, a 0 kg scale fault included, by every
 * sack). So the data is read ONCE, as small cells, and every table is a pure
 * roll-up of them. A figure on one report is then the figure on the next.
 *
 * THE CELL. One row per production date x shift x material x scale verdict
 * (`in_range`: passed / rejected / no verdict). A cell carries exact counts and
 * exact sums, so any roll-up — a shift over the period, a day, a yarn count,
 * the grand total — is arithmetic on cells, never a second query:
 *  - `kg`: every sack, weight basis and tare applied exactly as
 *    getSackSummary / production.ts apply them (a net basis subtracts the
 *    tare from each sack), so a kilogram figure here is the Sacks screen's.
 *  - `plausible` / `implausible`: the ONE population rule (coneState.ts
 *    `plausibleWhere`, both bounds, the plausibility rule as of the period
 *    end). Average, lightest, heaviest and standard deviation are over the
 *    plausible population only; the excluded count travels with them.
 *  - `sumD`, `sumD2`: the sums of d and d² over plausible sacks, where
 *    d = weight - a fixed centre. THE STANDARD DEVIATION IS COMPUTED FROM
 *    THESE, and from nothing else: n·Σx² − (Σx)² on raw 47.xx kg weights
 *    cancels ~14 digits and returns noise; centred on the plausibility
 *    window's midpoint (a constant, so cells can be summed) the cancellation
 *    is a few digits at worst. `rollup` re-centres if two cells ever carry
 *    different centres, so it is exact for any input, not only for ours.
 *
 * WHAT IS DELIBERATELY NOT HERE. Cones. The sack summary's cones-per-sack
 * stays in sacks.ts, where it already lives and is already labelled
 * approximate. A sack carries no winder or station at any layer (the plant's
 * one sack scale), so there is no station dimension and none may be added.
 *
 * ONE GENERATION. The cells, the bins and the list all bind the same
 * `SackContext` (generation scope + rules as of the period end), resolved
 * once and passed along — a report that asks for cells AND a list must not be
 * able to read them from two different source generations. By default the
 * generation is resolved over `sack_event` only: these reports read no other
 * table, and a note saying "N readings of another batch were left out" must
 * count sacks, not cones the report never shows.
 *
 * THE WHERE is `bindSackFilters` (sacks.ts), the predicate getSackSummary
 * binds — shift, product, tsTo, shift range, generation — not a copy.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { ShiftCode } from '@sms/shared';
import { plausibleWhere } from './coneState.js';
import { noteOf, resolveGenerationScope, type EventTable, type GenerationNote, type GenerationScope } from './generation.js';
import { getPlausibilityRuleAsOf, getWeightRuleAsOf, plantDayEndMs, plantDayStartMs } from './ruleAsOf.js';
import { bindSackFilters, type SackSummaryQuery } from './sacks.js';

/* ------------------------------------------------------------------ context */

/**
 * Everything a sack query needs that is not the data itself: the one
 * generation, the weight basis and the plausibility window as of the PERIOD
 * END (RT24-04: not "whatever is configured today"), and whether either rule
 * changed inside the period. Resolved once per report.
 */
export interface SackContext {
  scope: GenerationScope;
  generationNote: GenerationNote;
  /** `as_recorded` | `gross` | `net` — the rule in force at the period end; `as_recorded` when none is on file. */
  weightBasis: string;
  tareKg: number;
  /** What every weight is reduced by to put it on the basis: the tare under `net`, else 0. */
  adjKg: number;
  plausibility: { loKg: number; hiKg: number };
  weightRuleChangedInPeriod: boolean;
  plausibilityRuleChangedInPeriod: boolean;
}

export async function resolveSackContext(
  pool: ConnectionPool,
  lineId: number,
  q: SackSummaryQuery,
  opts: { tables?: readonly EventTable[] } = {},
): Promise<SackContext> {
  const scope = await resolveGenerationScope(pool, lineId, { from: q.from, to: q.to }, opts.tables ?? ['sack_event']);
  // As of the period end; the replay cap (tsTo) wins over `to`, exactly as
  // bindSackFilters gives it precedence in the WHERE.
  const periodEndPlantMs = q.tsTo ? new Date(q.tsTo).getTime() : plantDayEndMs(q.to);
  const periodStartPlantMs = plantDayStartMs(q.from);
  const [plausR, wrR] = await Promise.all([
    getPlausibilityRuleAsOf(pool, lineId, periodEndPlantMs, periodStartPlantMs),
    getWeightRuleAsOf(pool, lineId, periodEndPlantMs, periodStartPlantMs),
  ]);
  // JUSTIFIED `?? 'as_recorded'` / `?? 0`: an EMPTY weight_rule history is a
  // real, documented state (no basis ever configured), and 'as_recorded' with
  // no tare is the default every other sack figure in the app uses.
  const weightBasis = wrR.rule?.basis ?? 'as_recorded';
  const tareKg = wrR.rule?.sackTareKg ?? 0;
  return {
    scope,
    generationNote: noteOf(scope),
    weightBasis,
    tareKg,
    adjKg: weightBasis === 'net' ? tareKg : 0,
    plausibility: { loKg: plausR.rule.sackLoKg, hiKg: plausR.rule.sackHiKg },
    weightRuleChangedInPeriod: wrR.ruleChangedInPeriod,
    plausibilityRuleChangedInPeriod: plausR.ruleChangedInPeriod,
  };
}

/* -------------------------------------------------------------------- cells */

/** One production date x shift x material x scale verdict. */
export interface SackCell {
  /** `shift_date`, YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
  /** The sack's own material (since 5 Aug 2026); null on a sack that carries none. */
  materialId: number | null;
  /** The scale's own verdict: true = passed, false = rejected by the scale, null = no verdict recorded. */
  inRange: boolean | null;
  /** Sacks in the cell. */
  sacks: number;
  /** Kilograms over every sack in the cell, weight basis and tare applied. */
  kg: number;
  /** Sacks with a weight outside the plausibility window. */
  implausible: number;
  /** Sacks with a plausible weight — the population average / min / max / SD run over. */
  plausible: number;
  /** Kilograms over the plausible sacks, basis applied. */
  plausKg: number;
  /** Σd and Σd² over the plausible sacks, d = weight on the basis - `centreKg`. */
  sumD: number;
  sumD2: number;
  /** The constant d is measured from, on the report's basis. */
  centreKg: number;
  /** Lightest / heaviest plausible sack, basis applied; null when none is plausible. */
  minKg: number | null;
  maxKg: number | null;
}

export interface SackCellsResult {
  cells: SackCell[];
  weightBasis: string;
  tareKg: number;
  plausibility: { loKg: number; hiKg: number };
  generationNote: GenerationNote;
  weightRuleChangedInPeriod: boolean;
  plausibilityRuleChangedInPeriod: boolean;
}

interface CellRow {
  d: string;
  sc: string;
  mid: number | null;
  ir: boolean | number | null;
  n: number;
  kg: number;
  implausible: number;
  plaus_n: number;
  plaus_kg: number;
  sum_d: number;
  sum_d2: number;
  min_w: number | null;
  max_w: number | null;
}

/** Thousandths: sack weights are stored to 0.001 kg, so a rounded sum is exact. */
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

export async function getSackCells(
  pool: ConnectionPool,
  lineId: number,
  q: SackSummaryQuery,
  ctx?: SackContext,
): Promise<SackCellsResult> {
  const c = ctx ?? (await resolveSackContext(pool, lineId, q));
  // The window's midpoint on the RECORDED scale; d = weight - this. A constant
  // known before the query, so cells from separate queries stay summable.
  const refKg = (c.plausibility.loKg + c.plausibility.hiKg) / 2;
  const req = pool.request();
  const where = bindSackFilters(req, lineId, q, 'e.', true, c.scope, 'sack_event');
  const plausible = plausibleWhere(req, 'e.weight_kg', { loG: c.plausibility.loKg, hiG: c.plausibility.hiKg }, { prefix: 'sp' });
  req.input('refKg', mssql.Float, refKg);
  const d = `(CAST(e.weight_kg AS float) - @refKg)`;
  const r = await req.query<CellRow>(
    `SELECT CONVERT(varchar(10), e.shift_date, 23) AS d, e.shift_code AS sc, e.material_id AS mid, e.in_range AS ir,
            COUNT(*) AS n,
            ISNULL(SUM(e.weight_kg), 0) AS kg,
            SUM(CASE WHEN e.weight_kg IS NOT NULL AND NOT (${plausible}) THEN 1 ELSE 0 END) AS implausible,
            SUM(CASE WHEN ${plausible} THEN 1 ELSE 0 END) AS plaus_n,
            ISNULL(SUM(CASE WHEN ${plausible} THEN e.weight_kg ELSE 0 END), 0) AS plaus_kg,
            ISNULL(SUM(CASE WHEN ${plausible} THEN ${d} ELSE 0 END), 0) AS sum_d,
            ISNULL(SUM(CASE WHEN ${plausible} THEN ${d} * ${d} ELSE 0 END), 0) AS sum_d2,
            MIN(CASE WHEN ${plausible} THEN e.weight_kg END) AS min_w,
            MAX(CASE WHEN ${plausible} THEN e.weight_kg END) AS max_w
       FROM sms.sack_event e
      WHERE ${where}
      GROUP BY e.shift_date, e.shift_code, e.material_id, e.in_range
      ORDER BY e.shift_date, e.shift_code, e.material_id, e.in_range`,
  );
  const cells = r.recordset.map((row): SackCell => {
    const n = Number(row.n);
    const plausN = Number(row.plaus_n);
    return {
      date: String(row.d),
      shift: String(row.sc) as ShiftCode,
      materialId: row.mid == null ? null : Number(row.mid),
      inRange: row.ir == null ? null : Boolean(row.ir),
      sacks: n,
      // The same net-basis rule getSackSummary / production.ts apply: the tare
      // comes off every sack in the cell.
      kg: round3(Number(row.kg) - c.adjKg * n),
      implausible: Number(row.implausible),
      plausible: plausN,
      plausKg: round3(Number(row.plaus_kg) - c.adjKg * plausN),
      sumD: Number(row.sum_d),
      sumD2: Number(row.sum_d2),
      centreKg: refKg - c.adjKg,
      minKg: row.min_w == null ? null : round3(Number(row.min_w) - c.adjKg),
      maxKg: row.max_w == null ? null : round3(Number(row.max_w) - c.adjKg),
    };
  });
  return {
    cells,
    weightBasis: c.weightBasis,
    tareKg: c.tareKg,
    plausibility: c.plausibility,
    generationNote: c.generationNote,
    weightRuleChangedInPeriod: c.weightRuleChangedInPeriod,
    plausibilityRuleChangedInPeriod: c.plausibilityRuleChangedInPeriod,
  };
}

/* ------------------------------------------------------------------ roll-up */

/** What any set of cells says, exactly. */
export interface SackFigures {
  /** Every sack. */
  sacks: number;
  /** Kilograms over every sack, basis applied (unrounded sum of thousandths). */
  kg: number;
  /** Sacks the scale passed (`in_range = 1`). */
  passed: number;
  /** Sacks the scale REJECTED (`in_range = 0`) — the scale's own verdict, named as the scale's. */
  rejected: number;
  /** Sacks with no verdict recorded; counted apart, never as passes. */
  noFlag: number;
  implausible: number;
  plausible: number;
  /** Kilograms over the plausible sacks, basis applied. */
  plausKg: number;
  /** Mean of the plausible sacks, to 0.01 kg the way getSackSummary rounds it; null when none. */
  avgKg: number | null;
  minKg: number | null;
  maxKg: number | null;
  /** SAMPLE standard deviation (n - 1) of the plausible sacks, unrounded; null with fewer than two. */
  sdKg: number | null;
}

function foldCells(cells: readonly SackCell[]): SackFigures {
  let sacks = 0;
  let kgMilli = 0;
  let passed = 0;
  let rejected = 0;
  let noFlag = 0;
  let implausible = 0;
  let plausible = 0;
  let plausKgMilli = 0;
  let minKg: number | null = null;
  let maxKg: number | null = null;
  // Re-centre every cell on the first plausible cell's centre, so cells that
  // were centred differently still sum exactly: x - ref = (x - c) + (c - ref).
  const ref = cells.find((c) => c.plausible > 0)?.centreKg ?? 0;
  let s1 = 0;
  let s2 = 0;
  for (const c of cells) {
    sacks += c.sacks;
    kgMilli += Math.round(c.kg * 1000);
    if (c.inRange === true) passed += c.sacks;
    else if (c.inRange === false) rejected += c.sacks;
    else noFlag += c.sacks;
    implausible += c.implausible;
    if (c.plausible > 0) {
      plausible += c.plausible;
      plausKgMilli += Math.round(c.plausKg * 1000);
      const delta = c.centreKg - ref;
      s1 += c.sumD + c.plausible * delta;
      s2 += c.sumD2 + 2 * delta * c.sumD + c.plausible * delta * delta;
      if (c.minKg != null && (minKg == null || c.minKg < minKg)) minKg = c.minKg;
      if (c.maxKg != null && (maxKg == null || c.maxKg > maxKg)) maxKg = c.maxKg;
    }
  }
  const plausKg = plausKgMilli / 1000;
  return {
    sacks,
    kg: kgMilli / 1000,
    passed,
    rejected,
    noFlag,
    implausible,
    plausible,
    plausKg,
    // The same rounding getSackSummary's toGroup uses on the same sum.
    avgKg: plausible > 0 ? Math.round((100 * plausKg) / plausible) / 100 : null,
    minKg,
    maxKg,
    sdKg: plausible >= 2 ? Math.sqrt(Math.max(0, (s2 - (s1 * s1) / plausible) / (plausible - 1))) : null,
  };
}

/** Every cell together — the period's grand total. */
export function rollupAll(cells: readonly SackCell[]): SackFigures {
  return foldCells(cells);
}

/**
 * Cells grouped by `keyFn` and folded. A cell the function maps to null is
 * left out. Pure and exact: counts and weights are summed as integers
 * (thousandths of a kilogram) and the spread is rebuilt from the centred sums,
 * so `rollup(cells, c => c.shift)` agrees with a two-pass computation over the
 * raw sacks to rounding noise. Keys come back in order of first appearance;
 * the caller sorts them the way its table reads.
 */
export function rollup<K extends string>(
  cells: readonly SackCell[],
  keyFn: (c: SackCell) => K | null,
): Map<K, SackFigures> {
  const groups = new Map<K, SackCell[]>();
  for (const c of cells) {
    const k = keyFn(c);
    if (k == null) continue;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  const out = new Map<K, SackFigures>();
  for (const [k, g] of groups) out.set(k, foldCells(g));
  return out;
}

/* --------------------------------------------------------------------- bins */

/**
 * One bin of the weight histogram, split by shift and scale verdict.
 * `kind` separates the three populations a band table needs: sacks with a
 * plausible weight (binned), sacks with an implausible one (0 kg, a fault —
 * never binned), and sacks with no weight at all.
 */
export interface SackBinRow {
  kind: 'plausible' | 'implausible' | 'noWeight';
  /** FLOOR((weight on the basis) / binKg); null unless `kind` is 'plausible'. */
  bin: number | null;
  /** The bin's lower edge, kg, on the basis; null unless 'plausible'. The bin spans [fromKg, fromKg + binKg). */
  fromKg: number | null;
  shift: ShiftCode;
  inRange: boolean | null;
  sacks: number;
}

export interface SackBins {
  binKg: number;
  rows: SackBinRow[];
  weightBasis: string;
  plausibility: { loKg: number; hiKg: number };
  generationNote: GenerationNote;
}

const decimalsOf = (x: number): number => {
  const frac = String(x).split('.')[1];
  return frac ? Math.min(6, frac.length) : 0;
};

/**
 * The sacks of the period binned into `binKg` kilogram bins, by shift and
 * scale verdict. SQL does the counting; the merge into IFL's bands (and the
 * open-ended tails) is the report's pure function. `ROUND(.., 6)` before
 * `FLOOR`: 47.4 / 0.1 is 473.99999... in floating point and a sack at exactly
 * 47.4 kg must land in the 47.4 bin (weights.ts's K6 defect, 25 Sep 2026).
 */
export async function getSackBins(
  pool: ConnectionPool,
  lineId: number,
  q: SackSummaryQuery,
  binKg = 0.1,
  ctx?: SackContext,
): Promise<SackBins> {
  if (!(binKg > 0) || !Number.isFinite(binKg)) throw new Error('getSackBins: binKg must be a positive number');
  const c = ctx ?? (await resolveSackContext(pool, lineId, q));
  const req = pool.request();
  const where = bindSackFilters(req, lineId, q, 'e.', true, c.scope, 'sack_event');
  const plausible = plausibleWhere(req, 'e.weight_kg', { loG: c.plausibility.loKg, hiG: c.plausibility.hiKg }, { prefix: 'sp' });
  req.input('adjKg', mssql.Float, c.adjKg).input('binKg', mssql.Float, binKg);
  const r = await req.query<{ bin: number | null; kind: number; sc: string; ir: boolean | number | null; n: number }>(
    `SELECT bin, kind, sc, ir, COUNT(*) AS n FROM (
        SELECT CASE WHEN ${plausible} THEN FLOOR(ROUND((e.weight_kg - @adjKg) / @binKg, 6)) END AS bin,
               CASE WHEN e.weight_kg IS NULL THEN 2 WHEN ${plausible} THEN 0 ELSE 1 END AS kind,
               e.shift_code AS sc, e.in_range AS ir
          FROM sms.sack_event e
         WHERE ${where}
     ) x
     GROUP BY bin, kind, sc, ir
     ORDER BY kind, bin, sc, ir`,
  );
  const dp = decimalsOf(binKg);
  const kinds = ['plausible', 'implausible', 'noWeight'] as const;
  return {
    binKg,
    weightBasis: c.weightBasis,
    plausibility: c.plausibility,
    generationNote: c.generationNote,
    rows: r.recordset.map((row): SackBinRow => {
      const kind = kinds[Number(row.kind)] ?? 'plausible';
      const bin = kind === 'plausible' && row.bin != null ? Number(row.bin) : null;
      return {
        kind,
        bin,
        fromKg: bin == null ? null : Math.round(bin * binKg * 10 ** dp) / 10 ** dp,
        shift: String(row.sc) as ShiftCode,
        inRange: row.ir == null ? null : Boolean(row.ir),
        sacks: Number(row.n),
      };
    }),
  };
}

/* --------------------------------------------------------------------- list */

export interface SackListRow {
  sackEventId: number;
  date: string;
  shift: ShiftCode;
  /** The sack's time — the plant's INSERT time on the production-clock convention (milliseconds, render in UTC). */
  producedAtMs: number;
  sackNum: number | null;
  materialId: number | null;
  inRange: boolean | null;
  /** The weight as the scale recorded it; null when none. */
  weightKg: number | null;
  /** The same weight on the report's basis (a net basis subtracts the tare); null when none. */
  weightOnBasisKg: number | null;
  /** A weight outside the plausibility window (0 kg, a fault reading); false when there is no weight at all. */
  implausible: boolean;
}

export interface SackList {
  rows: SackListRow[];
  /** What the period holds that matches, before the cap (clock-fault rows excluded). */
  total: number;
  cap: number;
  /** Matching sacks with a zeroed clock (production time at or before the epoch): they sit in no period and are left out of `rows` and `total`. */
  excludedClockFault: number;
  weightBasis: string;
  plausibility: { loKg: number; hiKg: number };
  generationNote: GenerationNote;
}

export interface SackListOpts {
  /** true = passed, false = rejected by the scale, null = no verdict; omit for every sack. */
  inRange?: boolean | null;
  /** The most rows returned; `total` still says what there is. */
  cap: number;
  ctx?: SackContext;
}

/**
 * The sacks themselves, oldest first, capped. The count and the rows share
 * one predicate (filters + generation + the optional verdict), so `total` can
 * never disagree with what a screen would list.
 */
export async function listSacks(
  pool: ConnectionPool,
  lineId: number,
  q: SackSummaryQuery,
  opts: SackListOpts,
): Promise<SackList> {
  const c = opts.ctx ?? (await resolveSackContext(pool, lineId, q));
  const cap = Math.max(0, Math.floor(opts.cap));
  const verdictClause = (): string => {
    if (opts.inRange === undefined) return '';
    if (opts.inRange === null) return ' AND e.in_range IS NULL';
    return opts.inRange ? ' AND e.in_range = 1' : ' AND e.in_range = 0';
  };

  const countReq = pool.request();
  const countWhere = bindSackFilters(countReq, lineId, q, 'e.', true, c.scope, 'sack_event') + verdictClause();
  const counts = await countReq.query<{ listed: number | null; clock: number | null }>(
    `SELECT SUM(CASE WHEN e.production_ts_utc_ms > 0 THEN 1 ELSE 0 END) AS listed,
            SUM(CASE WHEN e.production_ts_utc_ms <= 0 THEN 1 ELSE 0 END) AS clock
       FROM sms.sack_event e WHERE ${countWhere}`,
  );

  const rowReq = pool.request();
  const rowWhere = bindSackFilters(rowReq, lineId, q, 'e.', true, c.scope, 'sack_event') + verdictClause();
  rowReq.input('listCap', mssql.Int, cap);
  const r = await rowReq.query<{
    id: number; d: string; sc: string; ts: number; num: number | null; mid: number | null; ir: boolean | number | null; w: number | null;
  }>(
    `SELECT TOP (@listCap) e.sack_event_id AS id, CONVERT(varchar(10), e.shift_date, 23) AS d, e.shift_code AS sc,
            e.production_ts_utc_ms AS ts, e.sack_num AS num, e.material_id AS mid, e.in_range AS ir, e.weight_kg AS w
       FROM sms.sack_event e
      WHERE ${rowWhere} AND e.production_ts_utc_ms > 0
      ORDER BY e.production_ts_utc_ms, e.sack_event_id`,
  );
  const { loKg, hiKg } = c.plausibility;
  return {
    rows: r.recordset.map((row): SackListRow => {
      const w = row.w == null ? null : Number(row.w);
      return {
        sackEventId: Number(row.id),
        date: String(row.d),
        shift: String(row.sc) as ShiftCode,
        producedAtMs: Number(row.ts),
        sackNum: row.num == null ? null : Number(row.num),
        materialId: row.mid == null ? null : Number(row.mid),
        inRange: row.ir == null ? null : Boolean(row.ir),
        weightKg: w,
        weightOnBasisKg: w == null ? null : round3(w - c.adjKg),
        implausible: w != null && !(w >= loKg && w <= hiKg),
      };
    }),
    total: Number(counts.recordset[0]?.listed ?? 0),
    cap,
    excludedClockFault: Number(counts.recordset[0]?.clock ?? 0),
    weightBasis: c.weightBasis,
    plausibility: c.plausibility,
    generationNote: c.generationNote,
  };
}
