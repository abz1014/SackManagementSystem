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
 *   - a product was in force  → limits, and a signed distance from them
 *   - no product was recorded then → say so; compute nothing
 *   - the product is known but carries no setpoint → say so; compute nothing
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
  /** "1,960 ± 40 g", ready to print. */
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

/**
 * The resolved timeline: newest first, with a lookup by production instant.
 */
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

  /** The full verdict for one weight at one instant. */
  verdict(ts: string | number | Date, weightG: number | null | undefined): ProductVerdict {
    const product = this.at(ts);
    if (!product) return { product: null, limits: null, outsideByG: null, inside: null, reason: 'no_product_recorded' };
    const limits = limitsOf(product);
    if (!limits) return { product, limits: null, outsideByG: null, inside: null, reason: 'no_setpoint' };
    if (weightG == null) return { product, limits, outsideByG: null, inside: null, reason: null };
    const below = limits.loG - weightG;
    const above = weightG - limits.hiG;
    const outsideByG = below > 0 ? -Math.round(below * 100) / 100 : above > 0 ? Math.round(above * 100) / 100 : 0;
    return { product, limits, outsideByG, inside: outsideByG === 0, reason: null };
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

/**
 * How many cones in a window the SCALE passed but the product's own limits
 * would not — the one sentence REDESIGN.md §5.3 puts on the Weight screen
 * whenever it is non-zero.
 *
 * Counted per timeline segment so each cone is judged against the product that
 * was actually in force when it was weighed, never against today's. Readings
 * from before any product was recorded are excluded from the count rather than
 * assumed to pass: there is nothing to judge them against, and saying "0" would
 * imply there was.
 */
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

export async function productDisagreement(
  pool: ConnectionPool,
  lineId: number,
  timeline: ProductTimeline,
  fromMs: number,
  toMs: number,
): Promise<ProductDisagreement> {
  const empty: ProductDisagreement = { passedButOutside: 0, rejectedButInside: 0, judged: 0, unjudged: 0 };

  // Nothing to compare against: every reading in the window is unjudged, and
  // the caller needs the count to say so rather than print a zero.
  if (timeline.isEmpty) {
    const n = await countCones(pool, lineId, fromMs, toMs);
    return { ...empty, unjudged: n };
  }

  const out = { ...empty };
  // Walk the timeline as half-open segments [start, nextStart) clipped to the
  // window, so one query per product in force rather than one per cone.
  const asc = [...timeline.entries].sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
  const firstStart = asc[0]!.effectiveFromMs;
  if (firstStart > fromMs) {
    out.unjudged += await countCones(pool, lineId, fromMs, Math.min(firstStart, toMs));
  }

  for (let i = 0; i < asc.length; i++) {
    const seg = asc[i]!;
    const segFrom = Math.max(seg.effectiveFromMs, fromMs);
    const segTo = Math.min(asc[i + 1]?.effectiveFromMs ?? toMs, toMs);
    if (segTo <= segFrom) continue;

    const limits = limitsOf(seg);
    if (!limits) {
      out.unjudged += await countCones(pool, lineId, segFrom, segTo);
      continue;
    }

    const r = await pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('from', mssql.BigInt, segFrom)
      .input('to', mssql.BigInt, segTo)
      .input('lo', mssql.Float, limits.loG)
      .input('hi', mssql.Float, limits.hiG)
      .query<{ judged: number; passedOut: number; rejectedIn: number }>(
        `SELECT COUNT(*) AS judged,
                SUM(CASE WHEN in_range = 1 AND (weight_g < @lo OR weight_g > @hi) THEN 1 ELSE 0 END) AS passedOut,
                SUM(CASE WHEN in_range = 0 AND weight_g >= @lo AND weight_g <= @hi THEN 1 ELSE 0 END) AS rejectedIn
           FROM sms.cone_event
          WHERE line_id = @line
            AND production_ts_utc_ms >= @from AND production_ts_utc_ms < @to
            AND weight_g IS NOT NULL AND in_range IS NOT NULL`,
      );
    const row = r.recordset[0];
    out.judged += Number(row?.judged ?? 0);
    out.passedButOutside += Number(row?.passedOut ?? 0);
    out.rejectedButInside += Number(row?.rejectedIn ?? 0);
  }

  return out;
}

async function countCones(pool: ConnectionPool, lineId: number, fromMs: number, toMs: number): Promise<number> {
  if (toMs <= fromMs) return 0;
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.BigInt, fromMs)
    .input('to', mssql.BigInt, toMs)
    .query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sms.cone_event
        WHERE line_id = @line AND production_ts_utc_ms >= @from AND production_ts_utc_ms < @to
          AND weight_g IS NOT NULL`,
    );
  return Number(r.recordset[0]?.n ?? 0);
}
