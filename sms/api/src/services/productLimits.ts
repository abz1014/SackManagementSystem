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
import { toPlantMs, toPlantIso } from './plantClock.js';
import type { ProductLimits } from './productAt.js';
import { auditedWrite, type Db } from './audit.js';
import { distinctProductLabels, type ProductNameParts } from './productNames.js';

/**
 * 'pdas_observed' — the sync worker noticed the PDAS mirror changed underneath
 *   it; a lower-bound observation, not a decision (see effective_is_lower_bound).
 * 'sms_write' — the PDAS write path (pdasWrite.ts) committed a change to PDAS
 *   itself and this is its confirmed effect; off until IFL authorises writes.
 * 'sms_local' — this app recorded a limit change WITHOUT touching PDAS (roadmap
 *   Phase 4 item 2, 15 Sep 2026: IFL wants limits editable from Setup, and
 *   nothing may write to PDAS yet). Never mirrored to sms.product — that
 *   mirror is MERGE-overwritten by the PDAS sync every pass and would erase
 *   it — so this table is the only place an sms_local change is recorded, and
 *   it is judged by limitsAt() exactly like every other source.
 */
export type LimitSource = 'pdas_observed' | 'sms_write' | 'sms_local';

/**
 * Which source wins when two versions share the exact same effective_from
 * instant (to the millisecond) — structurally possible even though it has
 * not been observed in practice: an sms_local write's effective_from
 * defaults to "now", and a sync pass writing a pdas_observed row could in
 * principle land on the same millisecond. Without an explicit rule the order
 * would fall out of loadProductCatalogue's `ORDER BY effective_from DESC,
 * version_id DESC` — "whichever was inserted last" — which is an accident of
 * write timing, not a decision.
 *
 * THE RULE: a version this app or PDAS was DELIBERATELY TOLD to record
 * (sms_local, sms_write) outranks one the sync worker merely OBSERVED already
 * sitting in the PDAS mirror (pdas_observed) — an observation is evidence the
 * limits were SOMETHING at that instant, not a record of what anyone decided
 * they should be, so a genuine write must win the tie. Between the two write
 * paths, sms_local outranks sms_write; the two are not expected to collide
 * (they are different features, and only one — sms_local — can be in use
 * while IFL's PDAS authorisation is outstanding), so the ordering between them
 * is a tie-break of convenience, not a load-bearing decision.
 */
const SOURCE_PRIORITY: Record<LimitSource, number> = { sms_local: 3, sms_write: 2, pdas_observed: 1 };

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

export interface CatalogueProduct extends ProductNameParts {
  productId: number;
  /** The PLAIN name — `description || lot_code || "Product N"`. Six materials on this line share one. */
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
  /**
   * productId → a name unique across the whole catalogue (friction audit F7).
   * Computed once here so every consumer — report payload, CSV, XLSX, PDF —
   * gets the same answer, rather than each screen patching around a collision
   * in the browser and each export shipping the collision.
   */
  private readonly distinct: Map<number, string>;

  constructor(products: CatalogueProduct[], versions: LimitVersion[]) {
    for (const p of products) this.products.set(p.productId, p);
    // `label` IS the plain name (`description || lot_code || "Product N"`),
    // so it is what the collision test must run on — a catalogue built by
    // hand in a test carries no separate description field.
    this.distinct = distinctProductLabels(products.map((p) => ({ ...p, description: p.label })));
    for (const v of versions) {
      const list = this.versions.get(v.productId) ?? [];
      list.push(v);
      this.versions.set(v.productId, list);
    }
    // Newest first; on an exact tie, SOURCE_PRIORITY decides (see its comment).
    for (const list of this.versions.values()) {
      list.sort((a, b) => b.effectiveFromMs - a.effectiveFromMs || SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);
    }
  }

  product(productId: number): CatalogueProduct | null {
    return this.products.get(productId) ?? null;
  }

  /**
   * The name to PRINT for a product: the plain description when nothing else
   * in the catalogue shares it, otherwise the description plus whichever of
   * colour / blend / count / tube type actually tells it apart (see
   * productNames.ts). Falls back to `Product N` for an id the mirror has never
   * heard of — the same fallback every caller used before this existed.
   */
  distinctLabel(productId: number): string {
    return this.distinct.get(productId) ?? `Product ${productId}`;
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
  // The join is to the three reference tables the PDAS sync already mirrors
  // (sms.blend / sms.yarn_count / sms.tube_type, migration 006) and `color`
  // (migration 020). They are a handful of rows each and carry the only
  // things that tell two same-named materials apart — see productNames.ts.
  // LEFT JOIN throughout: a product with a null blend_id must still be listed.
  const prod = await pool.request().query<{
    product_id: number;
    description: string | null;
    lot_code: string | null;
    active_flag: boolean | null;
    color: string | null;
    blend: string | null;
    count_text: string | null;
    tube_type: string | null;
  }>(
    `SELECT p.product_id, p.description, p.lot_code, p.active_flag, p.color,
            b.blend, c.count_text, t.tube_type
       FROM sms.product p
       LEFT JOIN sms.blend b ON b.blend_id = p.blend_id
       LEFT JOIN sms.yarn_count c ON c.count_id = p.count_id
       LEFT JOIN sms.tube_type t ON t.tube_type_id = p.tube_type_id`,
  );

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
      description: p.description ?? null,
      lotCode: p.lot_code ?? null,
      color: p.color ?? null,
      blend: p.blend ?? null,
      countText: p.count_text ?? null,
      tubeType: p.tube_type ?? null,
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
 * instant PDAS accepted the change), by the reference sync when it notices
 * the mirror changed underneath it (source 'pdas_observed', a lower bound),
 * and by setLocalLimitVersion below (source 'sms_local', no PDAS involved).
 *
 * Takes a `Db` (a pool OR a transaction — see services/audit.ts) rather than
 * a ConnectionPool so a caller using auditedWrite() can run this on `tx` and
 * have the version row and its audit row commit together, same as every
 * other configuration write in the app. Every existing caller passes a pool,
 * which satisfies `Db` structurally, so this is not a breaking change.
 *
 * Returns the new row's version_id (an IDENTITY, only known after the
 * INSERT) for a caller that wants to report or test it; existing callers
 * that do not need it simply do not use the return value.
 */
export async function appendLimitVersion(
  db: Db,
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
): Promise<number> {
  const r = await db
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
    .query<{ version_id: number }>(
      `INSERT INTO sms.product_limit_version
         (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
          effective_is_lower_bound, source, changed_by, reason)
       OUTPUT inserted.version_id
       VALUES (@pid, @sp, @om, @op, @eff, @lb, @src, @by, @reason)`,
    );
  return Number(r.recordset[0]?.version_id);
}

/* ------------------------------------------- the SMS-local write path */

/** Setpoint must be a plausible cone weight; each offset > 0 and at most half the setpoint. */
export interface SetpointBounds {
  setpointLoG: number;
  setpointHiG: number;
}

/**
 * The sanity check for an sms_local limit change — "the resulting window
 * sane" (roadmap Phase 4 item 2, 15 Sep 2026). Deliberately re-implemented
 * here rather than imported from pdasWrite.ts's private, near-identical
 * PdasWriter.plausibility: this path must work with PDAS_WRITE_ENABLED unset
 * and must never import from the module that owns the PDAS connection, so
 * that the two write paths stay independently reviewable and this one cannot
 * be broken by a change to the one that is still off. The one deliberate
 * difference is that BOTH offsets must be strictly positive here (a zero
 * offset makes the window one edge wide, which a human setting limits
 * through this form is presumed not to have intended) where the PDAS path
 * allows zero.
 */
export function checkLimitWindowSane(
  f: { setpointG: number; offsetMinusG: number; offsetPlusG: number },
  b: SetpointBounds,
): string | null {
  if (!(f.setpointG >= b.setpointLoG && f.setpointG <= b.setpointHiG)) {
    return `Setpoint ${f.setpointG} g is outside the plausible cone range ${b.setpointLoG}–${b.setpointHiG} g.`;
  }
  for (const [name, val] of [
    ['lower offset', f.offsetMinusG],
    ['upper offset', f.offsetPlusG],
  ] as const) {
    if (!(val > 0 && val <= f.setpointG / 2)) {
      return `The ${name} ${val} g must be more than 0 and at most half the setpoint (${f.setpointG / 2} g).`;
    }
  }
  return null;
}

/** effective_from may not be in the future — the Two Clocks rule: this is a genuine app-UTC instant, compared against a genuine UTC "now". */
export function checkNotFuture(effectiveFromUtc: Date, nowUtc: Date = new Date()): string | null {
  return effectiveFromUtc.getTime() > nowUtc.getTime()
    ? `effective_from ${effectiveFromUtc.toISOString()} is in the future.`
    : null;
}

export interface LocalLimitInput {
  productId: number;
  setpointG: number;
  offsetMinusG: number;
  offsetPlusG: number;
  effectiveFromUtc: Date;
  reason: string | null;
}

export type LocalLimitResult =
  | { ok: true; versionId: number; label: string | null }
  | { ok: false; code: 'UNKNOWN_PRODUCT' | 'IMPLAUSIBLE' | 'FUTURE'; message: string };

/**
 * Record a limit change WITHOUT touching PDAS (roadmap Phase 4 item 2, 15 Sep
 * 2026 — IFL answered that limits must be editable from Setup, and nothing
 * may write to PDAS yet). Engineer rank (2) is enforced by the route, not
 * here; this function only needs an actor id to attribute the version and
 * its audit row to.
 *
 * ONE new row in sms.product_limit_version, source 'sms_local' — never
 * sms.product (the PDAS mirror MERGE-overwrites it every sync pass and would
 * erase a write there), never anything in PDAS_TP1U2, and never a second
 * insert path: this calls appendLimitVersion(), the same INSERT every other
 * source uses. The version and its audit row commit in one transaction
 * (auditedWrite — services/audit.ts), so a change is never recorded without
 * a record of who made it and why.
 *
 * Roadmap rule 12 (never silently change a historical calculation) is kept
 * by construction: this APPENDS a version effective from `effectiveFromUtc`
 * onward. Every reading already judged under an earlier version keeps that
 * verdict — limitsAt() judges each reading by the version in force at ITS
 * OWN time (productLimits.test.ts pins this) — so no past reading is
 * reclassified by this call.
 */
export async function setLocalLimitVersion(
  pool: ConnectionPool,
  actorId: number,
  bounds: SetpointBounds,
  input: LocalLimitInput,
): Promise<LocalLimitResult> {
  const bad = checkLimitWindowSane(input, bounds) ?? checkNotFuture(input.effectiveFromUtc);
  if (bad) {
    return { ok: false, code: bad.startsWith('effective_from') ? 'FUTURE' : 'IMPLAUSIBLE', message: bad };
  }

  return auditedWrite<LocalLimitResult>(
    pool,
    actorId,
    { action: 'product.limits.local', targetType: 'product', targetId: input.productId, detail: null },
    async (tx) => {
      // No FK backs product_id (the mirror is re-seeded and may transiently
      // lack the row — same reason product_limit_version has none at all),
      // so this is the only gate against recording limits for a product that
      // does not exist, the same defect /api/current-product guards against.
      const known = await tx
        .request()
        .input('id', mssql.Int, input.productId)
        .query<{ n: number }>(`SELECT COUNT(*) AS n FROM sms.product WHERE product_id = @id`);
      if (!known.recordset[0]?.n) {
        return {
          result: { ok: false, code: 'UNKNOWN_PRODUCT', message: `unknown productId ${input.productId}` },
          noop: true,
        };
      }

      const versionId = await appendLimitVersion(tx, {
        productId: input.productId,
        setpointG: input.setpointG,
        offsetMinusG: input.offsetMinusG,
        offsetPlusG: input.offsetPlusG,
        effectiveFromUtc: input.effectiveFromUtc,
        effectiveIsLowerBound: false,
        source: 'sms_local',
        changedBy: actorId,
        reason: input.reason,
      });
      const label = limitsFromVersion({
        productId: input.productId,
        setpointG: input.setpointG,
        offsetMinusG: input.offsetMinusG,
        offsetPlusG: input.offsetPlusG,
        effectiveFromMs: 0,
        effectiveFromUtc: input.effectiveFromUtc.toISOString(),
        effectiveIsLowerBound: false,
        source: 'sms_local',
      })?.label ?? null;
      return {
        result: { ok: true, versionId, label },
        targetId: input.productId,
        detail: `limits recorded in SMS (not PDAS): ${label ?? `${input.setpointG} g`}${input.reason ? ` — ${input.reason}` : ''}`,
      };
    },
  );
}

/* ------------------------------------------------- the history, readable */

export interface LimitHistoryVersion {
  versionId: number;
  setpointG: number | null;
  offsetMinusG: number | null;
  offsetPlusG: number | null;
  /** The stored UTC instant, as written — an app instant, not plant time. */
  effectiveFromUtc: string;
  /**
   * The same instant re-expressed on the production-time convention (Two
   * Clocks: toPlantIso — plantClock.ts), for display. A viewer's browser
   * timezone is not reliable — the account may be a manager opening this
   * screen away from the plant PC — so "in force from" is rendered from
   * THIS field with the UTC-pinned formatters (fmtDay/fmtClock), the same
   * way calibration.ts's adjustedAtPlant is, never from effectiveFromUtc
   * with a browser-local formatter: that would put a changeover reading up
   * to five hours off the shift it actually fell in.
   */
  effectiveFromPlant: string;
  /** "No later than": first SEEN at effectiveFrom, not known to have started then. */
  effectiveIsLowerBound: boolean;
  source: LimitSource;
  changedBy: string | null;
  reason: string | null;
  recordedAtUtc: string;
  /** Ready to print: "1,960 ± 30 g", or null when the version has no usable limits. */
  label: string | null;
}

export interface LimitHistoryProduct {
  productId: number;
  label: string;
  activeFlag: boolean | null;
  /** Newest first. */
  versions: LimitHistoryVersion[];
}

/**
 * Every product's versioned limits, for Setup › Rules › Product limits
 * (roadmap Phase 4 item 2, 14 Sep 2026). The catalogue above is the lookup
 * the classification uses; this is the same table read back for a person,
 * with the author and reason the catalogue has no use for. Nothing in
 * `sms.product_limit_version` had a reader before this — the history was
 * written since migration 027 and shown nowhere.
 *
 * Products with no version at all are still listed (with an empty history)
 * so the screen can say "no limits recorded" rather than omit the product.
 */
export async function listLimitHistory(pool: ConnectionPool): Promise<LimitHistoryProduct[]> {
  const prod = await pool.request().query<{
    product_id: number; description: string | null; lot_code: string | null; active_flag: boolean | null;
  }>(`SELECT product_id, description, lot_code, active_flag FROM sms.product ORDER BY product_id`);

  const ver = await pool.request().query<{
    version_id: number; product_id: number; setpoint_g: number | null; offset_minus_g: number | null;
    offset_plus_g: number | null; effective_from: Date; effective_is_lower_bound: boolean; source: LimitSource;
    changed_by: string | null; reason: string | null; recorded_at: Date;
  }>(
    `SELECT v.version_id, v.product_id, v.setpoint_g, v.offset_minus_g, v.offset_plus_g, v.effective_from,
            v.effective_is_lower_bound, v.source, u.username AS changed_by, v.reason, v.recorded_at
       FROM sms.product_limit_version v
       LEFT JOIN sms.app_user u ON u.user_id = v.changed_by
      ORDER BY v.product_id, v.effective_from DESC, v.version_id DESC`,
  );

  const byProduct = new Map<number, LimitHistoryVersion[]>();
  for (const v of ver.recordset) {
    const row: LimitHistoryVersion = {
      versionId: Number(v.version_id),
      setpointG: v.setpoint_g == null ? null : Number(v.setpoint_g),
      offsetMinusG: v.offset_minus_g == null ? null : Number(v.offset_minus_g),
      offsetPlusG: v.offset_plus_g == null ? null : Number(v.offset_plus_g),
      effectiveFromUtc: new Date(v.effective_from).toISOString(),
      effectiveFromPlant: toPlantIso(v.effective_from),
      effectiveIsLowerBound: Boolean(v.effective_is_lower_bound),
      source: v.source,
      changedBy: v.changed_by ?? null,
      reason: v.reason ?? null,
      recordedAtUtc: new Date(v.recorded_at).toISOString(),
      label: null,
    };
    row.label =
      limitsFromVersion({
        productId: Number(v.product_id), setpointG: row.setpointG, offsetMinusG: row.offsetMinusG, offsetPlusG: row.offsetPlusG,
        effectiveFromMs: 0, effectiveFromUtc: row.effectiveFromUtc, effectiveIsLowerBound: row.effectiveIsLowerBound, source: v.source,
      })?.label ?? null;
    const list = byProduct.get(Number(v.product_id)) ?? [];
    list.push(row);
    byProduct.set(Number(v.product_id), list);
  }

  return prod.recordset.map((p) => ({
    productId: Number(p.product_id),
    label: p.description || p.lot_code || `Product ${p.product_id}`,
    activeFlag: p.active_flag == null ? null : Boolean(p.active_flag),
    versions: byProduct.get(Number(p.product_id)) ?? [],
  }));
}
