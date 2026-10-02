/**
 * Sack Packing Weight Summary — IFL's report 5 of 8 (their email of
 * 29 Sep 2026), built 1 Oct 2026. It sits BESIDE the existing 'sack'
 * report (sack.ts), which is kept: that one is a sack-and-cone production
 * summary, this is the per-shift sack-weight table IFL named.
 *
 * EVERY figure comes from one cell grouping (`sackCells.ts` `getSackCells`)
 * and a pure roll-up of it, so a number here is the number the corrected
 * Sack report and the Sacks screen print for the same sacks.
 *
 * PER PRODUCTION DATE AND SHIFT: sacks, kilograms (EVERY sack, weight basis
 * applied), average, min, max and sample standard deviation (PLAUSIBLE sacks
 * only — the excluded count is stated on each row), and the sacks the scale
 * rejected. Then day subtotals, shift totals, a block by yarn count and the
 * period total. The yarn count mapping uses today's product master.
 *
 * WHAT THIS REPORT WILL NOT DO. It never calls a sack under- or over-weight:
 * IFL's data holds no sack tolerance, and the scale's own pass/reject bit is
 * the only verdict there is ("rejected by scale" — ONE STATUS VOCABULARY).
 * It never attributes a sack to a winder or machine: the plant's one sack
 * scale records none. A sack's time is the plant's insert time.
 */
import type { ConnectionPool } from 'mssql';
import type { ShiftCode } from '@sms/shared';
import type { GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import { loadProductCatalogue } from '../productLimits.js';
import { getSackCells, rollup, rollupAll, type SackCell, type SackFigures } from '../sackCells.js';
import { csvRowOf, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

/** The figures every row of the summary carries. */
export interface SackSummaryFigures {
  /** Sacks weighed (every sack row). */
  sacks: number;
  /** Kilograms over every sack, weight basis applied, to the thousandth (rows add to the total exactly). */
  kg: number;
  /** Mean over sacks with a plausible weight; null when none. */
  avgKg: number | null;
  /** Lightest / heaviest plausible sack. */
  minKg: number | null;
  maxKg: number | null;
  /** Sample standard deviation over plausible sacks; null when fewer than two. */
  sdKg: number | null;
  /** Sacks the scale marked out of range (`in_range = 0`). */
  rejectedByScale: number;
  /** Sacks with an implausible weight, excluded from avg / min / max / sd (still in sacks and kg). */
  implausible: number;
}

/** One production date and shift. */
export interface SackSummaryRow extends SackSummaryFigures {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
}

export interface SackSummaryDayTotal extends SackSummaryFigures {
  date: string;
}

export interface SackSummaryShiftTotal extends SackSummaryFigures {
  shift: ShiftCode;
}

/** One yarn count over the period (or the no-product bucket, `yarnCount` null). */
export interface SackSummaryCountRow extends SackSummaryFigures {
  /** Count text from today's product master; null for sacks with no product, or whose product has no count on record. */
  yarnCount: string | null;
  /** What the row prints: the count, "Count not on record", or "No product on the reading". */
  label: string;
  /** The PDAS material ids that map to this count in the period, ascending. */
  materialIds: number[];
}

export interface SackWeightSummaryReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** The weight basis every kg figure is stated under (as-of the period end). */
  weightBasis: string;
  /** The sack plausibility window in force at the period end. */
  plausibility: { loKg: number; hiKg: number };
  /** Per production date and shift, chronological (morning, evening, night within a day). */
  rows: SackSummaryRow[];
  /** Per production date. */
  dayTotals: SackSummaryDayTotal[];
  /** Per shift over the period. */
  shiftTotals: SackSummaryShiftTotal[];
  /** Per yarn count, ascending, the no-product bucket last. */
  byYarnCount: SackSummaryCountRow[];
  total: SackSummaryFigures;
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const SACK_WEIGHT_SUMMARY_NOTE =
  'Sacks packed and their weight per production date and shift. Kilograms cover every sack; average, lightest, heaviest ' +
  'and standard deviation cover sacks with a plausible weight only, and the number left out is stated. "Rejected by scale" ' +
  'is the sack scale’s own verdict: no sack tolerance exists in the plant’s data, so no sack is called under- or over-weight. ' +
  'A sack’s time is the plant’s insert time: the sack scale records no event time of its own, and it records no machine.';

/** The label of the bucket for sacks that carry no product (before 5 Aug 2026, or a reading the plant left blank). */
export const NO_PRODUCT_LABEL = 'No product on the reading';
/** A sack whose product is not in today's product master, or has no count on it. */
export const NO_COUNT_LABEL = 'Count not on record';

/** How the weight basis reads in the report's own note. */
function basisSentence(basis: string, tareKg: number): string {
  if (basis === 'net') return `Weights are net: the ${tareKg} kg sack tare set in Setup is subtracted from every sack.`;
  return 'Weights are as the plant recorded them: nothing is subtracted.';
}

const kgText = (n: number): string => String(round(n, 3));

/**
 * "Assumed until IFL confirms": the defaults this report applied while IFL has
 * not answered. Built from the period's own basis and window so the sentence
 * states the number that was actually used.
 */
export function sackWeightSummaryPendingIfl(basis: string, tareKg: number, loKg: number, hiKg: number): string[] {
  const out: string[] = [];
  if (basis === 'net') {
    out.push(`Weights are shown net of a ${kgText(tareKg)} kg sack tare set in Setup. IFL has not confirmed the tare weight.`);
  }
  out.push(
    `Sacks weighing less than ${kgText(loKg)} kg or more than ${kgText(hiKg)} kg (the plausible window set in Setup) are left out of the average, ` +
      'lightest, heaviest and standard deviation, and counted as implausible. IFL has not confirmed the window.',
  );
  out.push('Standard deviation is the sample standard deviation (divided by n − 1). IFL has not said which convention its own sheets use.');
  out.push('Yarn counts come from the sack’s product through today’s product master; sacks recorded before 5 August 2026 carry no product.');
  return out;
}

/** Shift order within a day. */
const SHIFT_ORDER: readonly ShiftCode[] = ['morning', 'evening', 'night'];
const shiftIdx = (s: string): number => {
  const i = SHIFT_ORDER.indexOf(s as ShiftCode);
  return i < 0 ? SHIFT_ORDER.length : i;
};

/**
 * What a row carries: kilograms to the thousandth (the cells hold exact
 * thousandths and the roll-up sums them as integers, so every row, day, shift
 * and count adds to the grand total EXACTLY — a CSV/XLSX reader can check that
 * with a SUM; rounding to 0.1 here would have broken it, 1 Oct 2026 gate round
 * 3), average 0.01, spread 0.001. The screen shows kilograms to 0.1, as the
 * Sack report does; that is a display choice, not the exported figure.
 */
function figuresOf(f: SackFigures): SackSummaryFigures {
  return {
    sacks: f.sacks,
    kg: round(f.kg, 3) ?? 0,
    avgKg: f.avgKg,
    minKg: f.minKg,
    maxKg: f.maxKg,
    sdKg: round(f.sdKg, 3),
    rejectedByScale: f.rejected,
    implausible: f.implausible,
  };
}

const NONE_KEY = '\u0000none';
const UNKNOWN_KEY = '\u0000unknown';

export async function getSackWeightSummaryReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<SackWeightSummaryReportData> {
  const q = { from: resolved.from, to: resolved.to, shift: filters.shift, product: filters.product, shiftRange };
  // One generation, one rule set, one read: the cells; the catalogue only
  // names yarn counts (today's product master).
  const [res, catalogue] = await Promise.all([getSackCells(pool, lineId, q), loadProductCatalogue(pool)]);
  const cells = res.cells;

  const rows: SackSummaryRow[] = [...rollup(cells, (c) => `${c.date}|${c.shift}`)]
    .map(([k, f]): SackSummaryRow => {
      const [date, shift] = k.split('|') as [string, ShiftCode];
      return { date, shift, ...figuresOf(f) };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || shiftIdx(a.shift) - shiftIdx(b.shift));

  const dayTotals: SackSummaryDayTotal[] = [...rollup(cells, (c) => c.date)]
    .map(([date, f]) => ({ date, ...figuresOf(f) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const shiftTotals: SackSummaryShiftTotal[] = [...rollup(cells, (c) => c.shift)]
    .map(([shift, f]) => ({ shift, ...figuresOf(f) }))
    .sort((a, b) => shiftIdx(a.shift) - shiftIdx(b.shift));

  // Yarn counts: the sack's own material -> today's product master -> count
  // text. Two materials with the same count text share one row (their ids are
  // listed); a sack with no material, and a sack whose material has no count
  // on record, are two different facts and get two different rows.
  const countKey = (c: SackCell): string => {
    if (c.materialId == null) return NONE_KEY;
    const text = catalogue.product(c.materialId)?.countText?.trim();
    return text ? text : UNKNOWN_KEY;
  };
  const idsByKey = new Map<string, Set<number>>();
  for (const c of cells) {
    if (c.materialId == null) continue;
    const k = countKey(c);
    const set = idsByKey.get(k) ?? new Set<number>();
    set.add(c.materialId);
    idsByKey.set(k, set);
  }
  const rank = (k: string): number => (k === NONE_KEY ? 2 : k === UNKNOWN_KEY ? 1 : 0);
  const byYarnCount: SackSummaryCountRow[] = [...rollup(cells, countKey)]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }))
    .map(([k, f]): SackSummaryCountRow => ({
      yarnCount: k === NONE_KEY || k === UNKNOWN_KEY ? null : k,
      label: k === NONE_KEY ? NO_PRODUCT_LABEL : k === UNKNOWN_KEY ? NO_COUNT_LABEL : k,
      materialIds: [...(idsByKey.get(k) ?? [])].sort((a, b) => a - b),
      ...figuresOf(f),
    }));

  const note = [
    SACK_WEIGHT_SUMMARY_NOTE,
    basisSentence(res.weightBasis, res.tareKg),
    // A rule version recorded mid-period is applied as it stood at the period END
    // to every sack (RT24-04); a reader comparing two halves of the period must
    // know. Worded as a RECORD, not as a change of value: the service flags that
    // a version was saved inside the period, and a version can restate the
    // value already in force (this plant's history holds several that do).
    res.weightRuleChangedInPeriod ? 'Setup recorded a new weight-basis version during this period; the version in force at its end is applied to every sack.' : '',
    res.plausibilityRuleChangedInPeriod ? 'Setup recorded a new plausible-weight-window version during this period; the version in force at its end is applied to every sack.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    period: resolved,
    filters,
    lineId,
    weightBasis: res.weightBasis,
    plausibility: res.plausibility,
    rows,
    dayTotals,
    shiftTotals,
    byYarnCount,
    total: figuresOf(rollupAll(cells)),
    note,
    pendingIfl: sackWeightSummaryPendingIfl(res.weightBasis, res.tareKg, res.plausibility.loKg, res.plausibility.hiKg),
    generationNote: res.generationNote,
  };
}

export const SACK_WEIGHT_SUMMARY_CSV_HEADERS = [
  'section', 'date', 'shift', 'yarn_count', 'material_ids', 'sacks', 'kg', 'avg_kg', 'min_kg', 'max_kg', 'sd_kg',
  'rejected_by_scale', 'implausible',
] as const;

/**
 * Sections: `day_shift` (one row per date and shift), `day_total`,
 * `shift_total`, `yarn_count` (`material_ids` space-separated) and
 * `grand_total`.
 */
export function sackWeightSummaryCsv(d: SackWeightSummaryReportData): CsvTable {
  const H = SACK_WEIGHT_SUMMARY_CSV_HEADERS;
  const line = (
    section: string,
    where: { date?: string | null; shift?: string | null; yarn_count?: string | null; material_ids?: string | null },
    f: SackSummaryFigures,
  ): CsvRow =>
    csvRowOf(H, {
      section, ...where, sacks: f.sacks, kg: f.kg, avg_kg: f.avgKg, min_kg: f.minKg, max_kg: f.maxKg, sd_kg: f.sdKg,
      rejected_by_scale: f.rejectedByScale, implausible: f.implausible,
    });
  const rows: CsvRow[] = [
    ...d.rows.map((r) => line('day_shift', { date: r.date, shift: r.shift }, r)),
    ...d.dayTotals.map((r) => line('day_total', { date: r.date }, r)),
    ...d.shiftTotals.map((r) => line('shift_total', { shift: r.shift }, r)),
    ...d.byYarnCount.map((r) => line('yarn_count', { yarn_count: r.label, material_ids: r.materialIds.join(' ') }, r)),
    line('grand_total', {}, d.total),
  ];
  return { headers: H, rows };
}
