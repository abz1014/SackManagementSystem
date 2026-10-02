/**
 * SPS Sack Weight Range Report — IFL's report 4 of 8 (their email of
 * 29 Sep 2026), registered 1 Oct 2026, built 1 Oct 2026 (task F-R3R4).
 *
 * Built on the shared sack service (`sackCells.ts`): the BINS (0.1 kg, counted
 * in SQL by `getSackBins`, ROUND before FLOOR) feed table A and the CELLS
 * (`getSackCells`, exact sums) feed table B, both bound to ONE resolved
 * context (`resolveSackContext`) so the two tables cannot read different
 * source generations or different rule versions.
 *
 * TWO TABLES.
 *  A. WEIGHT BANDS. Where the period's sacks fell, in 0.1 kg bands from 0.2 kg
 *     below the lightest PASSED sack to 0.2 kg above the heaviest (the whole
 *     plausible range when nothing passed; 0.2 kg bands when more than 30
 *     would result), with an open-ended row at each end and an "Implausible
 *     weight" row. Each band is split by the SCALE's verdict (passed /
 *     rejected) and by shift, with totals and share. A band includes its lower
 *     edge and excludes its upper one. No target is shown: IFL holds no sack
 *     target or tolerance, so a band is never marked "good" and a sack is
 *     never called under- or over-weight.
 *  B. SPREAD. n, min, max, range, mean and sample standard deviation over the
 *     PLAUSIBLE sacks, per production date and shift, per shift, and for the
 *     period.
 *
 * ROW ORDER of table A: the below-tail, the bands ascending, the above-tail,
 * then the implausible row. A sack with no weight at all (the plant left it
 * blank) sits on the implausible row too: it has no weight to place in a band
 * and must still be counted once.
 */
import type { ConnectionPool } from 'mssql';
import type { ShiftCode } from '@sms/shared';
import type { GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import { getSackBins, getSackCells, resolveSackContext, rollup, rollupAll, type SackBinRow, type SackFigures } from '../sackCells.js';
import { csvRowOf, pct, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

/** Sacks in one band, split by the scale's own verdict. A sack with no flag is in neither `passed` nor `rejected` (see `noFlag`). */
export interface SackBandCounts {
  passed: number;
  rejected: number;
  /** Sacks in the band whose in-range flag is NULL, never counted as passed. */
  noFlag: number;
  /** passed + rejected + noFlag. */
  total: number;
}

/** 'band' = a regular band; 'below' / 'above' = the open-ended tails; 'implausible' = 0 kg / fault weights, kept out of the bands and the spread. */
export type SackBandKind = 'band' | 'below' | 'above' | 'implausible';

export interface SackWeightBand {
  kind: SackBandKind;
  /** "47.1 - 47.2 kg", "Below 46.9 kg", "Above 47.7 kg", "Implausible weight". */
  label: string;
  /** Inclusive lower edge in kg; null for the 'below' tail and 'implausible'. */
  fromKg: number | null;
  /** Exclusive upper edge in kg; null for the 'above' tail and 'implausible'. */
  toKg: number | null;
  byShift: Record<ShiftCode, SackBandCounts>;
  total: SackBandCounts;
  /** This band's share of all sacks in the period, 1 dp; null when no sacks. */
  sharePct: number | null;
}

/** Spread over the plausible sacks of one group. `date`/`shift` are null for the groups that span them. */
export interface SackSpreadRow {
  date: string | null;
  shift: ShiftCode | null;
  n: number;
  minKg: number | null;
  maxKg: number | null;
  /** maxKg - minKg; null when n is 0. */
  rangeKg: number | null;
  avgKg: number | null;
  /** Sample standard deviation; null when n < 2. */
  sdKg: number | null;
}

export interface SackWeightRangeReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** The weight basis every kg figure is stated under (as-of the period end). */
  weightBasis: string;
  /** The sack plausibility window in force at the period end. */
  plausibility: { loKg: number; hiKg: number };
  /** Band width actually used: 0.1, or 0.2 when 0.1 would have made more than 30 bands. */
  bandKg: number;
  /** The weight range of the sacks the scale PASSED (the bands' anchor); null when none passed. A fact, not a tolerance. */
  passedRange: { minKg: number; maxKg: number } | null;
  /** Table A: ascending by weight, tails and the implausible row last. */
  bands: SackWeightBand[];
  /** Table B: per production date and shift, chronological. */
  spreadByDayShift: SackSpreadRow[];
  /** Table B: per shift, morning / evening / night. */
  spreadByShift: SackSpreadRow[];
  /** Table B: the period. */
  spreadTotal: SackSpreadRow;
  /** Sacks with an implausible weight (in the 'implausible' band, outside every spread). */
  implausibleSacks: number;
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const SACK_WEIGHT_RANGE_NOTE =
  'Where the period’s sacks fell by weight, split by what the sack scale itself decided (passed or rejected) and by shift. ' +
  'A band includes its lower edge and excludes its upper edge, so a sack of exactly 47.2 kg is in the band that starts at 47.2; ' +
  'the open rows at either end hold every sack lighter or heavier than the bands. ' +
  'IFL holds no sack target or tolerance, so no band is marked as the target. Spread figures cover sacks with a plausible ' +
  'weight only; 0 kg and fault readings are shown on their own row. A sack is placed in a shift by the plant’s insert time: ' +
  'the sack scale records no event time of its own.';

/** Defaults this report applies until IFL answers; printed as "Assumed until IFL confirms". */
export const SACK_WEIGHT_RANGE_PENDING_IFL: readonly string[] = [
  'Bands are 0.1 kg wide (0.2 kg when the range is wide); IFL has not specified a band width.',
  'No sack target or tolerance is shown because none exists in IFL’s data; bands only show where passed and rejected sacks fell.',
];

const kgText = (n: number): string => String(round(n, 3));

/* ------------------------------------------------------------------- bands */

/** The default band width, kg. */
export const BAND_KG = 0.1;
/** The width the bands widen to when 0.1 kg would make more than `MAX_BANDS`. */
export const WIDE_BAND_KG = 0.2;
/** The most core bands (tails and the implausible row not counted) at 0.1 kg. */
export const MAX_BANDS = 30;
/** Core bands added beyond the lightest and heaviest anchor sack: 0.2 kg at 0.1 kg bands. */
const MARGIN_BINS = 2;

/**
 * "Assumed until IFL confirms" for THIS period: the band width actually used
 * (and why it is not the default, when it is not) and, on a net basis, the
 * tare the weights were reduced by. The window is stated by notes.ts from the
 * report's own figures, so it is not repeated here.
 */
export function sackWeightRangePendingIfl(bandKg: number, basis: string, tareKg: number): string[] {
  const out: string[] = [
    bandKg === WIDE_BAND_KG
      ? `Bands are ${WIDE_BAND_KG} kg wide because 0.1 kg bands would have made more than ${MAX_BANDS} rows; IFL has not specified a band width.`
      : SACK_WEIGHT_RANGE_PENDING_IFL[0]!,
    SACK_WEIGHT_RANGE_PENDING_IFL[1]!,
  ];
  if (basis === 'net') {
    out.push(`Weights are shown net of a ${kgText(tareKg)} kg sack tare set in Setup. IFL has not confirmed the tare weight.`);
  }
  return out;
}

/**
 * A weight in tenths of a kilogram, rounded to 6 places first: 47.4 / 0.1 is
 * 473.99999999999994 in floating point, and a sack at exactly 47.4 kg belongs
 * to the 47.4 bin. The SQL (`getSackBins`) rounds the same way before FLOOR.
 */
const tenths = (kg: number): number => Math.round((kg / BAND_KG) * 1e6) / 1e6;
/** The 0.1 kg bin a weight (on the report's basis) falls in: the index of its lower edge, in tenths of a kilogram. */
export const binOfKg = (kg: number): number => Math.floor(tenths(kg));
const ceilBinOfKg = (kg: number): number => Math.ceil(tenths(kg));

export interface WeightSpan { minKg: number; maxKg: number }

/** Where the core bands sit: bin indices in tenths of a kilogram, `fromBin` inclusive, `toBin` exclusive. */
export interface BandPlan {
  bandKg: number;
  /** Bins per band: 1 (0.1 kg) or 2 (0.2 kg). */
  step: 1 | 2;
  fromBin: number;
  toBin: number;
  /** The sacks the bands are built around. */
  anchor: 'passed' | 'plausible';
  bandCount: number;
}

/**
 * The core bands of table A (pure): 0.1 kg bands from floor(lightest) - 0.2 kg
 * to ceil(heaviest) + 0.2 kg, around the sacks the SCALE PASSED, or around all
 * plausible sacks when it passed none; null when there is no plausible sack at
 * all. More than `MAX_BANDS` bands widens them to 0.2 kg, edges on multiples of
 * 0.2 kg. Weights are on the report's basis, like the bins.
 */
export function defaultBands(passed: WeightSpan | null, plausible: WeightSpan | null): BandPlan | null {
  const span = passed ?? plausible;
  if (!span) return null;
  let fromBin = binOfKg(span.minKg) - MARGIN_BINS;
  let toBin = ceilBinOfKg(span.maxKg) + MARGIN_BINS;
  let step: 1 | 2 = 1;
  if (toBin - fromBin > MAX_BANDS) {
    step = 2;
    fromBin = 2 * Math.floor(fromBin / 2);
    toBin = 2 * Math.ceil(toBin / 2);
  }
  return { bandKg: step === 1 ? BAND_KG : WIDE_BAND_KG, step, fromBin, toBin, anchor: passed ? 'passed' : 'plausible', bandCount: (toBin - fromBin) / step };
}

const SHIFTS: readonly ShiftCode[] = ['morning', 'evening', 'night'];

const emptyCounts = (): SackBandCounts => ({ passed: 0, rejected: 0, noFlag: 0, total: 0 });

function emptyBand(kind: SackBandKind, label: string, fromKg: number | null, toKg: number | null): SackWeightBand {
  return {
    kind, label, fromKg, toKg,
    byShift: { morning: emptyCounts(), evening: emptyCounts(), night: emptyCounts() },
    total: emptyCounts(),
    sharePct: null,
  };
}

function addSacks(band: SackWeightBand, shift: ShiftCode, inRange: boolean | null, n: number): void {
  for (const c of [band.byShift[shift], band.total]) {
    if (inRange === true) c.passed += n;
    else if (inRange === false) c.rejected += n;
    else c.noFlag += n;
    c.total += n;
  }
}

/** An edge as a label: tenths of a kilogram to one decimal ("47.8"). */
const edgeText = (bin: number): string => (bin / 10).toFixed(1);

/**
 * Table A (pure): the bins merged into the plan's bands, the open-ended rows
 * and the implausible row, in the order the table reads — below-tail, bands,
 * above-tail, implausible. With no plan (no plausible sack) only the
 * implausible row can exist. A period with no sack at all has no rows.
 */
export function buildBands(bins: readonly SackBinRow[], plan: BandPlan | null): SackWeightBand[] {
  const below = plan ? emptyBand('below', `Below ${edgeText(plan.fromBin)} kg`, null, plan.fromBin / 10) : null;
  const above = plan ? emptyBand('above', `${edgeText(plan.toBin)} kg and above`, plan.toBin / 10, null) : null;
  const core: SackWeightBand[] = plan
    ? Array.from({ length: plan.bandCount }, (_, i) => {
        const from = plan.fromBin + i * plan.step;
        return emptyBand('band', `${edgeText(from)} - ${edgeText(from + plan.step)} kg`, from / 10, (from + plan.step) / 10);
      })
    : [];
  const implausible = emptyBand('implausible', 'Implausible weight', null, null);

  for (const r of bins) {
    let slot: SackWeightBand | null;
    if (r.kind !== 'plausible' || r.bin == null || !plan) slot = implausible;
    else if (r.bin < plan.fromBin) slot = below;
    else if (r.bin >= plan.toBin) slot = above;
    else slot = core[Math.floor((r.bin - plan.fromBin) / plan.step)] ?? null;
    if (slot) addSacks(slot, r.shift, r.inRange, r.sacks);
  }

  const out = [...(below ? [below] : []), ...core, ...(above ? [above] : []), implausible];
  const all = out.reduce((a, b) => a + b.total.total, 0);
  if (all === 0) return [];
  for (const b of out) b.sharePct = pct(b.total.total, all);
  return out;
}

/* ------------------------------------------------------------------ spread */

function spreadOf(date: string | null, shift: ShiftCode | null, f: SackFigures): SackSpreadRow {
  return {
    date,
    shift,
    n: f.plausible,
    minKg: f.minKg,
    maxKg: f.maxKg,
    rangeKg: f.minKg != null && f.maxKg != null ? round(f.maxKg - f.minKg, 3) : null,
    avgKg: f.avgKg,
    sdKg: round(f.sdKg, 3),
  };
}

const shiftIdx = (s: string | null): number => {
  const i = SHIFTS.indexOf(s as ShiftCode);
  return i < 0 ? SHIFTS.length : i;
};

const EMPTY_SPREAD: SackSpreadRow = { date: null, shift: null, n: 0, minKg: null, maxKg: null, rangeKg: null, avgKg: null, sdKg: null };

export async function getSackWeightRangeReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<SackWeightRangeReportData> {
  const q = { from: resolved.from, to: resolved.to, shift: filters.shift, product: filters.product, shiftRange };
  // ONE context (generation + rules as of the period end) for both reads: the
  // bands and the spread cannot disagree about which generation, which weight
  // basis or which plausibility window they describe.
  const ctx = await resolveSackContext(pool, lineId, q);
  const [res, bins] = await Promise.all([getSackCells(pool, lineId, q, ctx), getSackBins(pool, lineId, q, BAND_KG, ctx)]);
  const cells = res.cells;

  // The bands are built around what the scale PASSED (its own verdict); a
  // period in which it passed nothing falls back to the plausible range.
  const passedFig = rollupAll(cells.filter((c) => c.inRange === true));
  const allFig = rollupAll(cells);
  const spanOf = (f: SackFigures): WeightSpan | null => (f.minKg != null && f.maxKg != null ? { minKg: f.minKg, maxKg: f.maxKg } : null);
  const passedRange = spanOf(passedFig);
  const plan = defaultBands(passedRange, spanOf(allFig));
  const bands = buildBands(bins.rows, plan);

  const spreadByDayShift = [...rollup(cells, (c) => `${c.date}|${c.shift}`)]
    .map(([k, f]) => {
      const [date, shift] = k.split('|') as [string, ShiftCode];
      return spreadOf(date, shift, f);
    })
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || shiftIdx(a.shift) - shiftIdx(b.shift));
  const spreadByShift = [...rollup(cells, (c) => c.shift)]
    .map(([shift, f]) => spreadOf(null, shift, f))
    .sort((a, b) => shiftIdx(a.shift) - shiftIdx(b.shift));

  const note = [
    SACK_WEIGHT_RANGE_NOTE,
    // A rule version recorded mid-period is applied as it stood at the period END
    // to every sack (RT24-04). Worded as a RECORD, not as a change of value: a
    // version can restate the value already in force.
    res.weightRuleChangedInPeriod ? 'Setup recorded a new weight-basis version during this period; the version in force at its end is applied to every sack.' : '',
    res.plausibilityRuleChangedInPeriod ? 'Setup recorded a new plausible-weight-window version during this period; the version in force at its end is applied to every sack.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const bandKg = plan ? plan.bandKg : BAND_KG;
  return {
    period: resolved,
    filters,
    lineId,
    weightBasis: res.weightBasis,
    plausibility: res.plausibility,
    bandKg,
    passedRange: passedRange ? { ...passedRange } : null,
    bands,
    spreadByDayShift,
    spreadByShift,
    spreadTotal: allFig.sacks > 0 ? spreadOf(null, null, allFig) : { ...EMPTY_SPREAD },
    implausibleSacks: bands.find((b) => b.kind === 'implausible')?.total.total ?? 0,
    note,
    pendingIfl: sackWeightRangePendingIfl(bandKg, res.weightBasis, res.tareKg),
    generationNote: res.generationNote,
  };
}

export const SACK_WEIGHT_RANGE_CSV_HEADERS = [
  'section', 'date', 'shift', 'band', 'from_kg', 'to_kg', 'passed', 'rejected', 'total', 'share_pct', 'n', 'min_kg', 'max_kg',
  'range_kg', 'avg_kg', 'sd_kg',
] as const;

/**
 * Sections: `band` (one row per band for the whole period, `shift` empty, with
 * the share, then one row per shift that has sacks in it), `spread_day_shift`,
 * `spread_shift` and `spread_total`. The scale's verdict is the `passed` /
 * `rejected` pair; `total` adds sacks with no flag, so `total` can exceed their sum.
 */
export function sackWeightRangeCsv(d: SackWeightRangeReportData): CsvTable {
  const H = SACK_WEIGHT_RANGE_CSV_HEADERS;
  const spread = (section: string, r: SackSpreadRow): CsvRow =>
    csvRowOf(H, { section, date: r.date, shift: r.shift, n: r.n, min_kg: r.minKg, max_kg: r.maxKg, range_kg: r.rangeKg, avg_kg: r.avgKg, sd_kg: r.sdKg });
  const rows: CsvRow[] = [
    ...d.bands.flatMap((b) => [
      csvRowOf(H, { section: 'band', band: b.label, from_kg: b.fromKg, to_kg: b.toKg, passed: b.total.passed, rejected: b.total.rejected, total: b.total.total, share_pct: b.sharePct }),
      ...SHIFTS.filter((s) => b.byShift[s].total > 0).map((s) =>
        csvRowOf(H, { section: 'band', shift: s, band: b.label, from_kg: b.fromKg, to_kg: b.toKg, passed: b.byShift[s].passed, rejected: b.byShift[s].rejected, total: b.byShift[s].total })),
    ]),
    ...d.spreadByDayShift.map((r) => spread('spread_day_shift', r)),
    ...d.spreadByShift.map((r) => spread('spread_shift', r)),
    spread('spread_total', d.spreadTotal),
  ];
  return { headers: H, rows };
}
