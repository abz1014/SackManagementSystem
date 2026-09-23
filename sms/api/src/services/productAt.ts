/**
 * Which product was in force when a given cone was weighed — and therefore
 * which limits that cone may be judged against.
 *
 * WHY THIS EXISTS. Until now the app answered "is this cone inside the
 * product's limits?" by reading `/api/current-product`: the product recorded
 * TODAY, applied to every reading regardless of when it was weighed. For any
 * historical reading that is simply the wrong tolerance, and for the 142,000
 * readings that predate the product register altogether there is no product at
 * all — yet the screen still printed a difference, computed against a product
 * that had nothing to do with them. Both critics refused to sign a design that
 * kept doing this.
 *
 * WHAT THE HONEST ANSWER LOOKS LIKE. Three outcomes, and the UI must be able
 * to tell them apart:
 *   - a product was in force  -> limits, and a signed distance from them
 *   - no product was recorded then -> say so; compute nothing
 *   - the product is known but carries no setpoint -> say so; compute nothing
 *
 * THE STATUS VOCABULARY. The scale's own in-range bit stays the single flag on
 * every screen ("Passed" / "Rejected by the scale"). The product tolerance is a
 * SECOND, separately-named fact, because the two disagree on about a thousand
 * cones in the record and a screen that says "outside limits" without saying
 * which one is the defect IFL objected to.
 *
 * The timeline is a handful of rows, so it is loaded once and resolved in
 * memory rather than joined per reading — a correlated lookup per row would
 * cost far more than the whole table.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { classifyConeDetail, isPlausibleWeight, type ConeState } from '@sms/shared';
import { toPlantMs } from './plantClock.js';
import { getPlausibilityRule } from './admin.js';
import type { ProductCatalogue } from './productLimits.js';
import { resolveGenerationScope, epochWhere, noteOf, type GenerationNote } from './generation.js';

export interface ProductInForce {
  productId: number;
  label: string;
  setpointG: number | null;
  weightOffsetMinusG: number | null;
  weightOffsetPlusG: number | null;
  /**
   * When this product started applying, expressed on the PRODUCTION-TIME
   * convention so it is directly comparable with a reading's timestamp.
   * See plantClock.ts: the stored value is genuine UTC and would otherwise be
   * five hours adrift of the readings it is meant to bracket.
   */
  effectiveFromMs: number;
  effectiveFromUtc: string;
}

export interface ProductLimits {
  targetG: number;
  loG: number;
  hiG: number;
  /** "1,960 +/- 40 g", ready to print. */
  label: string;
}

/** Why a reading has no product verdict. Printed as-is rather than hidden. */
export type NoProductReason = 'no_product_recorded' | 'no_setpoint';

export interface ProductVerdict {
  product: ProductInForce | null;
  limits: ProductLimits | null;
  /** Signed grams outside the limits; 0 when inside. Null when unjudgeable. */
  outsideByG: number | null;
  inside: boolean | null;
  reason: NoProductReason | null;
  /**
   * Where the product came from. 'row' is the plant's own MaterialId stamped
   * on the reading (Sep 2026 source schema) — authoritative. 'timeline' is
   * the hand-entered line-wide Current Product, the only option for readings
   * from before MaterialId existed. Null when no product could be found.
   */
  attribution: 'row' | 'timeline' | null;
  /**
   * True when the limits used are the OLDEST version known for the product
   * and the reading predates it — so they are a lower bound on what was in
   * force, not a record of it. Only set when a catalogue was consulted.
   */
  limitsAreLowerBound: boolean;
  /**
   * THE classification (roadmap Phase 4, 14 Sep 2026): the five-state answer
   * from shared/src/domain/classification.ts, the same one the register, the
   * CSV and /api/production count by. `inside`/`outsideByG` above are the
   * older two-state facts and are now derived from it. 'unknown' when no
   * weight was given, the weight is implausible, or there were no limits.
   */
  state: ConeState;
  /** The scale's own bit as the caller passed it: true passed, false rejected, null not given. */
  scalePassed: boolean | null;
  /** Why the state is 'unknown', when it is — so a screen prints the reason the server decided, not one it guessed. */
  unknownReason: 'no_weight' | 'implausible' | 'no_limits' | null;
}

const fmtG = (n: number) => Math.round(n).toLocaleString('en-US');

export function limitsOf(p: ProductInForce | null): ProductLimits | null {
  if (!p || p.setpointG == null) return null;
  // A product with a setpoint but no offsets has a target and no tolerance;
  // treating a missing offset as zero would declare every cone out of limits.
  const minus = p.weightOffsetMinusG;
  const plus = p.weightOffsetPlusG;
  if (minus == null || plus == null) return null;
  const target = p.setpointG;
  const lo = target - Math.abs(minus);
  const hi = target + Math.abs(plus);
  const symmetric = Math.abs(minus) === Math.abs(plus);
  return {
    targetG: target,
    loG: lo,
    hiG: hi,
    label: symmetric
      ? `${fmtG(target)} ± ${fmtG(Math.abs(plus))} g`
      : `${fmtG(lo)} to ${fmtG(hi)} g`,
  };
}

/** The resolved timeline: newest first, with a lookup by production instant. */
export class ProductTimeline {
  /** Newest first. */
  readonly entries: ProductInForce[];

  constructor(entries: ProductInForce[]) {
    this.entries = [...entries].sort((a, b) => b.effectiveFromMs - a.effectiveFromMs);
  }

  /** The product in force at a production instant, or null if none was. */
  at(ts: string | number | Date): ProductInForce | null {
    const ms = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : new Date(ts).getTime();
    // Entries are newest first, so the first one that started at or before the
    // reading is the one that was in force.
    return this.entries.find((e) => e.effectiveFromMs <= ms) ?? null;
  }

  /**
   * The full verdict for one weight at one instant.
   *
   * Two things changed here in Sep 2026, both optional so every existing call
   * keeps its old meaning until it opts in:
   *
   *  - `productId`: the reading's OWN MaterialId, when the row carries one.
   *    IFL's Sep 2026 schema stamps it on every row; up to six materials run
   *    concurrently on different machines, so the line-wide timeline is the
   *    wrong source for such a reading and is used only as the fallback for
   *    rows from before the column existed.
   *  - `catalogue`: time-versioned limits (productLimits.ts). With it, the
   *    reading is judged by the limits in force AT ITS OWN TIME. Without it the
   *    verdict falls back to the mirror's current values — which is the
   *    re-judging bug REDESIGN rule 1 exists to prevent, and why every caller
   *    should pass one.
   */
  verdict(
    ts: string | number | Date,
    weightG: number | null | undefined,
    opts: {
      productId?: number | null;
      catalogue?: ProductCatalogue;
      /**
       * The scale's own in-range bit and the plausibility window, so the
       * verdict carries the five-state classification (Phase 4). Without
       * them the state is judged from the limits alone: no bit means "not
       * rejected by the scale", and without a window every weight is
       * taken as plausible — callers that have the row pass both.
       */
      inRange?: boolean | null;
      plausibility?: { loG: number; hiG: number } | null;
    } = {},
  ): ProductVerdict {
    const tsMs = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : new Date(ts).getTime();
    const scalePassed = opts.inRange == null ? null : Boolean(opts.inRange);
    const plausible = opts.plausibility ? isPlausibleWeight(weightG, opts.plausibility) : weightG != null;
    // One call to the one rule, whatever else this verdict says about the
    // product: 'rejected' and 'unknown' (implausible / no weight) do not
    // depend on the limits, so they are decided before the product lookup.
    const classify = (limits: ProductLimits | null) =>
      classifyConeDetail({
        weightG,
        inRange: opts.inRange,
        plausible,
        limits: limits ? { setpointG: limits.targetG, minusG: limits.targetG - limits.loG, plusG: limits.hiG - limits.targetG } : null,
      });
    const none = (reason: NoProductReason): ProductVerdict => ({
      product: null, limits: null, outsideByG: null, inside: null, reason, attribution: null, limitsAreLowerBound: false,
      state: classify(null).state, scalePassed, unknownReason: classify(null).unknownReason,
    });

    let product: ProductInForce | null = null;
    let attribution: 'row' | 'timeline' | null = null;
    let limits: ProductLimits | null = null;
    let lowerBound = false;

    if (opts.productId != null && opts.catalogue) {
      const cp = opts.catalogue.product(opts.productId);
      const v = opts.catalogue.versionAt(opts.productId, tsMs);
      if (cp || v) {
        product = {
          productId: opts.productId,
          label: cp?.label ?? `Product ${opts.productId}`,
          setpointG: v?.setpointG ?? null,
          weightOffsetMinusG: v?.offsetMinusG ?? null,
          weightOffsetPlusG: v?.offsetPlusG ?? null,
          effectiveFromMs: v?.effectiveFromMs ?? tsMs,
          effectiveFromUtc: v?.effectiveFromUtc ?? new Date(tsMs).toISOString(),
        };
        attribution = 'row';
        limits = opts.catalogue.limitsAt(opts.productId, tsMs);
        lowerBound = Boolean(v?.effectiveIsLowerBound);
      }
    }
    if (!product) {
      product = this.at(tsMs);
      if (!product) return none('no_product_recorded');
      attribution = 'timeline';
      if (opts.catalogue) {
        const v = opts.catalogue.versionAt(product.productId, tsMs);
        limits = opts.catalogue.limitsAt(product.productId, tsMs) ?? limitsOf(product);
        lowerBound = Boolean(v?.effectiveIsLowerBound);
      } else {
        limits = limitsOf(product);
      }
    }

    if (!limits) return { ...none('no_setpoint'), product, attribution };
    if (weightG == null) {
      return {
        product, limits, outsideByG: null, inside: null, reason: null, attribution, limitsAreLowerBound: lowerBound,
        state: classify(limits).state, scalePassed, unknownReason: classify(limits).unknownReason,
      };
    }
    const c = classify(limits);
    // inside/outsideByG keep their pre-Phase-4 meaning — the product
    // tolerance alone, even for a scale-rejected or implausible reading — so
    // the sheet can still print "12 g under the lower limit" beside a state
    // that says 'rejected'. The STATE is the rule; these are the distance.
    const below = limits.loG - weightG;
    const above = weightG - limits.hiG;
    const outsideByG = below > 0 ? -Math.round(below * 100) / 100 : above > 0 ? Math.round(above * 100) / 100 : 0;
    return {
      product, limits, outsideByG, inside: outsideByG === 0, reason: null, attribution, limitsAreLowerBound: lowerBound,
      state: c.state, scalePassed, unknownReason: c.unknownReason,
    };
  }

  /** True when nothing has ever been recorded, so a screen can say so once. */
  get isEmpty(): boolean {
    return this.entries.length === 0;
  }
}

export async function loadProductTimeline(pool: ConnectionPool, lineId: number): Promise<ProductTimeline> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{
      product_id: number;
      effective_from: Date;
      setpoint_weight_g: number | null;
      weight_offset_minus_g: number | null;
      weight_offset_plus_g: number | null;
      description: string | null;
      lot_code: string | null;
    }>(
      `SELECT t.product_id, t.effective_from,
              p.setpoint_weight_g, p.weight_offset_minus_g, p.weight_offset_plus_g,
              p.description, p.lot_code
         FROM sms.product_timeline t
         JOIN sms.product p ON p.product_id = t.product_id
        WHERE t.line_id = @line AND t.superseded = 0
        ORDER BY t.effective_from DESC, t.timeline_id DESC`,
    );

  return new ProductTimeline(
    r.recordset.map((x) => {
      const ms = toPlantMs(x.effective_from);
      return {
        productId: x.product_id,
        label: x.description || x.lot_code || `Product ${x.product_id}`,
        setpointG: x.setpoint_weight_g == null ? null : Number(x.setpoint_weight_g),
        weightOffsetMinusG: x.weight_offset_minus_g == null ? null : Number(x.weight_offset_minus_g),
        weightOffsetPlusG: x.weight_offset_plus_g == null ? null : Number(x.weight_offset_plus_g),
        effectiveFromMs: ms,
        effectiveFromUtc: new Date(ms).toISOString(),
      };
    }),
  );
}

/* ------------------------------------------------- limits over time */

/**
 * One product's limits over one interval of plant time, inclusive at both
 * weight ends — the unit every set-based judgement works in (roadmap Phase 4,
 * 14 Sep 2026). `materialId` null means readings that carry NO material_id,
 * which are attributed by the line-wide timeline instead.
 */
export interface LimitWindow {
  materialId: number | null;
  /** Plant-clock ms; null = unbounded on that side. */
  fromMs: number | null;
  toMs: number | null;
  loG: number;
  hiG: number;
}

/**
 * Every limits window the record needs, from the same two sources verdict()
 * consults, in the same priority:
 *  - readings with their own MaterialId (every row since IFL's 2026-08-05
 *    rebuild): one window per (product, limits version), from the versioned
 *    history — never the mirror's current values. The oldest version also
 *    covers readings that predate it, as a lower bound (productLimits.ts).
 *  - readings with no MaterialId (July): the hand-entered line-wide timeline,
 *    each entry from its start to the next entry's start, with the limits as
 *    they stood when it began.
 * A reading matching no window has nothing to be judged against, and every
 * consumer treats it as 'unknown' — never as a pass.
 */
export function limitWindowsFor(timeline: ProductTimeline, catalogue: ProductCatalogue): LimitWindow[] {
  const out: LimitWindow[] = [];
  for (const pid of catalogue.productIds()) {
    const versions = catalogue.versionsAscending(pid);
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i]!;
      const lim = limitsFromVersionSafe(v);
      if (!lim) continue;
      out.push({
        materialId: pid,
        fromMs: i === 0 ? null : v.effectiveFromMs,
        toMs: versions[i + 1]?.effectiveFromMs ?? null,
        loG: lim.loG,
        hiG: lim.hiG,
      });
    }
  }
  const asc = [...timeline.entries].sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
  for (let i = 0; i < asc.length; i++) {
    const seg = asc[i]!;
    const lim = catalogue.limitsAt(seg.productId, seg.effectiveFromMs) ?? limitsOf(seg);
    if (!lim) continue;
    out.push({
      materialId: null,
      fromMs: seg.effectiveFromMs,
      toMs: asc[i + 1]?.effectiveFromMs ?? null,
      loG: lim.loG,
      hiG: lim.hiG,
    });
  }
  return out;
}

/** limitsFromVersion without a runtime import cycle: the shape is tiny. */
function limitsFromVersionSafe(v: { setpointG: number | null; offsetMinusG: number | null; offsetPlusG: number | null }): { loG: number; hiG: number } | null {
  if (v.setpointG == null || v.offsetMinusG == null || v.offsetPlusG == null) return null;
  return { loG: v.setpointG - Math.abs(v.offsetMinusG), hiG: v.setpointG + Math.abs(v.offsetPlusG) };
}

/* ------------------------------------------------- scale versus product */

export interface ProductDisagreement {
  /** Cones the scale passed that sit outside the product's limits — the 'low' + 'high' states. */
  passedButOutside: number;
  /** Cones the scale rejected that sit inside the product's limits. */
  rejectedButInside: number;
  /** Cones that had a product with limits, and so could be judged at all. */
  judged: number;
  /** Cones in the window with no product in force — stated, never assumed. */
  unjudged: number;
  /**
   * The source generation these four counts were taken over, and what was
   * excluded (generation.ts). Optional per that module's contract: missing
   * means "not stated", never "nothing was excluded".
   */
  generationNote?: GenerationNote;
}

export interface DayRange {
  /** Production days (shift_date), inclusive. */
  from: string;
  to: string;
  /** Optional single shift within those days. */
  shift?: string | null;
  /**
   * Caps the window at an INSTANT — the replay guard `period.ts` documents,
   * same convention as production.ts/rejects.ts: `production_ts_utc_ms <=
   * tsTo`. Optional so every existing caller (day-range only) keeps its exact
   * behaviour; without it a reading anywhere in `to`'s day counts, replay or
   * not.
   */
  tsTo?: string | null;
}

/**
 * How many cones in a period the SCALE passed but the product's own limits
 * would not — the one sentence REDESIGN.md §5.3 puts on the Weight screen
 * whenever it is non-zero — and the reverse.
 *
 * Filtered by shift_date, exactly as every other service filters a period, so
 * a "day" here is the same day it is everywhere else.
 *
 * ONE QUERY over the limit windows (Phase 4, 14 Sep 2026). Until then this
 * walked the catalogue and the timeline issuing one aggregate per window
 * plus three counts, and judged with its own inline comparison — a fourth
 * copy of the rule. Now the windows come from limitWindowsFor, the same list
 * the register's state column and /api/production's counts are built from,
 * and "passed but outside" IS the 'low' + 'high' population those report.
 * `rejectedButInside` is not a state — the classification makes the scale's
 * bit govern 'rejected' — so it is counted here beside the states.
 *
 * Readings that cannot be judged — no product recorded, a product with no
 * usable limits, a MaterialId the mirror does not know, no weight or bit —
 * are `unjudged`, never assumed to pass.
 *
 * THE ONE POPULATION RULE (coneState.ts, Phase 4): every cone counted here
 * — total, judged, passedOut and rejectedIn alike — must first pass the same
 * plausibility window bindStateCase checks before it ever looks at in_range
 * or a window. Until 15 Sep 2026 this query's base WHERE only excluded a
 * NULL weight, so a scale fault (the recorded 824 g "cone", or one of the
 * ~214-cone 2200-2354 g fault population — see spc.ts) could be counted here
 * as "passed but outside the product's limits" while the register — whose
 * state column runs bindStateCase, which checks plausibility FIRST — showed
 * the very same reading as 'unknown'. A user following the Weight screen's
 * banner to the register then found a different number of rows behind it.
 * Fixed the same way spc.ts's own `pass_out`/`fail_in` scale-vs-spec query
 * fixed the identical bug for the SPC screen: add the plausibility bound to
 * the base WHERE and leave `in_range = 1` / `in_range = 0` exactly as they
 * were — those already agree with bindStateCase for every row that carries a
 * bit, and this query, like spc.ts's, is not the place to change what
 * `judged` means.
 *
 * `catalogue` is optional so older callers keep their behaviour (timeline
 * only, applied to every row); every caller should pass one.
 *
 * ONE SOURCE GENERATION (23 Sep 2026, generation.ts). Every window above is
 * app-owned and TIME-versioned — the limits in force at a reading's own
 * instant. A source generation is not a time range: two generations can cover
 * the same production days, so pooling them judges both generations' cones
 * against the same versioned limits and reports the disagreement as one
 * count. The four numbers this returns are then a ratio over a population
 * that exists in no single source table, which is the defect the report
 * builders were constrained for in ca34a23 — and this one is read on the
 * attention list, where it decides whether the line is FLAGGED.
 */
export async function productDisagreement(
  pool: ConnectionPool,
  lineId: number,
  timeline: ProductTimeline,
  range: DayRange,
  catalogue?: ProductCatalogue,
): Promise<ProductDisagreement> {
  type Win = LimitWindow & { anyMaterial?: boolean };
  const windows: Win[] = catalogue
    ? limitWindowsFor(timeline, catalogue)
    : [...timeline.entries]
        .sort((a, b) => a.effectiveFromMs - b.effectiveFromMs)
        .flatMap((seg, i, asc): Win[] => {
          const lim = limitsOf(seg);
          // Legacy path (no catalogue): every row in the segment, whatever its material_id.
          return lim
            ? [{ materialId: null, fromMs: seg.effectiveFromMs, toMs: asc[i + 1]?.effectiveFromMs ?? null, loG: lim.loG, hiG: lim.hiG, anyMaterial: true }]
            : [];
        });

  // Fetched even when `windows` came from the legacy (no-catalogue) branch:
  // the plausibility bound is not a product-limits concept and applies to
  // the base population regardless of where the windows came from.
  const plausibility = await getPlausibilityRule(pool, lineId);
  // Resolved on line and day range only — never on `range.shift` — so the
  // shift breakdown and the period total land on the same generation.
  const scope = await resolveGenerationScope(pool, lineId, { from: range.from, to: range.to }, ['cone_event']);

  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, range.from)
    .input('to', mssql.Date, range.to)
    .input('plausLo', mssql.Float, plausibility.coneLoG)
    .input('plausHi', mssql.Float, plausibility.coneHiG);
  if (range.shift) req.input('shift', mssql.VarChar(16), range.shift);
  if (range.tsTo) req.input('tsTo', mssql.BigInt, new Date(range.tsTo).getTime());

  // Per window: a match predicate, and the reading's position against it.
  const matches: string[] = [];
  const outside: string[] = [];
  const inside: string[] = [];
  windows.forEach((w, i) => {
    const parts: string[] = [];
    if (!w.anyMaterial) {
      if (w.materialId == null) parts.push('material_id IS NULL');
      else {
        parts.push(`material_id = @mat${i}`);
        req.input(`mat${i}`, mssql.Int, w.materialId);
      }
    }
    if (w.fromMs != null) {
      parts.push(`production_ts_utc_ms >= @from${i}`);
      req.input(`from${i}`, mssql.BigInt, w.fromMs);
    }
    if (w.toMs != null) {
      parts.push(`production_ts_utc_ms < @to${i}`);
      req.input(`to${i}`, mssql.BigInt, w.toMs);
    }
    req.input(`lo${i}`, mssql.Float, w.loG);
    req.input(`hi${i}`, mssql.Float, w.hiG);
    const match = parts.length ? parts.join(' AND ') : '1 = 1';
    matches.push(`(${match})`);
    outside.push(`(${match} AND (weight_g < @lo${i} OR weight_g > @hi${i}))`);
    inside.push(`(${match} AND weight_g >= @lo${i} AND weight_g <= @hi${i})`);
  });
  const judgeable = matches.length ? `(${matches.join(' OR ')})` : '1 = 0';
  const isOutside = outside.length ? `(${outside.join(' OR ')})` : '1 = 0';
  const isInside = inside.length ? `(${inside.join(' OR ')})` : '1 = 0';

  const epochPredicate = epochWhere(req, scope, 'cone_event');

  const r = await req.query<{ total: number; judged: number; passedOut: number; rejectedIn: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN in_range IS NOT NULL AND ${judgeable} THEN 1 ELSE 0 END) AS judged,
            SUM(CASE WHEN in_range = 1 AND ${isOutside} THEN 1 ELSE 0 END) AS passedOut,
            SUM(CASE WHEN in_range = 0 AND ${isInside} THEN 1 ELSE 0 END) AS rejectedIn
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to
        ${range.shift ? 'AND shift_code = @shift' : ''}
        ${range.tsTo ? 'AND production_ts_utc_ms <= @tsTo' : ''}
        ${epochPredicate ? `AND ${epochPredicate}` : ''}
        AND weight_g BETWEEN @plausLo AND @plausHi`,
  );
  const row = r.recordset[0];
  const total = Number(row?.total ?? 0);
  const judged = Number(row?.judged ?? 0);
  return {
    passedButOutside: Number(row?.passedOut ?? 0),
    rejectedButInside: Number(row?.rejectedIn ?? 0),
    judged,
    unjudged: Math.max(0, total - judged),
    generationNote: noteOf(scope),
  };
}
