/**
 * Rejected Sack Report - Daily — IFL's report 2 of 8 (their email of
 * 29 Sep 2026), built 1 Oct 2026.
 *
 * FOUR TABLES, ONE READ. Everything comes from the shared sack cell service
 * (`sackCells.ts`): the counts are a pure roll-up of `getSackCells`, the list
 * is `listSacks` restricted to the scale's rejections, and one `SackContext`
 * (ONE generation scope, the weight basis and plausibility window as of the
 * period end) is resolved once and handed to both, so a count and the list it
 * counts can never be read from two source generations. A figure here is the
 * figure the Sack report and the Sacks screen print for the same sacks.
 *   A  per production date and shift: sacks, rejected, % rejected; day totals
 *      and the period total.
 *   B  of the rejected sacks, how many carry an implausible weight (0 kg, a
 *      fault reading, no weight at all) versus a plausible one.
 *   C  the weight range of the sacks the scale PASSED, per product.
 *   D  every rejected sack, oldest first, at most `LIST_CAP` of them.
 *
 * WHAT "REJECTED" MEANS HERE, AND WHAT IT DOES NOT. A rejected sack is one the
 * weighing scale's own in-range bit marked out of range (`in_range = 0`). That
 * includes 0 kg and fault readings. IFL's data holds NO sack tolerance
 * anywhere, so this report never calls a sack underweight or overweight — it
 * states the scale's verdict and, separately, the weight range of the sacks
 * the scale PASSED, as a fact and not as a limit. A sack whose flag is NULL is
 * counted apart (`noFlag`), never as a pass. A sack carries no winder or
 * station at any layer (the plant's one sack scale), so none is attributed.
 *
 * TWO CLOCKS: a sack's time is the plant's INSERT time (the sack scale records
 * no event time of its own; SCHEMA.md DQ-5), so "this shift" is shifted by the
 * acquisition lag and the list labels the time as insert time.
 *
 * THE ZEROED CLOCK. A sack stamped 1970-01-01 (a clock fault) is left out of
 * the LIST and counted in `excludedClockFault`. It carries shift_date
 * 1969-12-31, which no period can reach, so it is also absent from the counts
 * of every reachable period; `excludedClockFault` is the report's statement of
 * that, not a second population.
 */
import type { ConnectionPool } from 'mssql';
import type { ShiftCode } from '@sms/shared';
import type { GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import { loadProductCatalogue } from '../productLimits.js';
import { listSacks, getSackCells, resolveSackContext, rollup, rollupAll } from '../sackCells.js';
import type { SackSummaryQuery } from '../sacks.js';
import { csvRowOf, LIST_CAP, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { plantWallClock } from './plantTime.js';

/** Counts for one cell of the daily table. */
export interface RejectedSackCounts {
  /** Sacks weighed (every sack row). */
  sacks: number;
  /** Sacks the scale marked out of range (`in_range = 0`). */
  rejected: number;
  /** rejected / sacks x 100, 2 dp (a small share must not print as 0.0); null when no sacks. */
  rejectedPct: number | null;
}

/** Table A, one production date and shift. */
export interface RejectedSackShiftRow extends RejectedSackCounts {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
}

/** Table A, one production day (all shifts). */
export interface RejectedSackDayRow extends RejectedSackCounts {
  date: string;
}

/** Table C: what the scale PASSED, per product. A stated fact, not a tolerance. */
export interface RejectedSackPassedRange {
  productId: number | null;
  /** The distinct product label, or "No product on the reading". */
  productLabel: string;
  /** Yarn count from today's product master; null when the sack carries no product. */
  yarnCount: string | null;
  /** Passed sacks with a plausible weight, the population the range is over. */
  sacks: number;
  minKg: number | null;
  maxKg: number | null;
}

/** Table D: one rejected sack. */
export interface RejectedSackRow {
  date: string;
  shift: ShiftCode;
  /** The plant's INSERT time for the sack (production-time convention, render in UTC). */
  producedAtUtc: string;
  /** The scale's sack number (it resets, so it is a label and never a key). */
  sackNum: number | null;
  productId: number | null;
  productLabel: string | null;
  yarnCount: string | null;
  /** Weight in kg under the weight basis in Setup; null when the sack has none. */
  weightKg: number | null;
  /** True when the weight is outside the plausibility window (a 0 kg or fault reading) or the sack has none at all. */
  implausible: boolean;
}

export interface RejectedSacksReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** The weight basis every kg figure is stated under (as-of the period end). */
  weightBasis: string;
  /** The sack plausibility window in force at the period end. */
  plausibility: { loKg: number; hiKg: number };
  /** A: per production date and shift. */
  byShift: RejectedSackShiftRow[];
  /** A: per production day. */
  byDay: RejectedSackDayRow[];
  /** A: the period. `noFlag` = sacks whose in-range flag is NULL, counted apart and never as passes. */
  total: RejectedSackCounts & { noFlag: number };
  /**
   * B: of the rejected sacks, how many carry an implausible weight (0 kg / fault; a sack with no weight at all
   * has no plausible one, so it counts here) versus a plausible one. The two add up to `total.rejected`.
   */
  rejectedSplit: { implausible: number; plausible: number };
  /** C: the range of sacks the scale passed. */
  passedRange: {
    byProduct: RejectedSackPassedRange[];
    all: { sacks: number; minKg: number | null; maxKg: number | null };
  };
  /** D: each rejected sack, chronological, at most `listCap` of them. */
  list: RejectedSackRow[];
  /** What the period really holds; `listTotal > listCap` means the list was cut and every output says so. */
  listTotal: number;
  listCap: number;
  /** Sacks dropped as clock faults (production time at or before 1970-01-01). */
  excludedClockFault: number;
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const REJECTED_SACKS_NOTE =
  'A rejected sack is one the sack scale itself marked out of range, including 0 kg and fault readings. IFL holds no sack ' +
  'tolerance, so no sack is called underweight or overweight; the range of sacks the scale passed is a stated fact, not a limit. ' +
  'A sack with no in-range flag is counted separately and never as a pass. A sack’s time is the plant’s insert time: the sack ' +
  'scale records no event time of its own.';

/** Defaults this report applies until IFL answers; printed as "Assumed until IFL confirms". */
export const REJECTED_SACKS_PENDING_IFL: readonly string[] = [
  'A rejected sack is a sack the scale marked out of range; IFL has not stated a sack tolerance, so none is applied here.',
  'The list includes every sack the scale rejected, 0 kg and fault readings among them; IFL has not said whether those belong in a rejected-sack report.',
  '"Daily" is taken to mean per production day (06:00 to 06:00 plant clock), split into the three shifts.',
  'Yarn counts come from the sack’s product through today’s product master; sacks recorded before 5 August 2026 carry no product.',
];

/** The label for sacks that carry no product (recorded before 5 Aug 2026, or a reading the plant left blank). */
const NO_PRODUCT_LABEL = 'No product on the reading';

/** Shift order within a day. */
const SHIFT_ORDER: readonly ShiftCode[] = ['morning', 'evening', 'night'];
const shiftIdx = (s: string): number => {
  const i = SHIFT_ORDER.indexOf(s as ShiftCode);
  return i < 0 ? SHIFT_ORDER.length : i;
};

/** rejected / sacks as a percentage to 0.01, null when there are no sacks. */
const pct2 = (rejected: number, sacks: number): number | null => (sacks > 0 ? round((100 * rejected) / sacks, 2) : null);

const counts = (sacks: number, rejected: number): RejectedSackCounts => ({ sacks, rejected, rejectedPct: pct2(rejected, sacks) });

/** The roll-up key of the sacks that carry no product. */
const NONE_KEY = '\u0000none';

export async function getRejectedSacksReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<RejectedSacksReportData> {
  const q: SackSummaryQuery = { from: resolved.from, to: resolved.to, shift: filters.shift, product: filters.product, shiftRange };
  // ONE context (generation scope + rules as of the period end) for the counts AND the list. The catalogue only names
  // products and yarn counts (today's product master).
  const ctx = await resolveSackContext(pool, lineId, q);
  const [cellsRes, listRes, catalogue] = await Promise.all([
    getSackCells(pool, lineId, q, ctx),
    listSacks(pool, lineId, q, { inRange: false, cap: LIST_CAP, ctx }),
    loadProductCatalogue(pool),
  ]);
  const cells = cellsRes.cells;

  // A: every sack of a cell counts toward `sacks`; only the scale's own `in_range = 0` counts as rejected.
  const byShift: RejectedSackShiftRow[] = [...rollup(cells, (c) => `${c.date}|${c.shift}`)]
    .map(([k, f]): RejectedSackShiftRow => {
      const [date, shift] = k.split('|') as [string, ShiftCode];
      return { date, shift, ...counts(f.sacks, f.rejected) };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || shiftIdx(a.shift) - shiftIdx(b.shift));
  const byDay: RejectedSackDayRow[] = [...rollup(cells, (c) => c.date)]
    .map(([date, f]): RejectedSackDayRow => ({ date, ...counts(f.sacks, f.rejected) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const all = rollupAll(cells);

  // B: the rejected sacks only. A rejected sack with no weight at all has no plausible weight, so it sits with the
  // implausible ones and the two halves always add up to the rejected count.
  const rej = rollupAll(cells.filter((c) => c.inRange === false));
  const rejectedSplit = { implausible: rej.sacks - rej.plausible, plausible: rej.plausible };

  // C: what the scale PASSED, per product, over plausible weights only. A fact about the readings, not a tolerance.
  const passedCells = cells.filter((c) => c.inRange === true);
  const byProduct: RejectedSackPassedRange[] = [...rollup(passedCells, (c) => (c.materialId == null ? NONE_KEY : String(c.materialId)))]
    .map(([k, f]): RejectedSackPassedRange => {
      const id = k === NONE_KEY ? null : Number(k);
      return {
        productId: id,
        productLabel: id == null ? NO_PRODUCT_LABEL : catalogue.distinctLabel(id),
        yarnCount: id == null ? null : catalogue.product(id)?.countText?.trim() || null,
        sacks: f.plausible,
        minKg: f.minKg,
        maxKg: f.maxKg,
      };
    })
    // Counts read as numbers (18, 20 Slub, 30, 36 ...); a product with no count after them; no product last.
    .sort((a, b) => {
      if ((a.productId == null) !== (b.productId == null)) return a.productId == null ? 1 : -1;
      if ((a.yarnCount == null) !== (b.yarnCount == null)) return a.yarnCount == null ? 1 : -1;
      return (
        (a.yarnCount ?? '').localeCompare(b.yarnCount ?? '', 'en', { numeric: true }) ||
        a.productLabel.localeCompare(b.productLabel, 'en', { numeric: true })
      );
    });
  const passed = rollupAll(passedCells);

  // D: each rejected sack, oldest first. The weight is on the report's basis; a sack with no usable weight is marked.
  const list: RejectedSackRow[] = listRes.rows.map((r): RejectedSackRow => ({
    date: r.date,
    shift: r.shift,
    producedAtUtc: new Date(r.producedAtMs).toISOString(),
    sackNum: r.sackNum,
    productId: r.materialId,
    productLabel: r.materialId == null ? null : catalogue.distinctLabel(r.materialId),
    yarnCount: r.materialId == null ? null : catalogue.product(r.materialId)?.countText?.trim() || null,
    weightKg: r.weightOnBasisKg,
    implausible: r.implausible || r.weightOnBasisKg == null,
  }));

  const note = [
    REJECTED_SACKS_NOTE,
    // A rule version recorded mid-period is applied as it stood at the period END to every sack (RT24-04). Worded as a
    // RECORD, not as a change of value: a version can restate the value already in force.
    ctx.weightRuleChangedInPeriod ? 'Setup recorded a new weight-basis version during this period; the version in force at its end is applied to every sack.' : '',
    ctx.plausibilityRuleChangedInPeriod ? 'Setup recorded a new plausible-weight-window version during this period; the version in force at its end is applied to every sack.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    period: resolved,
    filters,
    lineId,
    weightBasis: cellsRes.weightBasis,
    plausibility: cellsRes.plausibility,
    byShift,
    byDay,
    total: { ...counts(all.sacks, all.rejected), noFlag: all.noFlag },
    rejectedSplit,
    passedRange: { byProduct, all: { sacks: passed.plausible, minKg: passed.minKg, maxKg: passed.maxKg } },
    list,
    listTotal: listRes.total,
    listCap: listRes.cap,
    excludedClockFault: listRes.excludedClockFault,
    note,
    pendingIfl: [...REJECTED_SACKS_PENDING_IFL],
    generationNote: cellsRes.generationNote,
  };
}

export const REJECTED_SACKS_CSV_HEADERS = [
  'section', 'date', 'shift', 'produced_at_plant_time', 'sack_num', 'product', 'material_id', 'yarn_count', 'weight_kg',
  'implausible', 'sacks', 'rejected', 'rejected_pct', 'no_flag', 'min_kg', 'max_kg',
] as const;

/**
 * Sections: `shift_count` and `day_total` (table A), `period_total`,
 * `rejected_split` (B: `implausible` true/false with the sack count),
 * `passed_range` (C, one row per product plus an all-products row) and
 * `rejected_sack` (D).
 */
export function rejectedSacksCsv(d: RejectedSacksReportData): CsvTable {
  const H = REJECTED_SACKS_CSV_HEADERS;
  const rows: CsvRow[] = [
    ...d.byShift.map((r) => csvRowOf(H, { section: 'shift_count', date: r.date, shift: r.shift, sacks: r.sacks, rejected: r.rejected, rejected_pct: r.rejectedPct })),
    ...d.byDay.map((r) => csvRowOf(H, { section: 'day_total', date: r.date, sacks: r.sacks, rejected: r.rejected, rejected_pct: r.rejectedPct })),
    csvRowOf(H, { section: 'period_total', sacks: d.total.sacks, rejected: d.total.rejected, rejected_pct: d.total.rejectedPct, no_flag: d.total.noFlag }),
    csvRowOf(H, { section: 'rejected_split', implausible: true, sacks: d.rejectedSplit.implausible }),
    csvRowOf(H, { section: 'rejected_split', implausible: false, sacks: d.rejectedSplit.plausible }),
    ...d.passedRange.byProduct.map((p) =>
      csvRowOf(H, { section: 'passed_range', product: p.productLabel, material_id: p.productId, yarn_count: p.yarnCount, sacks: p.sacks, min_kg: p.minKg, max_kg: p.maxKg })),
    csvRowOf(H, { section: 'passed_range', product: 'All products', sacks: d.passedRange.all.sacks, min_kg: d.passedRange.all.minKg, max_kg: d.passedRange.all.maxKg }),
    ...d.list.map((r) =>
      csvRowOf(H, {
        section: 'rejected_sack',
        date: r.date,
        shift: r.shift,
        produced_at_plant_time: plantWallClock(r.producedAtUtc),
        sack_num: r.sackNum,
        product: r.productLabel,
        material_id: r.productId,
        yarn_count: r.yarnCount,
        weight_kg: r.weightKg,
        implausible: r.implausible,
      })),
  ];
  return { headers: H, rows };
}
