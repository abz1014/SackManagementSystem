/**
 * The sack stock ledger — roadmap Phase 7 (15 Sep 2026). Line-level only.
 *
 * WHAT IT IS. A running balance of sacks in line stock over a period, derived
 * on read from two sources and never stored as a balance:
 *
 *   1. DERIVED RECEIPTS — every sack weighed at the packing scale
 *      (sms.sack_event) is one receipt into line stock. This is the
 *      developer's reading of "receipt", awaiting IFL (Q28-32): they may mean
 *      empty sacks arriving into a store, which is in no data SMS has. The
 *      reading is stated on the response (`receiptMeaning`) and on screen.
 *   2. MANUAL MOVEMENTS — sms.sack_stock_movement (migration 033): an opening
 *      count, issues out of stock, consumption, corrections, or a receipt
 *      the scale never saw. Recorded by a person at rank 2, an engineer
 *      (IFL's answer to Q43, 15 Sep 2026: the process engineer on the floor
 *      makes sack adjustments; rank 3 was the developer's default before
 *      it), every row through auditedWrite.
 *
 * THE ARITHMETIC, in one place (buildLedger, pure, tested):
 *
 *   opening(first day)  = Σ weighed sacks before `from`
 *                       + Σ manual before `from` (opening + receipt − issue − consumption ± adjustment)
 *   opening(d)          = closing(d − 1)
 *   closing(d)          = opening(d) + openingEntries(d) + receipts(d)
 *                       − issues(d) − consumption(d) + adjustments(d)
 *   receipts(d)         = weighed sacks on d + manual receipts on d
 *
 * An 'opening' movement recorded INSIDE the period (a stock count taken that
 * day) is shown in its own column and added on that day, so the reader can
 * see it rather than find the balance jumped.
 *
 * WHY THERE IS NO MACHINE LEVEL — and why no code path here sets machine_id.
 * The source sack table carries no machine or station column at any layer,
 * the sack PLC publishes four tags and no machine, roadmap rule 6 forbids
 * inferring one from timestamps, and the question to IFL has not been sent
 * (migration 033's header has the full record). `machineLevel` on the
 * response says so in words the screen prints; the CHECK constraint in the
 * database refuses a machine on any row.
 *
 * TWO CLOCKS (CLAUDE.md rule 2). `occurred_at_plant` is the plant's wall
 * clock labelled UTC — the production-time convention — so it sits beside
 * sack_event.production_ts_utc without conversion. The day a movement is
 * counted against is derived under the line's shift rule at write time
 * (the same rule that stamps shift_date on the sacks), so the ledger's day
 * axis IS the register's. The kg column follows the weight rule on file
 * (basis + tare) exactly as production.ts applies it to the sack totals.
 *
 * UNITS. Sacks are the unit every row has; kg is optional on a manual row
 * because IFL has not said which unit the ledger is kept in, nor whether kg
 * is gross or net (Q24/Q29). `kgMissing` counts the manual rows without a
 * weight so the kg balance is never presented as complete when it is not.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { z } from 'zod';
import { plantNowMs } from '@sms/shared';
import { auditedWrite } from './audit.js';
import { shiftWindowAt, type LiveShiftRule } from './live.js';

export const MOVEMENT_TYPES = ['opening', 'receipt', 'issue', 'consumption', 'adjustment'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * What the response says about the per-machine half of the requirement.
 * Plain words, no question numbers: this text reaches the screen and the
 * report (words.ts's rule). The numbers are in the comments above.
 */
export const MACHINE_LEVEL_REASON =
  "Stock is kept for the line, not per machine: the plant's sack record carries no machine or station " +
  'at any layer, the sack scale publishes no machine, and this system does not infer one from which ' +
  'cones were weighed around a sack. The question of how a sack is to be linked to a machine is with ' +
  'the developer to put to IFL and has not been asked.';

export const RECEIPT_MEANING =
  'Every sack weighed at the packing scale counts as one receipt into line stock. That is the ' +
  "developer's reading, not IFL's confirmed definition.";

/* --------------------------------------------------------------- arithmetic */

export interface LedgerFlow {
  sacks: number;
  kg: number;
}

export interface LedgerDay {
  /** Production day (YYYY-MM-DD), the same axis as shift_date on every sack. */
  day: string;
  /** Carried in from the previous day's closing (or the balance before the period). */
  opening: LedgerFlow;
  /** 'opening' movements recorded on this day — a stock count — added on this day. */
  openingEntries: LedgerFlow;
  /** Weighed sacks plus manual receipts. */
  receipts: LedgerFlow;
  /** The derived part of `receipts`: sacks the scale weighed that day. */
  weighed: LedgerFlow;
  issues: LedgerFlow;
  consumption: LedgerFlow;
  /** Signed: a correction may go either way. */
  adjustments: LedgerFlow;
  closing: LedgerFlow;
  /** Manual rows on this day (the stock sheet lists them). */
  movements: number;
}

export interface MaterialLedger {
  materialId: number | null;
  productName: string | null;
  opening: LedgerFlow;
  openingEntries: LedgerFlow;
  receipts: LedgerFlow;
  weighed: LedgerFlow;
  issues: LedgerFlow;
  consumption: LedgerFlow;
  adjustments: LedgerFlow;
  closing: LedgerFlow;
  kgMissing: number;
}

export interface StockLedger {
  from: string;
  to: string;
  product: number | null;
  basis: 'line';
  machineLevel: { enabled: false; reason: string };
  dayBasis: 'production_day';
  sackTimeIsInsertTime: true;
  receiptMeaning: string;
  weightBasis: string;
  tareKg: number;
  opening: LedgerFlow;
  closing: LedgerFlow;
  totals: {
    openingEntries: LedgerFlow;
    receipts: LedgerFlow;
    weighed: LedgerFlow;
    issues: LedgerFlow;
    consumption: LedgerFlow;
    adjustments: LedgerFlow;
  };
  days: LedgerDay[];
  byMaterial: MaterialLedger[];
  /** Manual rows in scope (before and inside the period) with no kg: the kg balance is short by them. */
  kgMissing: number;
}

export interface WeighedFact {
  day: string;
  materialId: number | null;
  sacks: number;
  /** As recorded (raw kg); the basis and tare are applied here, as production.ts does. */
  kg: number;
}

export interface ManualFact {
  day: string;
  materialId: number | null;
  type: MovementType;
  sacks: number;
  kg: number | null;
  /** Rows in this group with no kg. */
  noKg: number;
  /** Rows in this group. */
  rows: number;
}

export interface LedgerFacts {
  from: string;
  to: string;
  product: number | null;
  /** Weighed sacks BEFORE `from`, per material (the `day` field is unused). */
  priorWeighed: Omit<WeighedFact, 'day'>[];
  /** Manual movements BEFORE `from`, per material and type. */
  priorManual: Omit<ManualFact, 'day'>[];
  weighed: WeighedFact[];
  manual: ManualFact[];
  weightBasis: string;
  tareKg: number;
  /** product_id → display name, for byMaterial. */
  products: ReadonlyMap<number, string>;
}

const zero = (): LedgerFlow => ({ sacks: 0, kg: 0 });
const add = (a: LedgerFlow, b: LedgerFlow): LedgerFlow => ({ sacks: a.sacks + b.sacks, kg: a.kg + b.kg });
const sub = (a: LedgerFlow, b: LedgerFlow): LedgerFlow => ({ sacks: a.sacks - b.sacks, kg: a.kg - b.kg });
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const roundFlow = (f: LedgerFlow): LedgerFlow => ({ sacks: f.sacks, kg: round3(f.kg) });

/** The sign a movement type carries in the balance. */
export function signOf(type: MovementType): 1 | -1 {
  return type === 'issue' || type === 'consumption' ? -1 : 1;
}

/** Every production day from `from` to `to`, inclusive, in order. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = d.getTime(); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Weighed kg under the rule on file: net subtracts the tare per sack, as production.ts does. */
function weighedKg(rawKg: number, sacks: number, basis: string, tareKg: number): number {
  return basis === 'net' ? rawKg - tareKg * sacks : rawKg;
}

interface Bucket {
  openingEntries: LedgerFlow;
  receipts: LedgerFlow;
  weighed: LedgerFlow;
  issues: LedgerFlow;
  consumption: LedgerFlow;
  adjustments: LedgerFlow;
  movements: number;
  kgMissing: number;
}
const emptyBucket = (): Bucket => ({
  openingEntries: zero(), receipts: zero(), weighed: zero(), issues: zero(), consumption: zero(), adjustments: zero(),
  movements: 0, kgMissing: 0,
});
function applyManual(b: Bucket, m: Omit<ManualFact, 'day'>): void {
  const flow: LedgerFlow = { sacks: m.sacks, kg: m.kg ?? 0 };
  switch (m.type) {
    case 'opening': b.openingEntries = add(b.openingEntries, flow); break;
    case 'receipt': b.receipts = add(b.receipts, flow); break;
    case 'issue': b.issues = add(b.issues, flow); break;
    case 'consumption': b.consumption = add(b.consumption, flow); break;
    case 'adjustment': b.adjustments = add(b.adjustments, flow); break;
  }
  b.movements += m.rows;
  b.kgMissing += m.noKg;
}
function applyWeighed(b: Bucket, w: Omit<WeighedFact, 'day'>, basis: string, tareKg: number): void {
  const flow: LedgerFlow = { sacks: w.sacks, kg: weighedKg(w.kg, w.sacks, basis, tareKg) };
  b.weighed = add(b.weighed, flow);
  b.receipts = add(b.receipts, flow);
}
/** closing = opening + openingEntries + receipts − issues − consumption + adjustments. */
function closeOf(opening: LedgerFlow, b: Bucket): LedgerFlow {
  return add(sub(sub(add(add(opening, b.openingEntries), b.receipts), b.issues), b.consumption), b.adjustments);
}

const materialKey = (id: number | null): string => (id == null ? 'none' : String(id));

/**
 * The ledger from pre-aggregated facts. Pure, so the arithmetic is tested
 * against numbers a reader can do by hand; getStockLedger only fetches.
 */
export function buildLedger(f: LedgerFacts): StockLedger {
  // Opening balance before the period, per material and overall.
  const priorByMat = new Map<string, Bucket>();
  const bucketFor = (map: Map<string, Bucket>, id: number | null): Bucket => {
    const k = materialKey(id);
    return map.get(k) ?? map.set(k, emptyBucket()).get(k)!;
  };
  for (const w of f.priorWeighed) applyWeighed(bucketFor(priorByMat, w.materialId), w, f.weightBasis, f.tareKg);
  for (const m of f.priorManual) applyManual(bucketFor(priorByMat, m.materialId), m);
  const openingByMat = new Map<string, LedgerFlow>();
  let opening = zero();
  let kgMissing = 0;
  for (const [k, b] of priorByMat) {
    const o = closeOf(zero(), b);
    openingByMat.set(k, o);
    opening = add(opening, o);
    kgMissing += b.kgMissing;
  }

  // Per day, overall.
  const byDay = new Map<string, Bucket>();
  const dayBucket = (day: string): Bucket => byDay.get(day) ?? byDay.set(day, emptyBucket()).get(day)!;
  for (const w of f.weighed) applyWeighed(dayBucket(w.day), w, f.weightBasis, f.tareKg);
  for (const m of f.manual) applyManual(dayBucket(m.day), m);

  const days: LedgerDay[] = [];
  let carried = opening;
  const totals = emptyBucket();
  for (const day of daysOf(f.from, f.to)) {
    const b = byDay.get(day) ?? emptyBucket();
    const closing = closeOf(carried, b);
    days.push({
      day,
      opening: roundFlow(carried),
      openingEntries: roundFlow(b.openingEntries),
      receipts: roundFlow(b.receipts),
      weighed: roundFlow(b.weighed),
      issues: roundFlow(b.issues),
      consumption: roundFlow(b.consumption),
      adjustments: roundFlow(b.adjustments),
      closing: roundFlow(closing),
      movements: b.movements,
    });
    totals.openingEntries = add(totals.openingEntries, b.openingEntries);
    totals.receipts = add(totals.receipts, b.receipts);
    totals.weighed = add(totals.weighed, b.weighed);
    totals.issues = add(totals.issues, b.issues);
    totals.consumption = add(totals.consumption, b.consumption);
    totals.adjustments = add(totals.adjustments, b.adjustments);
    kgMissing += b.kgMissing;
    carried = closing;
  }

  // Per material over the whole period.
  const periodByMat = new Map<string, Bucket>();
  for (const w of f.weighed) applyWeighed(bucketFor(periodByMat, w.materialId), w, f.weightBasis, f.tareKg);
  for (const m of f.manual) applyManual(bucketFor(periodByMat, m.materialId), m);
  const keys = new Set<string>([...openingByMat.keys(), ...periodByMat.keys()]);
  const byMaterial: MaterialLedger[] = [...keys]
    .map((k) => {
      const id = k === 'none' ? null : Number(k);
      const b = periodByMat.get(k) ?? emptyBucket();
      const o = openingByMat.get(k) ?? zero();
      return {
        materialId: id,
        productName: id == null ? null : (f.products.get(id) ?? null),
        opening: roundFlow(o),
        openingEntries: roundFlow(b.openingEntries),
        receipts: roundFlow(b.receipts),
        weighed: roundFlow(b.weighed),
        issues: roundFlow(b.issues),
        consumption: roundFlow(b.consumption),
        adjustments: roundFlow(b.adjustments),
        closing: roundFlow(closeOf(o, b)),
        kgMissing: (priorByMat.get(k)?.kgMissing ?? 0) + b.kgMissing,
      };
    })
    // Named products first, by name; the no-product bucket last.
    .sort((a, b) => (a.materialId == null ? 1 : b.materialId == null ? -1 : (a.productName ?? '').localeCompare(b.productName ?? '')));

  return {
    from: f.from,
    to: f.to,
    product: f.product,
    basis: 'line',
    machineLevel: { enabled: false, reason: MACHINE_LEVEL_REASON },
    dayBasis: 'production_day',
    sackTimeIsInsertTime: true,
    receiptMeaning: RECEIPT_MEANING,
    weightBasis: f.weightBasis,
    tareKg: f.tareKg,
    opening: roundFlow(opening),
    closing: roundFlow(carried),
    totals: {
      openingEntries: roundFlow(totals.openingEntries),
      receipts: roundFlow(totals.receipts),
      weighed: roundFlow(totals.weighed),
      issues: roundFlow(totals.issues),
      consumption: roundFlow(totals.consumption),
      adjustments: roundFlow(totals.adjustments),
    },
    days,
    byMaterial,
    kgMissing,
  };
}

/* ------------------------------------------------------------------ reads */

export interface LedgerQuery {
  from: string;
  to: string;
  product?: number;
  /** Replay cap (an ISO instant on the production-time convention), as every other period query. */
  tsTo?: string;
}

interface WeighedRow { day: string | null; material_id: number | null; n: number; kg: number }
interface ManualRow { day: string | null; material_id: number | null; movement_type: MovementType; sacks: number; kg: number | null; nokg: number; n_rows: number }

export async function getStockLedger(pool: ConnectionPool, lineId: number, q: LedgerQuery): Promise<StockLedger> {
  const tsToMs = q.tsTo ? new Date(q.tsTo).getTime() : null;
  const bind = (req: mssql.Request, withPeriod: boolean) => {
    req.input('line', mssql.Int, lineId).input('from', mssql.Date, q.from);
    if (withPeriod) req.input('to', mssql.Date, q.to);
    if (q.product != null) req.input('product', mssql.Int, q.product);
    if (tsToMs != null) {
      req.input('tsTo', mssql.BigInt, tsToMs);
      req.input('tsToDt', mssql.DateTime2(3), new Date(tsToMs));
    }
    return req;
  };
  const productClause = (col: string) => (q.product != null ? ` AND ${col} = @product` : '');

  // 1. Weighed sacks before the period, per material.
  const priorWeighedReq = bind(pool.request(), false);
  const priorWeighed = await priorWeighedReq.query<WeighedRow>(
    `SELECT NULL AS day, material_id, COUNT(*) n, ISNULL(SUM(weight_kg), 0) kg
       FROM sms.sack_event
      WHERE line_id = @line AND shift_date < @from${productClause('material_id')}
      GROUP BY material_id`,
  );
  // 2. Manual movements before the period, per material and type.
  const priorManualReq = bind(pool.request(), false);
  const priorManual = await priorManualReq.query<ManualRow>(
    `SELECT NULL AS day, material_id, movement_type,
            ISNULL(SUM(quantity_sacks), 0) sacks, SUM(quantity_kg) kg,
            SUM(CASE WHEN quantity_kg IS NULL THEN 1 ELSE 0 END) nokg, COUNT(*) n_rows
       FROM sms.sack_stock_movement
      WHERE line_id = @line AND production_day < @from${productClause('material_id')}
      GROUP BY material_id, movement_type`,
  );
  // 3. Weighed sacks in the period, per day and material. production_ts_utc_ms
  //    leads the merge index, so the replay cap stays a seek (production.ts).
  const weighedReq = bind(pool.request(), true);
  const weighed = await weighedReq.query<WeighedRow>(
    `SELECT CONVERT(varchar(10), shift_date, 120) AS day, material_id, COUNT(*) n, ISNULL(SUM(weight_kg), 0) kg
       FROM sms.sack_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to${productClause('material_id')}` +
      (tsToMs != null ? ' AND production_ts_utc_ms <= @tsTo' : '') +
      ` GROUP BY shift_date, material_id`,
  );
  // 4. Manual movements in the period, per day, material and type.
  const manualReq = bind(pool.request(), true);
  const manual = await manualReq.query<ManualRow>(
    `SELECT CONVERT(varchar(10), production_day, 120) AS day, material_id, movement_type,
            ISNULL(SUM(quantity_sacks), 0) sacks, SUM(quantity_kg) kg,
            SUM(CASE WHEN quantity_kg IS NULL THEN 1 ELSE 0 END) nokg, COUNT(*) n_rows
       FROM sms.sack_stock_movement
      WHERE line_id = @line AND production_day BETWEEN @from AND @to${productClause('material_id')}` +
      (tsToMs != null ? ' AND occurred_at_plant <= @tsToDt' : '') +
      ` GROUP BY production_day, material_id, movement_type`,
  );
  // 5. The weight rule on file — the same read production.ts makes.
  const wr = await pool.request().input('line', mssql.Int, lineId).query<{ basis: string; tare: number }>(
    `SELECT TOP 1 basis, sack_tare_kg AS tare FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  // 6. Product names (a few dozen rows).
  const prod = await pool.request().query<{ product_id: number; name: string | null }>(
    `SELECT product_id, COALESCE(description, lot_code) AS name FROM sms.product`,
  );

  const toWeighed = (r: WeighedRow): WeighedFact => ({
    day: r.day ?? '', materialId: r.material_id == null ? null : Number(r.material_id), sacks: Number(r.n), kg: Number(r.kg),
  });
  const toManual = (r: ManualRow): ManualFact => ({
    day: r.day ?? '',
    materialId: r.material_id == null ? null : Number(r.material_id),
    type: r.movement_type,
    sacks: Number(r.sacks),
    kg: r.kg == null ? null : Number(r.kg),
    noKg: Number(r.nokg),
    rows: Number(r.n_rows),
  });
  return buildLedger({
    from: q.from,
    to: q.to,
    product: q.product ?? null,
    priorWeighed: priorWeighed.recordset.map(toWeighed),
    priorManual: priorManual.recordset.map(toManual),
    weighed: weighed.recordset.map(toWeighed),
    manual: manual.recordset.map(toManual),
    weightBasis: wr.recordset[0]?.basis ?? 'as_recorded',
    tareKg: Number(wr.recordset[0]?.tare ?? 0),
    products: new Map(prod.recordset.map((p) => [Number(p.product_id), p.name ?? `Product ${p.product_id}`])),
  });
}

/* -------------------------------------------------------------- movements */

export interface Movement {
  movementId: number;
  materialId: number | null;
  productName: string | null;
  /** Always null (migration 033's CHECK); carried so a screen can say so rather than assume. */
  machineId: null;
  movementType: MovementType;
  quantitySacks: number;
  quantityKg: number | null;
  /** Plant wall clock labelled UTC — format with the production-time formatters. */
  occurredAtPlant: string;
  productionDay: string;
  /** Genuine UTC — format with fmtAppInstant. */
  recordedAtUtc: string;
  recordedBy: { userId: number; name: string } | null;
  source: 'derived' | 'manual';
  reason: string | null;
}

export interface MovementsPage {
  from: string;
  to: string;
  movements: Movement[];
  /** Sacks the scale weighed on each day in the range: the derived receipts beside the manual rows. */
  weighed: { day: string; sacks: number; kg: number }[];
  machineLevel: { enabled: false; reason: string };
}

interface MovementRow {
  movement_id: number; material_id: number | null; product_name: string | null; movement_type: MovementType;
  quantity_sacks: number; quantity_kg: number | null; occurred_at_plant: Date; production_day: Date | string;
  recorded_at_utc: Date; recorded_by: number | null; recorded_by_name: string | null; recorded_by_username: string | null;
  source: 'derived' | 'manual'; reason: string | null;
}

function mapMovement(r: MovementRow): Movement {
  const day = r.production_day instanceof Date ? r.production_day.toISOString().slice(0, 10) : String(r.production_day).slice(0, 10);
  return {
    movementId: Number(r.movement_id),
    materialId: r.material_id == null ? null : Number(r.material_id),
    productName: r.product_name,
    machineId: null,
    movementType: r.movement_type,
    quantitySacks: Number(r.quantity_sacks),
    quantityKg: r.quantity_kg == null ? null : Number(r.quantity_kg),
    occurredAtPlant: new Date(r.occurred_at_plant).toISOString(),
    productionDay: day,
    recordedAtUtc: new Date(r.recorded_at_utc).toISOString(),
    recordedBy: r.recorded_by == null ? null : { userId: Number(r.recorded_by), name: r.recorded_by_name ?? r.recorded_by_username ?? `user ${r.recorded_by}` },
    source: r.source,
    reason: r.reason,
  };
}

const MOVEMENT_COLS = `m.movement_id, m.material_id, COALESCE(p.description, p.lot_code) AS product_name,
       m.movement_type, m.quantity_sacks, m.quantity_kg, m.occurred_at_plant, m.production_day,
       m.recorded_at_utc, m.recorded_by, u.display_name AS recorded_by_name, u.username AS recorded_by_username,
       m.source, m.reason`;
const MOVEMENT_FROM = `sms.sack_stock_movement m
  LEFT JOIN sms.product p ON p.product_id = m.material_id
  LEFT JOIN sms.app_user u ON u.user_id = m.recorded_by`;

export async function listMovements(
  pool: ConnectionPool,
  lineId: number,
  q: { from: string; to: string; product?: number },
): Promise<MovementsPage> {
  const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, q.from).input('to', mssql.Date, q.to);
  if (q.product != null) req.input('product', mssql.Int, q.product);
  const productClause = q.product != null ? ' AND m.material_id = @product' : '';
  const rows = await req.query<MovementRow>(
    `SELECT ${MOVEMENT_COLS} FROM ${MOVEMENT_FROM}
      WHERE m.line_id = @line AND m.production_day BETWEEN @from AND @to${productClause}
      ORDER BY m.occurred_at_plant DESC, m.movement_id DESC`,
  );
  const wReq = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, q.from).input('to', mssql.Date, q.to);
  if (q.product != null) wReq.input('product', mssql.Int, q.product);
  const weighed = await wReq.query<{ day: string; n: number; kg: number }>(
    `SELECT CONVERT(varchar(10), shift_date, 120) AS day, COUNT(*) n, ISNULL(SUM(weight_kg), 0) kg
       FROM sms.sack_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to${q.product != null ? ' AND material_id = @product' : ''}
      GROUP BY shift_date ORDER BY shift_date`,
  );
  return {
    from: q.from,
    to: q.to,
    movements: rows.recordset.map(mapMovement),
    weighed: weighed.recordset.map((w) => ({ day: w.day, sacks: Number(w.n), kg: round3(Number(w.kg)) })),
    machineLevel: { enabled: false, reason: MACHINE_LEVEL_REASON },
  };
}

/* ------------------------------------------------------------- validation */

/**
 * A plant wall-clock instant as typed on the form ("2026-09-15T10:30", with
 * or without seconds, with or without a trailing Z). The value is the
 * PLANT's clock either way: a browser's `datetime-local` has no zone, and a
 * Z here would be the browser's idea of UTC, which is not this app's
 * production-time convention. Returned on that convention (labelled UTC), or
 * null when malformed.
 */
export function parsePlantLocal(s: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?Z?$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}.${(m[5] ?? '0').padEnd(3, '0')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const movementSchema = z.object({
  movementType: z.enum(MOVEMENT_TYPES),
  quantitySacks: z.coerce.number().int(),
  quantityKg: z.coerce.number().finite().nullable().optional(),
  materialId: z.coerce.number().int().positive().nullable().optional(),
  occurredAtPlant: z.string().min(1),
  reason: z.string().max(255).nullable().optional(),
});
export type MovementInput = z.infer<typeof movementSchema>;

export interface ValidMovement {
  movementType: MovementType;
  quantitySacks: number;
  quantityKg: number | null;
  materialId: number | null;
  occurredAtPlant: Date;
  reason: string | null;
}

/** An hour of clock skew between the browser and the plant is ordinary; a day is a typo. */
const FUTURE_ALLOWANCE_MS = 60 * 60_000;

/**
 * The rules a movement must satisfy, beyond its shape. Pure, so the tests
 * state each rule as a case. `nowPlantMs` is the plant clock, injected so a
 * test does not depend on the wall clock of the machine it runs on.
 */
export function validateMovement(body: unknown, nowPlantMs: number = plantNowMs()): { ok: true; value: ValidMovement } | { ok: false; error: string } {
  const parsed = movementSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') };
  }
  const m = parsed.data;
  if (m.quantitySacks === 0) return { ok: false, error: 'quantitySacks must not be zero — a movement moves something' };
  if (m.quantitySacks < 0 && m.movementType !== 'adjustment') {
    return { ok: false, error: `quantitySacks must be positive for ${m.movementType}; only an adjustment may be negative` };
  }
  if (m.quantityKg != null && m.quantityKg < 0 && m.movementType !== 'adjustment') {
    return { ok: false, error: `quantityKg must not be negative for ${m.movementType}; only an adjustment may be negative` };
  }
  if (m.quantityKg != null && Math.abs(m.quantityKg) > 999_999) return { ok: false, error: 'quantityKg is out of range' };
  const at = parsePlantLocal(m.occurredAtPlant);
  if (!at) return { ok: false, error: 'occurredAtPlant must be a plant-clock time like 2026-09-15T10:30' };
  if (at.getTime() > nowPlantMs + FUTURE_ALLOWANCE_MS) return { ok: false, error: 'occurredAtPlant is in the future on the plant clock' };
  if (at.getUTCFullYear() < 2000) return { ok: false, error: 'occurredAtPlant is before this plant kept records' };
  const reason = m.reason?.trim() || null;
  if (m.movementType === 'adjustment' && !reason) return { ok: false, error: 'an adjustment needs a reason' };
  return {
    ok: true,
    value: {
      movementType: m.movementType,
      quantitySacks: m.quantitySacks,
      quantityKg: m.quantityKg ?? null,
      materialId: m.materialId ?? null,
      occurredAtPlant: at,
      reason,
    },
  };
}

/** Whether the product master mirror knows this material. */
export async function productExists(pool: ConnectionPool, productId: number): Promise<boolean> {
  const r = await pool.request().input('id', mssql.Int, productId).query<{ n: number }>(
    `SELECT COUNT(*) n FROM sms.product WHERE product_id = @id`,
  );
  return Number(r.recordset[0]?.n ?? 0) > 0;
}

/**
 * Write one manual movement and its audit row in one transaction.
 *
 * The column list has no machine_id, on purpose and by contract: no code
 * path sets it (migration 033). The production day is derived here, under
 * the shift rule the caller loaded, from the plant-clock instant — the same
 * derivation shiftWindowAt performs for the live screens and the transform
 * performs for every sack.
 */
export async function insertMovement(
  pool: ConnectionPool,
  lineId: number,
  actorId: number,
  m: ValidMovement,
  rule: LiveShiftRule,
): Promise<{ movementId: number; productionDay: string; recordedAtUtc: string }> {
  const productionDay = shiftWindowAt(m.occurredAtPlant.getTime(), rule.nightBelongsTo, rule.boundaries).shiftDate;
  const detail =
    `${m.movementType} ${m.quantitySacks} sacks` +
    (m.quantityKg != null ? ` / ${m.quantityKg} kg` : '') +
    (m.materialId != null ? ` product ${m.materialId}` : '') +
    ` at ${m.occurredAtPlant.toISOString().slice(0, 16).replace('T', ' ')} plant time (day ${productionDay})` +
    (m.reason ? ` — ${m.reason}` : '');
  return auditedWrite(pool, actorId, { action: 'stock.movement', targetType: 'sack_stock_movement', targetId: null, detail }, async (tx) => {
    const r = await tx
      .request()
      .input('line', mssql.Int, lineId)
      .input('material', mssql.Int, m.materialId)
      .input('type', mssql.VarChar(12), m.movementType)
      .input('sacks', mssql.Int, m.quantitySacks)
      .input('kg', mssql.Decimal(12, 3), m.quantityKg)
      .input('at', mssql.DateTime2(3), m.occurredAtPlant)
      .input('day', mssql.Date, productionDay)
      .input('by', mssql.Int, actorId)
      .input('reason', mssql.NVarChar(255), m.reason)
      .query<{ movement_id: number; recorded_at_utc: Date }>(
        `INSERT INTO sms.sack_stock_movement
           (line_id, material_id, movement_type, quantity_sacks, quantity_kg, occurred_at_plant, production_day, recorded_by, source, reason)
         OUTPUT inserted.movement_id, inserted.recorded_at_utc
         VALUES (@line, @material, @type, @sacks, @kg, @at, @day, @by, 'manual', @reason)`,
      );
    const row = r.recordset[0];
    const movementId = Number(row?.movement_id ?? 0);
    return {
      result: {
        movementId,
        productionDay,
        recordedAtUtc: row?.recorded_at_utc ? new Date(row.recorded_at_utc).toISOString() : new Date().toISOString(),
      },
      targetId: movementId,
    };
  });
}
