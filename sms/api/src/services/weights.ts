/**
 * Weight consistency (Q4/Q5). Distribution + stats + outliers for cones and
 * sacks, computed under a chosen basis (as_recorded | gross | net). The basis
 * toggle makes the gross-vs-net swing visible — the reason Q5 matters: a ~70 g
 * tube on a ~1951 g cone is ~3.6% of every yield figure.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { plausibleWhere } from './coneState.js';
import {
  epochFragment, noteOf, resolveGenerationScope,
  type GenerationNote,
} from './generation.js';
import { getPlausibilityRuleAsOf, getWeightRuleAsOf, plantDayEndMs, plantDayStartMs, type RuleAsOfResult, type WeightRule } from './ruleAsOf.js';
import { plantNowMs } from '@sms/shared';
import { shiftOrd, shiftRangeClause, type ShiftRange } from '../shiftRange.js';

export type Basis = 'as_recorded' | 'gross' | 'net';

export interface Bucket { bucket: number; count: number; }
/**
 * `eventId` is the canonical PK (cone_event_id / sack_event_id), which is what
 * the register's permalink takes. It was source_row_id until the 2026-08-05
 * source rebuild made that number name two rows (register.ts, IDENTITY).
 */
export interface Outlier { weight: number; shiftDate: string | null; eventId: number | null; }

export interface WeightStats {
  count: number;
  /**
   * Readings the population rule excluded as implausible (roadmap Phase 4,
   * 14 Sep 2026) — the same figure spc.ts and the reconciliation report.
   * `outliers` below lists a sample of them deliberately.
   */
  implausible: number;
  avg: number | null;
  /**
   * The median of the same population as `avg` (roadmap Phase 9 item 1,
   * 15 Sep 2026). Printed beside the mean because the two disagree exactly
   * when the distribution is skewed â€” a tail of heavy cones pulls the mean
   * up while the typical cone sits where the median says.
   */
  median: number | null;
  min: number | null;
  max: number | null;
  stdev: number | null;
  unit: 'g' | 'kg';
  /**
   * The histogram's bucket width, in `unit`, DERIVED from this population's
   * own spread rather than declared (see TARGET_BINS below). It therefore
   * varies between calls — by period, by basis and by source generation —
   * and it is fractional for sacks. Always print it beside the chart: two
   * histograms of the same readings at different widths are not comparable
   * bar for bar, and a reader who cannot see the width cannot know that.
   */
  bucketSize: number;
  /** Bucket START value (not the index), spaced `bucketSize` apart. Sparse: empty buckets are omitted. */
  histogram: Bucket[];
  outliers: Outlier[];
}

/**
 * HISTOGRAM RESOLUTION — derived from the readings, never declared.
 *
 * Until 23 Sep 2026 the two histograms were binned at two hardcoded widths,
 * 20 g for cones and 1 kg for sacks, and both were wrong for the data IFL
 * actually sends. Measured on this sidecar, over IFL's own generations only:
 *
 *   sacks, gen 1 (epoch 2, 22 Jun - 10 Jul): sd 0.121 kg — 5,438 of 5,459
 *     readings (99.6 %) fell in the single 47 kg bucket. The chart was ONE
 *     BAR. Gen 3 (epoch 10) is the same: 5,398 of 5,431.
 *   cones, gen 1 (epoch 1): sd 8.86 g — 107,834 of 142,296 (75.8 %) in the
 *     single 1940 g bucket, three bars in total. Less visibly broken than
 *     the sack chart, and broken the same way: a 20 g bucket is 2.3 sd wide.
 *
 * A histogram whose bucket is wider than the spread it is drawing cannot
 * show a distribution, which is the only thing it is for. So the width is
 * now computed from each population's OWN spread, per call, per basis, per
 * generation — a sack chart and a cone chart no longer share a rule beyond
 * the target resolution below, and neither carries a constant in grams or
 * kilograms anywhere.
 *
 *  1. Aim for `TARGET_BINS` bins across +/-4 sd of the readings in hand, so
 *     raw width = 8 sd / TARGET_BINS. This is NOT a new idea in this
 *     application: `spc.ts` bins its own distribution chart over exactly
 *     +/-4 sd at exactly 32 bins (its `HIST_BINS`), and matching it keeps
 *     ONE histogram resolution in the app rather than a second one that has
 *     to be explained beside the first. It is duplicated rather than
 *     imported because it is a local rendering target, not a shared
 *     contract, and spc.ts is held open by another worker.
 *  2. Snap that to the nearest 1/2/5 x 10^k, so the x-axis labels a reader
 *     sees are round numbers (47.20, 47.22) and not 47.2094.
 *
 * FREEDMAN-DIACONIS WAS TRIED FIRST AND REJECTED, with numbers: 2*IQR*n^-1/3
 * gives 0.46 g for the cone population (IQR 12 g, n 142,296), which is ~990
 * bins across the plausible range — far past what `Histogram` can draw, its
 * bars having a 2px floor. FD is the right rule at survey sample sizes and
 * the wrong one at n in the hundreds of thousands, where it optimises for a
 * resolution no screen has. The sd rule degrades gracefully at both ends.
 *
 * What this produces on the real generations, verified by query before it
 * was written: cones 2 g (81 non-empty bars, modal bar 9.5 % of readings —
 * a bell), sacks 0.02 kg on gen 1 (47 bars) and 0.05 kg on gen 3 (31 bars).
 */
const TARGET_BINS = 32;

/**
 * The nearest 1, 2 or 5 times a power of ten — the standard axis-tick
 * ladder. Written out rather than pulled in because the app has no charting
 * dependency and is not getting one.
 */
export function niceWidth(raw: number): number {
  const e = Math.floor(Math.log10(raw));
  const f = raw / 10 ** e;
  const m = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  // Built by division for a negative exponent so 2 x 10^-2 is 0.02 exactly
  // and not 0.020000000000000004 printed as a bucket label.
  return e >= 0 ? m * 10 ** e : m / 10 ** -e;
}

/**
 * The bucket width for one population. `stdev` is the measure of spread we
 * already have from the same query and the same population predicate.
 *
 * Both fallbacks are for degenerate populations, not for missing data:
 * STDEV() is NULL at n < 2, and zero when every reading is identical. A
 * single distinct value genuinely IS one bar, so the last resort returns a
 * positive width rather than pretending to a resolution the data has not
 * got.
 */
export function binWidth(stdev: number | null, min: number | null, max: number | null): number {
  const spread =
    stdev != null && stdev > 0
      ? 8 * stdev
      : min != null && max != null && max > min
        ? max - min
        : 0;
  if (!(spread > 0) || !Number.isFinite(spread)) return 1;
  return niceWidth(spread / TARGET_BINS);
}

/** Decimals a bucket label needs at this width: 0.02 -> 2, 2 -> 0. */
function bucketDecimals(width: number): number {
  return Math.max(0, -Math.floor(Math.log10(width)));
}

/** Where the nominal the giveaway is measured against actually came from. */
export type NominalSource = 'current_product' | 'fallback';

export interface WeightsData {
  basis: Basis;
  cone: WeightStats & {
    nominalSetpointG: number;
    nominalSource: NominalSource;
    nominalLabel: string | null;
    /** Non-empty = the giveaway figure is NOT safe to quote. */
    provisionalReasons: string[];
    giveawayPerConeG: number | null;
    giveawayTotalKg: number | null;
  };
  sack: WeightStats;
  note: string;
  /**
   * Which SOURCE GENERATION these distributions were computed from, and how
   * many readings in the same period belong to another one and were therefore
   * NOT included (generation.ts, 23 Sep 2026). Before this the mean cone
   * weight over a range spanning IFL's 2026-08-05 rebuild — or, on this dev
   * copy, spanning the plant simulator — was a mean of two physically
   * different populations presented as one.
   */
  generationNote?: GenerationNote;
  /** RT24-04: true when sms.weight_rule or sms.plausibility_rule changed inside [from, to]. */
  weightRuleChangedInPeriod?: boolean;
  plausibilityRuleChangedInPeriod?: boolean;
}

/**
 * Last-resort nominal, used only when no product has been selected.
 *
 * This was previously the ONLY reference in the code, hardcoded, and it drives
 * the giveaway kg/day and t/year figures — the most quotable numbers in the app.
 * Two things make that dangerous, so both are now reported instead of hidden:
 *
 *  1. The real setpoint is per-product (the product master holds 1950 and 1960
 *     with ±30/40/50 offsets), so a single constant is wrong for some products
 *     by more than the giveaway it is trying to measure.
 *  2. Q4/Q5 (gross vs net) is still unanswered. Note that the basis TOGGLE no
 *     longer moves the giveaway: since the nominal became basis-aware below
 *     (nominalGross - coneAdj), switching to net shifts the measured average and
 *     the target by the same tube weight, so avg - nominal is invariant. It was
 *     not always so — against the old hardcoded 1950 g fallback the toggle did
 *     swing +1.5 to -68.5 g/cone, and that stale figure survived in the
 *     user-facing caveat long after the code stopped producing it.
 *
 *     The live risk is different and still real: if the product setpoint is
 *     stated on the OPPOSITE basis to the recorded weight, the giveaway is out
 *     by the full tube weight. That is what Q4/Q5 has to settle.
 *
 * Historical rows also carry no product attribution (attribution_method='none'),
 * so applying the currently-selected product's setpoint backwards over the range
 * is an approximation — flagged, not silently applied.
 */
const FALLBACK_CONE_SETPOINT_G = 1950;

/**
 * The weight_rule row every basis-aware figure in the app reads — the same
 * table production.ts, sacks.ts and sackStock.ts each query for `basis`/
 * `tare` (those already read the CONFIGURED basis; they were never the
 * defect). Centralised here so a caller that needs only the basis, not the
 * full distribution `getWeights` computes below, has one place to get it
 * from rather than a second copy of this query (H8, 15 Sep 2026).
 */
/**
 * RT24-04, 24 Sep 2026: reads the rule AS OF `atPlantMs` (the period end
 * when one is known, else "now") rather than whatever is configured today —
 * the same "as of", not "right now", switch production.ts/sacks.ts/
 * sackStock.ts make for this table. `getConfiguredBasis` (below) still means
 * "right now" — its own callers ask for exactly that, Setup's current value.
 */
async function loadWeightRule(
  pool: ConnectionPool,
  lineId: number,
  atPlantMs: number,
  fromPlantMs?: number,
): Promise<{ basis: Basis; tube: number; tare: number; ruleChangedInPeriod: boolean }> {
  const wr: RuleAsOfResult<WeightRule | null> = await getWeightRuleAsOf(pool, lineId, atPlantMs, fromPlantMs);
  const raw = wr.rule?.basis;
  const basis: Basis = raw === 'gross' || raw === 'net' ? raw : 'as_recorded';
  return {
    basis,
    tube: wr.rule?.coneTubeWeightG ?? 70,
    tare: wr.rule?.sackTareKg ?? 0.5,
    ruleChangedInPeriod: wr.ruleChangedInPeriod,
  };
}

/**
 * The basis Setup has on file for this line right now (H8, 15 Sep 2026) —
 * what a caller should default to rather than assuming `as_recorded`, so
 * the report builders and the sack summary can never disagree with the
 * envelope's own `weightBasis` about the same kilograms. Exported for sites
 * that need only the basis, not the distribution (see sack.ts's shift
 * branch, which skips `getWeights` itself on purpose).
 */
export async function getConfiguredBasis(pool: ConnectionPool, lineId: number): Promise<Basis> {
  return (await loadWeightRule(pool, lineId, plantNowMs())).basis;
}

export async function getWeights(
  pool: ConnectionPool,
  lineId: number,
  /**
   * Pass a value to force a specific view (the /api/weights basis toggle);
   * omit it (undefined) to use whatever Setup has on file — every caller
   * except that one toggle should omit it (H8, 15 Sep 2026: this used to be
   * hardcoded 'as_recorded' at every report call site, silently ignoring
   * the configured basis).
   */
  basis: Basis | undefined,
  from?: string,
  to?: string,
  /**
   * Chart overhaul wave 2 (Task TB1, 28 Sep 2026): an OPTIONAL shift-bounded
   * refinement of `[from, to]` (shiftRange.ts). This whole function is
   * period-scoped — there is no trailing/detector window here — so the
   * range is ANDed into `dateWhere` alongside `from`/`to`, for both cone and
   * sack tables. Absent, behaviour is byte-identical to before this task.
   */
  shiftRange?: ShiftRange,
): Promise<WeightsData> {
  // RT24-04: as of the PERIOD END (`to`, else "now" for an unbounded call),
  // not whatever is configured today.
  const periodEndPlantMs = to ? plantDayEndMs(to) : plantNowMs();
  const periodStartPlantMs = from ? plantDayStartMs(from) : undefined;
  const rule = await loadWeightRule(pool, lineId, periodEndPlantMs, periodStartPlantMs);
  // Explicit override wins; otherwise fall back to the configured basis.
  basis = basis ?? rule.basis;
  const tube = rule.tube;
  const tare = rule.tare;
  const coneAdj = basis === 'net' ? tube : 0;
  const sackAdj = basis === 'net' ? tare : 0;

  // ONE generation for both tables and every query below, resolved once —
  // see generation.ts. The fragment is built here and the parameters bound in
  // `bind()` because the SAME where-string is run on a dozen separate
  // requests in this function.
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'sack_event']);
  const coneEpoch = epochFragment(scope, 'cone_event');
  const sackEpoch = epochFragment(scope, 'sack_event');

  // SHIFT RANGE (chart overhaul wave 2, Task TB1, 28 Sep 2026). Same
  // multi-request shape as `coneEpoch`/`sackEpoch` just above: the fragment's
  // SQL text is deterministic (fixed parameter names, `col`/`shift_code` are
  // always unaliased here — neither query in this file joins another table
  // under an alias), so it is computed once, folded into `dateWhere`, and the
  // VALUES are bound per request via `bindShift`, called alongside `bind()`
  // below. `shiftRangeClause` couples text-generation to binding (unlike
  // `epochFragment`/`epochWhere`'s deliberate split), so the one-off
  // `pool.request()` here is used only to extract that deterministic text;
  // nothing is ever executed on it. `shiftRange` is undefined for every
  // existing caller, so `shiftClauseSql` is null and this is a no-op —
  // behaviour is byte-identical to before this task.
  const shiftClauseSql = shiftRange ? shiftRangeClause(shiftRange, { date: 'shift_date', code: 'shift_code' }, pool.request()) : null;
  const bindShift = (r: mssql.Request) => {
    if (!shiftRange) return;
    r.input('srFrom', mssql.Date, shiftRange.from);
    r.input('srFromOrd', mssql.Int, shiftOrd(shiftRange.fromShift));
    r.input('srTo', mssql.Date, shiftRange.to);
    r.input('srToOrd', mssql.Int, shiftOrd(shiftRange.toShift));
  };
  const dateWhere = (table: 'cone' | 'sack', col = 'shift_date') => {
    const w: string[] = ['line_id=@line'];
    if (from) w.push(`${col} >= @from`);
    if (to) w.push(`${col} <= @to`);
    const e = table === 'cone' ? coneEpoch.sql : sackEpoch.sql;
    if (e) w.push(e);
    if (shiftClauseSql) w.push(shiftClauseSql);
    return w.join(' AND ');
  };
  // --- cones (grams) / sacks (kg): the population is the ONE plausibility
  // rule (coneState.ts plausibleWhere — roadmap Phase 4, 14 Sep 2026). Until
  // then this file used the LOWER bound only, so its average kept the
  // ~2200-2354 g scale-fault population spc.ts drops, and "the app's average
  // cone weight" was two different numbers on two screens. Both bounds now,
  // everywhere a statistic is computed. The `outliers` sample is the one
  // deliberate exception: it LISTS the excluded readings, which is the point
  // of it, and says so with includeImplausible.
  const plausR = await getPlausibilityRuleAsOf(pool, lineId, periodEndPlantMs, periodStartPlantMs);
  const plausibility = plausR.rule;
  const conePlaus = { loG: plausibility.coneLoG, hiG: plausibility.coneHiG };
  const sackPlaus = { loG: plausibility.sackLoKg, hiG: plausibility.sackHiKg };

  // Every value that varies at runtime is bound, not interpolated. The tare/tube
  // adjustments come from sms.weight_rule (database-sourced, so not user input)
  // and the thresholds are module constants — nothing here was exploitable. But
  // DEPLOY.md hard rule 3 and CLAUDE.md rule 3 both state "parameterised queries
  // only", and a rule with silent exceptions is worse than no rule: the next
  // person to add a filter here copies the surrounding style. Make the claim true.
  const bind = (r: mssql.Request) => {
    r.input('line', mssql.Int, lineId);
    if (from) r.input('from', mssql.Date, from);
    if (to) r.input('to', mssql.Date, to);
    r.input('coneAdj', mssql.Float, coneAdj);
    r.input('sackAdj', mssql.Float, sackAdj);
    for (const pr of [...coneEpoch.params, ...sackEpoch.params]) r.input(pr.name, mssql.Int, pr.id);
    bindShift(r);
    return r;
  };
  /** A request with the cone population predicate bound; returns [request, predicate]. */
  const coneReq = (opts?: { includeImplausible: boolean }): [mssql.Request, string] => {
    const r = bind(pool.request());
    return [r, plausibleWhere(r, 'weight_g', conePlaus, opts)];
  };
  const sackReq = (opts?: { includeImplausible: boolean }): [mssql.Request, string] => {
    const r = bind(pool.request());
    return [r, plausibleWhere(r, 'weight_kg', sackPlaus, opts)];
  };

  const [csReq, csPlaus] = coneReq();
  const coneStat = await csReq.query<{ n: number; avg: number; mn: number; mx: number; sd: number; excluded: number }>(
    `SELECT COUNT(*) n, AVG(weight_g - @coneAdj) avg, MIN(weight_g - @coneAdj) mn,
            MAX(weight_g - @coneAdj) mx, STDEV(weight_g - @coneAdj) sd,
            (SELECT COUNT(*) FROM sms.cone_event WHERE ${dateWhere('cone')} AND weight_g IS NOT NULL AND NOT (${csPlaus})) excluded
     FROM sms.cone_event WHERE ${dateWhere('cone')} AND ${csPlaus}`,
  );
  // The median, from the SAME population predicate as the statistics above.
  // PERCENTILE_CONT is a window function; TOP 1 keeps one row of the constant.
  const [cmReq, cmPlaus] = coneReq();
  const coneMed = await cmReq.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weight_g - @coneAdj) OVER () med
     FROM sms.cone_event WHERE ${dateWhere('cone')} AND ${cmPlaus}`,
  );
  // The width comes from the population just measured — see binWidth. Note
  // the BIN INDEX is what SQL groups and returns; the bucket's start value is
  // multiplied out in JS below. Doing the multiply in SQL over a float width
  // produced labels like 47.120000000000005, which is a real thing a reader
  // would have had to look at.
  const cs0 = coneStat.recordset[0]!;
  const coneBucket = binWidth(
    cs0.sd == null ? null : Number(cs0.sd),
    cs0.mn == null ? null : Number(cs0.mn),
    cs0.mx == null ? null : Number(cs0.mx),
  );
  const coneDp = bucketDecimals(coneBucket);
  const [chReq, chPlaus] = coneReq();
  chReq.input('coneBucket', mssql.Float, coneBucket);
  const coneHist = await chReq.query<{ bin: number; count: number }>(
    `SELECT FLOOR(ROUND((weight_g - @coneAdj)/@coneBucket, 6)) bin, COUNT(*) count
     FROM sms.cone_event WHERE ${dateWhere('cone')} AND ${chPlaus}
     GROUP BY FLOOR(ROUND((weight_g - @coneAdj)/@coneBucket, 6)) ORDER BY bin`,
  );
  // The excluded readings themselves, lightest first — shown, on purpose.
  const [coReq, coAll] = coneReq({ includeImplausible: true });
  const coneOut = await coReq.query<{ w: number; d: string; id: number }>(
    `SELECT TOP 20 weight_g - @coneAdj w, CONVERT(varchar(10), shift_date, 120) d, cone_event_id id
     FROM sms.cone_event WHERE ${dateWhere('cone')} AND ${coAll} AND NOT (weight_g BETWEEN @plausLo AND @plausHi) ORDER BY weight_g`,
  );

  const [ssReq, ssPlaus] = sackReq();
  const sackStat = await ssReq.query<{ n: number; avg: number; mn: number; mx: number; sd: number; excluded: number }>(
    `SELECT COUNT(*) n, AVG(weight_kg - @sackAdj) avg, MIN(weight_kg - @sackAdj) mn,
            MAX(weight_kg - @sackAdj) mx, STDEV(weight_kg - @sackAdj) sd,
            (SELECT COUNT(*) FROM sms.sack_event WHERE ${dateWhere('sack')} AND weight_kg IS NOT NULL AND NOT (${ssPlaus})) excluded
     FROM sms.sack_event WHERE ${dateWhere('sack')} AND ${ssPlaus}`,
  );
  const [smReq, smPlaus] = sackReq();
  const sackMed = await smReq.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weight_kg - @sackAdj) OVER () med
     FROM sms.sack_event WHERE ${dateWhere('sack')} AND ${smPlaus}`,
  );
  const ss0 = sackStat.recordset[0]!;
  const sackBucket = binWidth(
    ss0.sd == null ? null : Number(ss0.sd),
    ss0.mn == null ? null : Number(ss0.mn),
    ss0.mx == null ? null : Number(ss0.mx),
  );
  const sackDp = bucketDecimals(sackBucket);
  const [shReq, shPlaus] = sackReq();
  shReq.input('sackBucket', mssql.Float, sackBucket);
  // ROUND before FLOOR (verification 25 Sep 2026, K6): 49.40 / 0.05 is
  // 987.9999… in floating point, so FLOOR put the heaviest sack in the
  // 49.35 bucket. Six decimals is far below any real bucket boundary.
  const sackHist = await shReq.query<{ bin: number; count: number }>(
    `SELECT FLOOR(ROUND((weight_kg - @sackAdj)/@sackBucket, 6)) bin, COUNT(*) count
     FROM sms.sack_event WHERE ${dateWhere('sack')} AND ${shPlaus}
     GROUP BY FLOOR(ROUND((weight_kg - @sackAdj)/@sackBucket, 6)) ORDER BY bin`,
  );
  const [soReq, soAll] = sackReq({ includeImplausible: true });
  const sackOut = await soReq.query<{ w: number; d: string; id: number }>(
    `SELECT TOP 20 weight_kg - @sackAdj w, CONVERT(varchar(10), shift_date, 120) d, sack_event_id id
     FROM sms.sack_event WHERE ${dateWhere('sack')} AND ${soAll} AND NOT (weight_kg BETWEEN @plausLo AND @plausHi) ORDER BY weight_kg`,
  );

  // Nominal comes from the product actually selected for this line, when one is.
  // The net-basis adjustment must be applied to it too, otherwise a net-basis
  // average is compared against a gross setpoint and the whole tube weight shows
  // up as fake "underfill" — which is most of the -68.5 g/cone seen on net.
  const npRes = await pool.request().input('line', mssql.Int, lineId).query<{
    sp: number | null; descr: string | null; lot: string | null; pid: number | null;
  }>(
    `SELECT TOP 1 p.setpoint_weight_g AS sp, p.description AS descr, p.lot_code AS lot, p.product_id AS pid
     FROM sms.product_timeline t
     JOIN sms.product p ON p.product_id = t.product_id
     WHERE t.line_id = @line AND t.superseded = 0 AND p.setpoint_weight_g IS NOT NULL
     ORDER BY t.effective_from DESC, t.timeline_id DESC`,
  );
  const np = npRes.recordset[0];
  const nominalSource: NominalSource = np?.sp != null ? 'current_product' : 'fallback';
  const nominalGross = np?.sp != null ? Number(np.sp) : FALLBACK_CONE_SETPOINT_G;
  const nominalSetpointG = Math.round((nominalGross - coneAdj) * 10) / 10;
  const nominalLabel =
    np?.sp != null ? (np.descr || np.lot || `product ${np.pid}`) : null;

  // Everything that makes the giveaway figure unquotable, stated explicitly so
  // the UI cannot present it as settled and nobody can quote it by accident.
  const provisionalReasons: string[] = [];
  // Fires on EVERY basis. It used to fire only on 'as_recorded', so choosing
  // Gross silently removed the warning while changing nothing at all — picking
  // a basis is not the same as IFL confirming which one is right.
  provisionalReasons.push(
    basis === 'net'
      ? `Weight basis is unconfirmed (Q4/Q5). Net subtracts the ${tube} g tube from both the measured cone and the ${nominalGross} g setpoint, so the giveaway is unchanged; what is unconfirmed is whether the setpoint itself is stated gross or net. If it is stated on the opposite basis to the recorded weight, this figure is out by ${tube} g/cone.`
      : `Weight basis is unconfirmed (Q4/Q5). Recorded weights are treated as gross${basis === 'gross' ? ' — the Gross and As-recorded views are therefore identical until IFL confirms otherwise' : ''}. If the recorded weight is actually net, or the ${nominalGross} g setpoint is stated on the other basis, this figure is out by the ${tube} g tube weight.`,
  );
  if (nominalSource === 'fallback') {
    provisionalReasons.push(
      `No product selected, so giveaway is measured against a fallback ${FALLBACK_CONE_SETPOINT_G} g. Real setpoints are per-product (1950 and 1960 g in the product master).`,
    );
  } else {
    provisionalReasons.push(
      `Measured against the currently-selected product (${nominalLabel}). Historical cones carry no product attribution, so applying today's setpoint across the whole range is an approximation.`,
    );
  }

  const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  /** Bin index -> the bucket's start value, at the width's own precision. */
  const toBuckets = (rs: { bin: number; count: number }[], width: number, dp: number): Bucket[] =>
    rs.map((b) => ({
      bucket: Math.round(Number(b.bin) * width * 10 ** dp) / 10 ** dp,
      count: b.count,
    }));
  const cs = coneStat.recordset[0]!;
  const coneAvg = num(cs.avg);
  const giveawayPerConeG = coneAvg == null ? null : Math.round((coneAvg - nominalSetpointG) * 10) / 10;
  const giveawayTotalKg = giveawayPerConeG == null ? null : Math.round((giveawayPerConeG * cs.n) / 100) / 10;
  const ss = sackStat.recordset[0]!;

  const mapOut = (rs: { w: number; d: string; id: number }[]): Outlier[] =>
    rs.map((r) => ({ weight: Math.round(Number(r.w) * 100) / 100, shiftDate: r.d, eventId: r.id == null ? null : Number(r.id) }));

  return {
    basis,
    cone: {
      count: cs.n, implausible: Number(cs.excluded ?? 0), avg: coneAvg, median: num(coneMed.recordset?.[0]?.med), min: num(cs.mn), max: num(cs.mx), stdev: num(cs.sd),
      unit: 'g', bucketSize: coneBucket,
      histogram: toBuckets(coneHist.recordset, coneBucket, coneDp),
      outliers: mapOut(coneOut.recordset),
      nominalSetpointG, nominalSource, nominalLabel, provisionalReasons,
      giveawayPerConeG, giveawayTotalKg,
    },
    sack: {
      count: ss.n, implausible: Number(ss.excluded ?? 0), avg: num(ss.avg), median: num(sackMed.recordset?.[0]?.med), min: num(ss.mn), max: num(ss.mx), stdev: num(ss.sd),
      unit: 'kg', bucketSize: sackBucket,
      histogram: toBuckets(sackHist.recordset, sackBucket, sackDp),
      outliers: mapOut(sackOut.recordset),
    },
    note:
      basis === 'net'
        ? `Net basis: cone tube ${tube} g and sack tare ${tare} kg subtracted from both the readings and the setpoint.`
        : basis === 'gross'
          ? `Gross basis: readings as the PLC recorded them. Identical to As-recorded until IFL confirms the basis (Q4/Q5).`
          : `Weights as the PLC recorded them.`,
    generationNote: noteOf(scope),
    weightRuleChangedInPeriod: rule.ruleChangedInPeriod,
    plausibilityRuleChangedInPeriod: plausR.ruleChangedInPeriod,
  };
}
