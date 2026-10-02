/**
 * List of Rejected Cones Against Weight (IFL's report 6 of 8) — styled after
 * IFL's own SSRS rejected-cones report (30 Sep 2026); titled in IFL's words
 * 1 Oct 2026; rebuilt 1 Oct 2026 (task W1-R6) on the contract task W0 froze.
 *
 * One row per WEIGHT reject, in chronological order: production date, shift,
 * the time of day on the plant clock, winder, hanger, the weight, the product
 * and the limits IN FORCE AT THAT INSTANT, and how far outside them the weight
 * was. Then the cone-weight range (min/max/avg) per winder and for the line
 * over every PLAUSIBLE cone weighed in the period. Winder = station.
 *
 * WHAT THE ROW STATES, AND WHAT IT REFUSES TO.
 *  - THE LIMITS ARE THE ONES IN FORCE AT THE REJECT'S OWN INSTANT, never
 *    today's mirror (productAt.ts `verdict()`, CLAUDE.md section 8): the
 *    reading's own MaterialId when it carries one (every reject since IFL's
 *    2026-08-05 rebuild), else the hand-entered line-wide product at that time
 *    (July). When the oldest known version of a product is used for a reject
 *    that predates it, the row says the limits are "no later than" that
 *    version (`limits.lowerBound`) instead of passing them off as a record.
 *  - A reject with no product recorded, or a product with no limits, states
 *    that in words (`noLimitsReason`) and computes nothing: no distance from a
 *    limit that was never on record.
 *  - `outsideByG` is signed (plus above the upper limit, minus below the
 *    lower) and 0 when the weight is inside the product's limits: the scale
 *    still rejected the cone, and the report says "inside the product's
 *    limits" rather than inventing an excess. The scale's verdict and the
 *    product's limits are two facts under two names (ONE STATUS VOCABULARY).
 *
 * EVERY WEIGHT-REJECT RECORD IS A ROW. The old `weight_g IS NOT NULL` condition
 * is gone: a weight reject whose weight was not recorded is still a weight
 * reject (it prints "—"), so this list's total equals the weight rejects the
 * shift-production report counts for the same period (R1 and R6 agree).
 *
 * ONE GENERATION (generation.ts). The reject list and the cone range read one
 * source generation, resolved once; a period spanning IFL's rebuild or the
 * plant simulator cannot pool two populations, and the report says what it
 * left out (`generationNote`).
 *
 * ZEROED CLOCKS. IFL's zeroed records (production time 1970-01-01, shift date
 * 1969-12-31) cannot be placed in any period; they are left out of the list
 * and counted in `excludedClockFault` so the omission is stated, not silent.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { ShiftCode } from '@sms/shared';
import { plausibleWhere } from '../coneState.js';
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import { loadProductTimeline } from '../productAt.js';
import { loadProductCatalogue } from '../productLimits.js';
import type { ResolvedPeriod } from '../report.js';
import { getPlausibilityRuleAsOf, plantDayEndMs, plantDayStartMs } from '../ruleAsOf.js';
import { csvRowOf, LIST_CAP, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { plantWallClock } from './plantTime.js';
import { shiftRangeClause, type ShiftRange } from '../../shiftRange.js';

/**
 * The limits a rejected cone is judged by: the ones in force at the cone's OWN
 * instant (productAt.ts `verdict()`, the section 8 rule), never today's
 * mirror. `lowerBound` is true when the version that supplied them is one
 * whose start this system only knows "no later than" (productLimits.ts), and
 * prints as such.
 */
export interface RejectedConeLimits {
  /** "1,960 +/- 40 g", ready to print. */
  label: string;
  targetG: number;
  loG: number;
  hiG: number;
  lowerBound: boolean;
}

export interface RejectedConeRow {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
  /** Winder = station; null when the reading carries none. */
  winder: number | null;
  /** The hanger the cone rode (1..299); null when the reject carries none. IFL reports task W0 (1 Oct 2026). */
  hanger: number | null;
  /** The recorded weight; null when the weight-reject record carries none (prints "—"; it is still a weight reject). */
  weightG: number | null;
  /** Plant-clock instant of the reject (production time convention). */
  producedAtUtc: string;
  /** The reading's product (PDAS MaterialId); null when none could be established. */
  productId: number | null;
  /** The product's distinct printable label; null with `productId`. */
  productLabel: string | null;
  /** 'row' = the plant's own MaterialId on the reading; 'timeline' = the hand-entered line-wide product (July); null = none. */
  productSource: 'row' | 'timeline' | null;
  /** Limits in force at this instant; null when none are on record for it (see `noLimitsReason`). */
  limits: RejectedConeLimits | null;
  /** Signed grams outside `limits` (0 when the weight is inside them: the scale still rejected it); null with no limits. */
  outsideByG: number | null;
  /** Why `limits` is null, in plain words ("No product recorded at that time"); null when limits are stated. */
  noLimitsReason: string | null;
}

export interface WeightRangeRow {
  minG: number | null;
  maxG: number | null;
  avgG: number | null;
  /** Plausible cones the range is over. */
  n: number;
}

export interface WeightRangeByWinder extends WeightRangeRow {
  winder: number;
}

export interface RejectedConesReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** Weight rejects, chronological, at most `listCap` of them. */
  list: RejectedConeRow[];
  total: number;
  /** What the period really holds (>= list.length); `listTotal > listCap` means the list was cut and every output says so. */
  listTotal: number;
  /** The most rows any output of this report carries (common.ts LIST_CAP). */
  listCap: number;
  /** Rows dropped as clock faults (production time at or before 1970-01-01: IFL's zeroed-record sentinel). */
  excludedClockFault: number;
  weightRange: {
    line: WeightRangeRow;
    byWinder: WeightRangeByWinder[];
    plausibility: { loG: number; hiG: number };
    /** Cone readings with a weight outside the plausibility window, excluded from every range above. */
    excludedImplausible: number;
  };
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

/** Defaults this report applies until IFL answers; printed as "Assumed until IFL confirms". */
export const REJECTED_CONES_PENDING_IFL: readonly string[] = [
  'Only weight rejects (cones the weighing scale rejected) are listed; IFL has not confirmed whether quality (inspection) rejects belong on this report.',
];

export const REJECTED_CONES_NOTE =
  'Lists weight rejects only (cones the weighing scale rejected); quality (inspection) rejects are not on this page. ' +
  'Each row states the product and the limits that were in force when that cone was weighed; "outside limits by" is signed ' +
  '(plus above the upper limit, minus below the lower limit) and is 0 when the weight is inside the product\'s limits, ' +
  'which the scale rejected nonetheless. The weight range is over every plausible cone weighed in the period, whatever its ' +
  'result; readings outside the plausibility window are excluded and counted. Winder is the weighing station.';

/** The product text a row prints when none could be established. */
export const NO_PRODUCT_AT_TIME = 'No product recorded at that time';
/** What a row says when its product is known but no limits are on record for it. */
export const NO_LIMITS_FOR_PRODUCT = 'No limits on record for this product';

/** The sentence added to `note` when the list was cut at `listCap`: the count above the list is the real one. */
export const rejectedConesCutNote = (shown: number, total: number): string =>
  `Only the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rejected cones are listed in this report; the total is the full count for the period.`;

const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoOf = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

interface RejectQueryRow {
  d: unknown;
  sc: string;
  st: number | null;
  hg: number | null;
  w: number | string | null;
  ts: unknown;
  mid: number | null;
}

export async function getRejectedConesReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<RejectedConesReportData> {
  const { from, to } = resolved;
  // The plausibility window as of the period's END, the one rule for the whole
  // report (RT24-04): editing the rule later cannot re-judge this period.
  const [scope, plausR] = await Promise.all([
    resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'reject_event']),
    getPlausibilityRuleAsOf(pool, lineId, plantDayEndMs(to), plantDayStartMs(from)),
  ]);
  const window = { loG: plausR.rule.coneLoG, hiG: plausR.rule.coneHiG };

  const base = (table: 'cone_event' | 'reject_event') => {
    const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
    let where = 'line_id = @line AND shift_date BETWEEN @from AND @to';
    if (filters.shift) {
      req.input('shift', mssql.VarChar(10), filters.shift);
      where += ' AND shift_code = @shift';
    }
    if (filters.station != null) {
      req.input('station', mssql.Int, filters.station);
      where += ' AND source_station = @station';
    }
    if (shiftRange) where += ` AND ${shiftRangeClause(shiftRange, { date: 'shift_date', code: 'shift_code' }, req)}`;
    return { req, where: andEpoch(where, req, scope, table) };
  };

  const rj = base('reject_event');
  const rc = base('reject_event');
  const cn = base('cone_event');
  const plaus = plausibleWhere(cn.req, 'weight_g', window);
  rj.req.input('cap', mssql.Int, LIST_CAP);

  const [rejects, counts, ranges] = await Promise.all([
    // Every weight-reject RECORD is a row (no `weight_g IS NOT NULL`), except
    // IFL's zeroed-clock records, which no period can reach and which are
    // counted below instead. The list is cut in SQL at the cap.
    rj.req.query<RejectQueryRow>(
      `SELECT TOP (@cap) shift_date AS d, shift_code AS sc, source_station AS st, hanger_num AS hg, weight_g AS w,
              production_ts_utc AS ts, material_id AS mid
         FROM sms.reject_event
        WHERE ${rj.where} AND reject_type = 'weight' AND production_ts_utc_ms > 0
        ORDER BY production_ts_utc_ms, reject_event_id`,
    ),
    // What the period really holds, and how many zeroed-clock records were left out.
    rc.req.query<{ n: number; fault: number | null }>(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN production_ts_utc_ms <= 0 THEN 1 ELSE 0 END) AS fault
         FROM sms.reject_event
        WHERE ${rc.where} AND reject_type = 'weight'`,
    ),
    cn.req.query<{ st: number | null; n: number; sm: number | null; mn: number | null; mx: number | null; bad: number }>(
      `SELECT source_station AS st,
              SUM(CASE WHEN ${plaus} THEN 1 ELSE 0 END) AS n,
              SUM(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) AS sm,
              MIN(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) AS mn,
              MAX(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) AS mx,
              SUM(CASE WHEN weight_g IS NOT NULL AND NOT (${plaus}) THEN 1 ELSE 0 END) AS bad
         FROM sms.cone_event
        WHERE ${cn.where}
        GROUP BY source_station`,
    ),
  ]);

  const countRow = counts.recordset[0];
  const excludedClockFault = Number(countRow?.fault ?? 0);
  const listTotal = Math.max(Number(countRow?.n ?? 0) - excludedClockFault, rejects.recordset.length);

  // The product and the limits in force at each reject's own instant. The
  // timeline and the catalogue are a handful of rows each, loaded once and
  // resolved in memory (productAt.ts); skipped when there is nothing to judge.
  const list: RejectedConeRow[] = [];
  if (rejects.recordset.length > 0) {
    const [timeline, catalogue] = await Promise.all([loadProductTimeline(pool, lineId), loadProductCatalogue(pool)]);
    for (const r of rejects.recordset) {
      const weightG = r.w == null ? null : Number(r.w);
      const v = timeline.verdict(new Date(r.ts as Date | string).getTime(), weightG, {
        productId: r.mid == null ? null : Number(r.mid),
        catalogue,
        // The scale rejected it: that is what a weight reject IS. The product's
        // tolerance is the second, separately named fact this row adds.
        inRange: false,
        plausibility: window,
      });
      const productId = v.product ? v.product.productId : null;
      const limits: RejectedConeLimits | null = v.limits
        ? { label: v.limits.label, targetG: v.limits.targetG, loG: v.limits.loG, hiG: v.limits.hiG, lowerBound: v.limitsAreLowerBound }
        : null;
      list.push({
        date: dayOf(r.d),
        shift: r.sc as ShiftCode,
        winder: r.st == null ? null : Number(r.st),
        // Hanger 0 is the plant's "no hanger" (as in R7's "No hanger recorded" bucket): none, never hanger 0.
        hanger: r.hg == null || Number(r.hg) <= 0 ? null : Number(r.hg),
        weightG,
        producedAtUtc: isoOf(r.ts),
        productId,
        productLabel: productId == null ? null : catalogue.distinctLabel(productId),
        productSource: productId == null ? null : v.attribution,
        limits,
        outsideByG: limits ? v.outsideByG : null,
        noLimitsReason: limits ? null : v.reason === 'no_setpoint' ? NO_LIMITS_FOR_PRODUCT : NO_PRODUCT_AT_TIME,
      });
    }
  }

  let lineN = 0;
  let lineSum = 0;
  let lineMin: number | null = null;
  let lineMax: number | null = null;
  let bad = 0;
  const byWinder: WeightRangeByWinder[] = [];
  for (const r of ranges.recordset) {
    const n = Number(r.n ?? 0);
    bad += Number(r.bad ?? 0);
    if (n > 0) {
      lineN += n;
      lineSum += Number(r.sm ?? 0);
      const mn = Number(r.mn);
      const mx = Number(r.mx);
      lineMin = lineMin == null ? mn : Math.min(lineMin, mn);
      lineMax = lineMax == null ? mx : Math.max(lineMax, mx);
    }
    if (r.st != null) {
      byWinder.push({
        winder: Number(r.st),
        n,
        minG: n > 0 ? round(Number(r.mn)) : null,
        maxG: n > 0 ? round(Number(r.mx)) : null,
        avgG: n > 0 ? round(Number(r.sm) / n) : null,
      });
    }
  }
  byWinder.sort((a, b) => a.winder - b.winder);

  return {
    period: resolved,
    filters,
    lineId,
    list,
    total: listTotal,
    listTotal,
    listCap: LIST_CAP,
    excludedClockFault,
    weightRange: {
      line: { n: lineN, minG: round(lineMin), maxG: round(lineMax), avgG: lineN > 0 ? round(lineSum / lineN) : null },
      byWinder,
      plausibility: window,
      excludedImplausible: bad,
    },
    note: listTotal > list.length ? `${REJECTED_CONES_NOTE} ${rejectedConesCutNote(list.length, listTotal)}` : REJECTED_CONES_NOTE,
    pendingIfl: [...REJECTED_CONES_PENDING_IFL],
    generationNote: noteOf(scope),
  };
}

export const REJECTED_CONES_CSV_HEADERS = [
  'section', 'date', 'shift', 'produced_at_plant_time', 'winder', 'hanger', 'weight_g', 'product', 'material_id', 'limits',
  'target_g', 'lo_g', 'hi_g', 'outside_by_g', 'limits_lower_bound', 'scope', 'n', 'min_g', 'max_g', 'avg_g',
] as const;

/**
 * Two sections only, so the XLSX is two sheets: `rejected_cone` (one row per
 * weight reject) and `weight_range` (`scope` = 'line' once, then 'winder' per
 * winder, with `winder` set). The count, the cut-off and the excluded
 * readings travel as the report's own notes, not as extra table rows.
 *
 * WITH A STATION FILTER the 'line' row is left out: every figure on the page
 * is then that one winder's, and a row labelled "line" over one winder's cones
 * would be a wrong label on a right number. The winder's own row carries it.
 */
export function rejectedConesCsv(d: RejectedConesReportData): CsvTable {
  const H = REJECTED_CONES_CSV_HEADERS;
  const range = (scope: 'line' | 'winder', winder: number | null, r: WeightRangeRow): CsvRow =>
    csvRowOf(H, { section: 'weight_range', scope, winder, n: r.n, min_g: r.minG, max_g: r.maxG, avg_g: r.avgG });
  const station = d.filters?.station ?? null;
  // A winder that weighed nothing in the period still gets its own (empty) row under a station filter.
  const winderRanges: WeightRangeByWinder[] =
    station != null && !d.weightRange.byWinder.some((w) => w.winder === station)
      ? [{ winder: station, minG: null, maxG: null, avgG: null, n: 0 }]
      : d.weightRange.byWinder;
  const rows: CsvRow[] = [
    ...d.list.map((r): CsvRow =>
      csvRowOf(H, {
        section: 'rejected_cone',
        date: r.date,
        shift: r.shift,
        produced_at_plant_time: plantWallClock(r.producedAtUtc),
        winder: r.winder,
        hanger: r.hanger,
        weight_g: r.weightG,
        product: r.productLabel ?? NO_PRODUCT_AT_TIME,
        material_id: r.productId,
        limits: r.limits?.label ?? r.noLimitsReason,
        target_g: r.limits?.targetG,
        lo_g: r.limits?.loG,
        hi_g: r.limits?.hiG,
        outside_by_g: r.outsideByG,
        limits_lower_bound: r.limits ? r.limits.lowerBound : null,
      })),
    ...(station == null ? [range('line', null, d.weightRange.line)] : []),
    ...winderRanges.map((w) => range('winder', w.winder, w)),
  ];
  return { headers: H, rows };
}
