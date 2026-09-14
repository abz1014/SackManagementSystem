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
import { toPlantMs } from './plantClock.js';
import type { ProductCatalogue } from './productLimits.js';

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
    opts: { productId?: number | null; catalogue?: ProductCatalogue } = {},
  ): ProductVerdict {
    const tsMs = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : new Date(ts).getTime();
    const none = (reason: NoProductReason): ProductVerdict => ({
      product: null, limits: null, outsideByG: null, inside: null, reason, attribution: null, limitsAreLowerBound: false,
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
      return { product, limits, outsideByG: null, inside: null, reason: null, attribution, limitsAreLowerBound: lowerBound };
    }
    const below = limits.loG - weightG;
    const above = weightG - limits.hiG;
    const outsideByG = below > 0 ? -Math.round(below * 100) / 100 : above > 0 ? Math.round(above * 100) / 100 : 0;
    return { product, limits, outsideByG, inside: outsideByG === 0, reason: null, attribution, limitsAreLowerBound: lowerBound };
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

/* ------------------------------------------------- scale versus product */

export interface ProductDisagreement {
  /** Cones the scale passed that sit outside the product's limits. */
  passedButOutside: number;
  /** Cones the scale rejected that sit inside the product's limits. */
  rejectedButInside: number;
  /** Cones that had a product with limits, and so could be judged at all. */
  judged: number;
  /** Cones in the window with no product in force — stated, never assumed. */
  unjudged: number;
}

export interface DayRange {
  /** Production days (shift_date), inclusive. */
  from: string;
  to: string;
  /** Optional single shift within those days. */
  shift?: string | null;
}

/** One judged window: rows in [fromMs, toMs) against one pair of limits. */
async function judgeWindow(
  pool: ConnectionPool,
  lineId: number,
  range: DayRange,
  w: { fromMs: number | null; toMs: number | null; loG: number; hiG: number; materialId: number | null },
): Promise<{ judged: number; passedOut: number; rejectedIn: number }> {
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, range.from)
    .input('to', mssql.Date, range.to)
    .input('lo', mssql.Float, w.loG)
    .input('hi', mssql.Float, w.hiG);
  if (w.fromMs != null) req.input('segFrom', mssql.BigInt, w.fromMs);
  if (w.toMs != null) req.input('segTo', mssql.BigInt, w.toMs);
  if (w.materialId != null) req.input('mat', mssql.Int, w.materialId);
  if (range.shift) req.input('shift', mssql.VarChar(16), range.shift);

  const r = await req.query<{ judged: number; passedOut: number; rejectedIn: number }>(
    `SELECT COUNT(*) AS judged,
            SUM(CASE WHEN in_range = 1 AND (weight_g < @lo OR weight_g > @hi) THEN 1 ELSE 0 END) AS passedOut,
            SUM(CASE WHEN in_range = 0 AND weight_g >= @lo AND weight_g <= @hi THEN 1 ELSE 0 END) AS rejectedIn
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to
        ${range.shift ? 'AND shift_code = @shift' : ''}
        ${w.fromMs != null ? 'AND production_ts_utc_ms >= @segFrom' : ''}
        ${w.toMs != null ? 'AND production_ts_utc_ms < @segTo' : ''}
        ${w.materialId != null ? 'AND material_id = @mat' : 'AND material_id IS NULL'}
        AND weight_g IS NOT NULL AND in_range IS NOT NULL`,
  );
  const row = r.recordset[0];
  return {
    judged: Number(row?.judged ?? 0),
    passedOut: Number(row?.passedOut ?? 0),
    rejectedIn: Number(row?.rejectedIn ?? 0),
  };
}

/**
 * How many cones in a period the SCALE passed but the product's own limits
 * would not — the one sentence REDESIGN.md §5.3 puts on the Weight screen
 * whenever it is non-zero.
 *
 * Filtered by shift_date, exactly as every other service filters a period, so
 * a "day" here is the same day it is everywhere else.
 *
 * TWO KINDS OF CONE, judged two ways (Sep 2026):
 *
 *  - Cones that carry their OWN product — IFL's `MaterialId`, stamped on every
 *    row since their 2026-08-05 rebuild and populated on 100% of them. These
 *    are judged against THAT product's limits as they stood at the cone's own
 *    time (productLimits.ts), one query per (product, limits version). The
 *    line-wide timeline is not consulted for them: up to six materials run
 *    concurrently on different machines, so "the product in force on the line"
 *    is the wrong question for such a cone.
 *
 *  - Cones with no product on the row — everything from before the column
 *    existed. For these the hand-entered line-wide timeline is the only
 *    attribution there is, walked as half-open segments [start, nextStart),
 *    each judged against the limits in force when the segment began.
 *
 * Readings that cannot be judged either way — no product recorded, a product
 * with no usable limits, a MaterialId the mirror does not know — are counted
 * as `unjudged` rather than assumed to pass: there is nothing to judge them
 * against, and reporting them as zero would imply there was.
 *
 * `catalogue` is optional so older callers keep their exact behaviour (mirror
 * limits, timeline only); every caller should pass one.
 */
export async function productDisagreement(
  pool: ConnectionPool,
  lineId: number,
  timeline: ProductTimeline,
  range: DayRange,
  catalogue?: ProductCatalogue,
): Promise<ProductDisagreement> {
  const out: ProductDisagreement = { passedButOutside: 0, rejectedButInside: 0, judged: 0, unjudged: 0 };
  const add = (r: { judged: number; passedOut: number; rejectedIn: number }) => {
    out.judged += r.judged;
    out.passedButOutside += r.passedOut;
    out.rejectedButInside += r.rejectedIn;
  };
  // With a catalogue, the timeline walk below sees ONLY rows without their own
  // product; without one (legacy callers) it sees every row, as it always did.
  const unattributedOnly = catalogue != null;

  // ---- 1. cones with their own MaterialId, per product, per limits version --
  if (catalogue) {
    let judgedAttributed = 0;
    for (const pid of catalogue.productIds()) {
      const versions = catalogue.versionsAscending(pid);
      for (let i = 0; i < versions.length; i++) {
        const v = versions[i]!;
        const lim = limitsFromVersionSafe(v);
        if (!lim) continue;
        // The oldest version also covers readings that PREDATE it (a lower
        // bound on when those limits took effect — see productLimits.ts).
        const fromMs = i === 0 ? null : v.effectiveFromMs;
        const toMs = versions[i + 1]?.effectiveFromMs ?? null;
        const r = await judgeWindow(pool, lineId, range, { fromMs, toMs, loG: lim.loG, hiG: lim.hiG, materialId: pid });
        add(r);
        judgedAttributed += r.judged;
      }
    }
    // Attributed cones nothing above could judge: unknown product, or a
    // product with no usable limits.
    const attributedTotal = await countCones(pool, lineId, range, null, null, 'attributed');
    out.unjudged += Math.max(0, attributedTotal - judgedAttributed);
  }

  // ---- 2. cones with no product on the row: the line-wide timeline ---------
  if (timeline.isEmpty) {
    out.unjudged += await countCones(pool, lineId, range, null, null, unattributedOnly ? 'unattributed' : 'all');
    return out;
  }

  // Walk the timeline as half-open segments [start, nextStart), each clipped by
  // the shift_date filter in SQL. One query per product in force, not per cone.
  const asc = [...timeline.entries].sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
  const scope = unattributedOnly ? 'unattributed' : 'all';

  // Anything in the period that predates the first recorded product.
  out.unjudged += await countCones(pool, lineId, range, null, asc[0]!.effectiveFromMs, scope);

  for (let i = 0; i < asc.length; i++) {
    const seg = asc[i]!;
    const segTo = asc[i + 1]?.effectiveFromMs ?? null;
    // Limits as they stood when this segment began — versioned when a
    // catalogue is available, the mirror's current values otherwise.
    const limits = catalogue
      ? (catalogue.limitsAt(seg.productId, seg.effectiveFromMs) ?? limitsOf(seg))
      : limitsOf(seg);

    if (!limits) {
      out.unjudged += await countCones(pool, lineId, range, seg.effectiveFromMs, segTo, scope);
      continue;
    }
    if (unattributedOnly) {
      add(await judgeWindow(pool, lineId, range, { fromMs: seg.effectiveFromMs, toMs: segTo, loG: limits.loG, hiG: limits.hiG, materialId: null }));
      continue;
    }
    // Legacy path (no catalogue): every row in the segment, as before.
    const req = pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('from', mssql.Date, range.from)
      .input('to', mssql.Date, range.to)
      .input('segFrom', mssql.BigInt, seg.effectiveFromMs)
      .input('lo', mssql.Float, limits.loG)
      .input('hi', mssql.Float, limits.hiG);
    if (segTo != null) req.input('segTo', mssql.BigInt, segTo);
    if (range.shift) req.input('shift', mssql.VarChar(16), range.shift);
    const r = await req.query<{ judged: number; passedOut: number; rejectedIn: number }>(
      `SELECT COUNT(*) AS judged,
              SUM(CASE WHEN in_range = 1 AND (weight_g < @lo OR weight_g > @hi) THEN 1 ELSE 0 END) AS passedOut,
              SUM(CASE WHEN in_range = 0 AND weight_g >= @lo AND weight_g <= @hi THEN 1 ELSE 0 END) AS rejectedIn
         FROM sms.cone_event
        WHERE line_id = @line AND shift_date BETWEEN @from AND @to
          ${range.shift ? 'AND shift_code = @shift' : ''}
          AND production_ts_utc_ms >= @segFrom
          ${segTo != null ? 'AND production_ts_utc_ms < @segTo' : ''}
          AND weight_g IS NOT NULL AND in_range IS NOT NULL`,
    );
    const row = r.recordset[0];
    add({ judged: Number(row?.judged ?? 0), passedOut: Number(row?.passedOut ?? 0), rejectedIn: Number(row?.rejectedIn ?? 0) });
  }

  return out;
}

/** limitsFromVersion without a runtime import cycle: the shape is tiny. */
function limitsFromVersionSafe(v: { setpointG: number | null; offsetMinusG: number | null; offsetPlusG: number | null }): { loG: number; hiG: number } | null {
  if (v.setpointG == null || v.offsetMinusG == null || v.offsetPlusG == null) return null;
  return { loG: v.setpointG - Math.abs(v.offsetMinusG), hiG: v.setpointG + Math.abs(v.offsetPlusG) };
}

async function countCones(
  pool: ConnectionPool,
  lineId: number,
  range: DayRange,
  fromMs: number | null,
  toMs: number | null,
  scope: 'all' | 'attributed' | 'unattributed' = 'all',
): Promise<number> {
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, range.from)
    .input('to', mssql.Date, range.to);
  if (fromMs != null) req.input('segFrom', mssql.BigInt, fromMs);
  if (toMs != null) req.input('segTo', mssql.BigInt, toMs);
  if (range.shift) req.input('shift', mssql.VarChar(16), range.shift);

  const r = await req.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to
        ${range.shift ? 'AND shift_code = @shift' : ''}
        ${fromMs != null ? 'AND production_ts_utc_ms >= @segFrom' : ''}
        ${toMs != null ? 'AND production_ts_utc_ms < @segTo' : ''}
        ${scope === 'attributed' ? 'AND material_id IS NOT NULL' : scope === 'unattributed' ? 'AND material_id IS NULL' : ''}
        AND weight_g IS NOT NULL`,
  );
  return Number(r.recordset[0]?.n ?? 0);
}
