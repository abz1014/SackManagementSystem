/**
 * Time-versioned product limits — "which limits were in force for product P at
 * instant T" (SEPT-2026-EPOCH-DECISION §5.4, the architectural core).
 *
 * THE BUG THIS FIXES EXISTS TODAY, with or without the write path. sms.product
 * is a mirror that seedProducts MERGE-overwrites from PDAS on every sync pass,
 * and productAt.ts judged a reading against the product's CURRENT setpoint and
 * offsets read from that mirror. So any change to a setpoint — by us, or by an
 * IFL engineer in SSMS — silently re-judged every past reading attributed to
 * that material. That is precisely the defect REDESIGN rule 1 ("the old app
 * applied today's tolerance to readings weeks old") was written to kill, one
 * level down.
 *
 * sms.product_limit_version is append-only: one row per (product, limits) as
 * observed or written. The newest row with effective_from <= T is the version
 * in force at T. Readings are ALWAYS judged by that, never by the mirror.
 *
 * CLOCKS. effective_from is a genuine UTC instant (app-written); readings carry
 * the plant's wall clock labelled as UTC. They are five hours apart here. Every
 * effective_from is converted through toPlantMs once at load, exactly as
 * loadProductTimeline does, so comparisons happen in one clock.
 *
 * HONESTY ABOUT THE PAST. Versions recorded as `effective_is_lower_bound` were
 * first SEEN at that instant, not known to have STARTED then — the bootstrap
 * rows migration 027 wrote, and every 'pdas_observed' row the sync writes when
 * it notices the mirror changed underneath it. A reading older than the oldest
 * known version is judged by that oldest version, and the verdict says the
 * limits are a lower-bound match rather than pretending certainty.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { toPlantMs } from './plantClock.js';
import type { ProductLimits } from './productAt.js';

export type LimitSource = 'pdas_observed' | 'sms_write';

export interface LimitVersion {
  productId: number;
  setpointG: number | null;
  offsetMinusG: number | null;
  offsetPlusG: number | null;
  /** Plant-clock ms (converted from the stored UTC instant). */
  effectiveFromMs: number;
  effectiveFromUtc: string;
  effectiveIsLowerBound: boolean;
  source: LimitSource;
}

export interface CatalogueProduct {
  productId: number;
  label: string;
  /** PDAS MaterialActive as last mirrored — informational, never enforced. */
  activeFlag: boolean | null;
}

const fmtG = (n: number) => Math.round(n).toLocaleString('en-US');

/** The same shape productAt.limitsOf returns, from a version row. */
export function limitsFromVersion(v: LimitVersion | null): ProductLimits | null {
  if (!v || v.setpointG == null) return null;
  // A setpoint with no offsets is a target and no tolerance; treating a missing
  // offset as zero would declare every cone out of limits.
  if (v.offsetMinusG == null || v.offsetPlusG == null) return null;
  const target = v.setpointG;
  const lo = target - Math.abs(v.offsetMinusG);
  const hi = target + Math.abs(v.offsetPlusG);
  const symmetric = Math.abs(v.offsetMinusG) === Math.abs(v.offsetPlusG);
  return {
    targetG: target,
    loG: lo,
    hiG: hi,
    label: symmetric
      ? `${fmtG(target)} ± ${fmtG(Math.abs(v.offsetPlusG))} g`
      : `${fmtG(lo)} to ${fmtG(hi)} g`,
  };
}

/**
 * Every product the mirror knows, with its full limits history. Loaded once per
 * request and consulted per reading — the lookup is a scan of one product's
 * versions (a handful of rows), never a query.
 */
export class ProductCatalogue {
  private readonly products = new Map<number, CatalogueProduct>();
  /** Newest first, per product. */
  private readonly versions = new Map<number, LimitVersion[]>();

  constructor(products: CatalogueProduct[], versions: LimitVersion[]) {
    for (const p of products) this.products.set(p.productId, p);
    for (const v of versions) {
      const list = this.versions.get(v.productId) ?? [];
      list.push(v);
      this.versions.set(v.productId, list);
    }
    for (const list of this.versions.values()) list.sort((a, b) => b.effectiveFromMs - a.effectiveFromMs);
  }

  product(productId: number): CatalogueProduct | null {
    return this.products.get(productId) ?? null;
  }

  /**
   * The version in force at a plant instant. Falls back to the OLDEST known
   * version for readings that predate all of them — that version is then a
   * lower bound, and `effectiveIsLowerBound` on the returned row says so.
   */
  versionAt(productId: number, tsMs: number): LimitVersion | null {
    const list = this.versions.get(productId);
    if (!list || list.length === 0) return null;
    const inForce = list.find((v) => v.effectiveFromMs <= tsMs);
    if (inForce) return inForce;
    const oldest = list[list.length - 1]!;
    return { ...oldest, effectiveIsLowerBound: true };
  }

  limitsAt(productId: number, tsMs: number): ProductLimits | null {
    return limitsFromVersion(this.versionAt(productId, tsMs));
  }

  /** Every product id the mirror knows, ascending. */
  productIds(): number[] {
    return [...this.products.keys()].sort((a, b) => a - b);
  }

  /** A product's versions, OLDEST first — the order a time walk wants. */
  versionsAscending(productId: number): LimitVersion[] {
    return [...(this.versions.get(productId) ?? [])].reverse();
  }

  /** The newest version — what the mirror should currently agree with. */
  latest(productId: number): LimitVersion | null {
    return this.versions.get(productId)?.[0] ?? null;
  }

  get isEmpty(): boolean {
    return this.products.size === 0;
  }
}

export async function loadProductCatalogue(pool: ConnectionPool): Promise<ProductCatalogue> {
  const prod = await pool.request().query<{
    product_id: number;
    description: string | null;
    lot_code: string | null;
    active_flag: boolean | null;
  }>(`SELECT product_id, description, lot_code, active_flag FROM sms.product`);

  const ver = await pool.request().query<{
    product_id: number;
    setpoint_g: number | null;
    offset_minus_g: number | null;
    offset_plus_g: number | null;
    effective_from: Date;
    effective_is_lower_bound: boolean;
    source: LimitSource;
  }>(
    `SELECT product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
            effective_is_lower_bound, source
       FROM sms.product_limit_version
      ORDER BY product_id, effective_from DESC, version_id DESC`,
  );

  return new ProductCatalogue(
    prod.recordset.map((p) => ({
      productId: p.product_id,
      label: p.description || p.lot_code || `Product ${p.product_id}`,
      activeFlag: p.active_flag == null ? null : Boolean(p.active_flag),
    })),
    ver.recordset.map((v) => {
      const ms = toPlantMs(v.effective_from);
      return {
        productId: v.product_id,
        setpointG: v.setpoint_g == null ? null : Number(v.setpoint_g),
        offsetMinusG: v.offset_minus_g == null ? null : Number(v.offset_minus_g),
        offsetPlusG: v.offset_plus_g == null ? null : Number(v.offset_plus_g),
        effectiveFromMs: ms,
        effectiveFromUtc: new Date(ms).toISOString(),
        effectiveIsLowerBound: Boolean(v.effective_is_lower_bound),
        source: v.source,
      };
    }),
  );
}

/**
 * Append a version. Used by the write path (source 'sms_write', effective the
 * instant PDAS accepted the change) and by the reference sync when it notices
 * the mirror changed underneath it (source 'pdas_observed', a lower bound).
 */
export async function appendLimitVersion(
  pool: ConnectionPool,
  v: {
    productId: number;
    setpointG: number | null;
    offsetMinusG: number | null;
    offsetPlusG: number | null;
    effectiveFromUtc: Date;
    effectiveIsLowerBound: boolean;
    source: LimitSource;
    changedBy: number | null;
    reason: string | null;
  },
): Promise<void> {
  await pool
    .request()
    .input('pid', mssql.Int, v.productId)
    .input('sp', mssql.Decimal(10, 2), v.setpointG)
    .input('om', mssql.Decimal(10, 2), v.offsetMinusG)
    .input('op', mssql.Decimal(10, 2), v.offsetPlusG)
    .input('eff', mssql.DateTime2(3), v.effectiveFromUtc)
    .input('lb', mssql.Bit, v.effectiveIsLowerBound)
    .input('src', mssql.VarChar(20), v.source)
    .input('by', mssql.Int, v.changedBy)
    .input('reason', mssql.NVarChar(255), v.reason)
    .query(
      `INSERT INTO sms.product_limit_version
         (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
          effective_is_lower_bound, source, changed_by, reason)
       VALUES (@pid, @sp, @om, @op, @eff, @lb, @src, @by, @reason)`,
    );
}
