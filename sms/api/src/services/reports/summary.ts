/**
 * Management summary — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * The KPI set of KPI-DEFINITIONS.md, each figure beside the same figure for
 * the PRIOR PERIOD OF EQUAL LENGTH and the change between them; and the
 * verdict mark's three totals (cones, sacks, kilograms), which is the figure
 * that gets signed for. Nothing here is computed twice: both periods go
 * through the same services the other reports use (report.ts, weights.ts,
 * weightStations.ts, the register), so a KPI on this page equals the figure
 * on the page it came from.
 *
 * THE KPI SET IS THE DEVELOPER'S PROPOSAL, awaiting IFL (Q12 / Q33–37): the
 * roadmap's Phase 8 acceptance is that IFL approves the definitions, and no
 * approval has been given. Every row carries `approval: 'awaiting'`, on the
 * page, in the CSV and in the definitions sheet, until it has.
 *
 * WHAT A DELTA MEANS AND DOES NOT. "Up 4 %" is the change in the figure,
 * not a judgement of it: a rise in cones weighed is good, a rise in the
 * reject rate is not, and a rise in "days with data" may only mean the
 * source was down last month. `betterWhen` states which direction is the
 * good one, or 'neither' when the number is a fact with no good direction
 * (a mean weight, a count of days). A period with no readings gives a null
 * prior and a null delta — never "down 100 %".
 */
import type { ConnectionPool } from 'mssql';
import { getReport, type ReportData, type ResolvedPeriod } from '../report.js';
import { countEvents } from '../register.js';
import type { GenerationNote } from '../generation.js';
import { getProduction, NO_PRODUCT_GROUP } from '../production.js';
import { getWeights } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { loadProductCatalogue } from '../productLimits.js';
import { delta, pct, priorPeriod, round, type DayRange, type Delta, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

export type KpiUnit = 'cones' | 'sacks' | 'kg' | 'g' | '%' | 'days' | 'stations' | 'seconds' | 'stops' | 'readings';
export type BetterWhen = 'higher' | 'lower' | 'neither';
/**
 * The SHAPE of the figure, not its unit — this is what decides whether a
 * coverage gap between two periods can move it (defect fix, 16 Sep 2026: the
 * comparability rule below used to key off `unit` alone, which wrongly
 * treated 'Average sack (kg)' and 'Cones per sack (cones)' as coverage-
 * sensitive totals because their UNIT happens to match a count KPI's unit.
 * Both are MEANS — a ratio of two totals — and a ratio is not moved by having
 * fewer days on one side; a total is. `unit` stays purely presentational.
 *
 *  - 'total': a raw sum/count over the period (cones weighed, sacks weighed,
 *    kg, seconds lost, stoppage count, readings excluded). Coverage-sensitive.
 *  - 'rate': a mean, percentage or ratio of two totals (in-range %, mean
 *    weight, average sack, cones per sack, stations flagged, days with
 *    data). Coverage-independent by construction.
 */
export type KpiShape = 'total' | 'rate';

export interface KpiDefinition {
  key: string;
  label: string;
  unit: KpiUnit;
  /** See KpiShape. Drives comparability, independent of `unit`. */
  shape: KpiShape;
  /**
   * SECOND comparability axis, independent of `shape` (friction audit F12,
   * 23 Sep 2026). A KPI whose denominator is "readings that could be judged
   * against a product" cannot be compared across IFL's 2026-08-05 source
   * rebuild: before that date no reading carried a `MaterialId` at all, so
   * nothing could be judged, and the figure collapses toward zero for a
   * reason that has nothing to do with the plant. The summary reported
   * "Within product limits · 99.8 % against 4.5 % · +2,117.8 %" from exactly
   * this — a twenty-one-fold improvement in product conformance that did not
   * happen, on the page a GM signs.
   *
   * `shape` does NOT catch it: 'Within product limits' is a rate, and rates
   * are coverage-independent by construction, which is correct for 'Average
   * sack (kg)' and wrong here. The distinction is not total-versus-rate; it
   * is whether the two periods are comparable at all.
   */
  attributionSensitive?: boolean;
  betterWhen: BetterWhen;
  /** One sentence; the SQL-level formula is in KPI-DEFINITIONS.md under the same key. */
  definition: string;
}

/** The order the summary prints them in. Keys match KPI-DEFINITIONS.md. */
export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  { key: 'cones_weighed', label: 'Cones weighed', unit: 'cones', shape: 'total', betterWhen: 'higher', definition: 'Cone readings in the period.' },
  { key: 'cones_in_range_pct', label: 'Cones in range', unit: '%', shape: 'rate', betterWhen: 'higher', definition: 'Share of cone readings the scale marked in range.' },
  { key: 'cones_rejected_by_scale', label: 'Rejected by the scale', unit: 'cones', shape: 'total', betterWhen: 'lower', definition: 'Cone readings the scale marked out of range.' },
  // "before they were weighed as cones" corrected 23 Sep 2026 — see
  // KPI-DEFINITIONS.md row 4: false for 98%+ of these, which match a
  // cone_event row already weighed fine before the inspection station
  // rejected them.
  { key: 'rejects_at_inspection', label: 'Rejected at inspection', unit: 'cones', shape: 'total', betterWhen: 'lower', definition: 'Cones the inspection stations rejected.' },
  { key: 'inspection_reject_rate_pct', label: 'Inspection reject rate', unit: '%', shape: 'rate', betterWhen: 'lower', definition: 'Inspection rejects over cones plus inspection rejects.' },
  { key: 'cones_within_limits_pct', label: 'Within product limits', unit: '%', shape: 'rate', attributionSensitive: true, betterWhen: 'higher', definition: 'Cones classified within the limits in force at their own time, over cones that could be judged.' },
  { key: 'mean_cone_weight_g', label: 'Mean cone weight', unit: 'g', shape: 'rate', betterWhen: 'neither', definition: 'Average recorded cone weight over the plausible population.' },
  { key: 'cone_weight_sd_g', label: 'Cone weight spread', unit: 'g', shape: 'rate', betterWhen: 'lower', definition: 'Standard deviation of recorded cone weight over the plausible population.' },
  { key: 'implausible_readings', label: 'Implausible readings excluded', unit: 'readings', shape: 'total', betterWhen: 'lower', definition: 'Cone readings outside the plausibility window, excluded from every weight figure.' },
  { key: 'sacks_weighed', label: 'Sacks weighed', unit: 'sacks', shape: 'total', betterWhen: 'higher', definition: 'Sack readings in the period.' },
  { key: 'sack_weight_kg', label: 'Sack weight', unit: 'kg', shape: 'total', betterWhen: 'higher', definition: 'Sum of recorded sack weight, under the weight rule’s basis.' },
  { key: 'avg_sack_kg', label: 'Average sack', unit: 'kg', shape: 'rate', betterWhen: 'neither', definition: 'Sack weight divided by sacks weighed.' },
  { key: 'cones_per_sack', label: 'Cones per sack (approx.)', unit: 'cones', shape: 'rate', betterWhen: 'neither', definition: 'Cones weighed divided by sacks weighed — an approximation, no cone is keyed to its sack.' },
  { key: 'time_lost_seconds', label: 'Time lost', unit: 'seconds', shape: 'total', betterWhen: 'lower', definition: 'Sum of gaps between consecutive cones longer than the stop threshold.' },
  { key: 'stoppages', label: 'Stoppages', unit: 'stops', shape: 'total', betterWhen: 'lower', definition: 'Count of gaps between consecutive cones longer than the stop threshold.' },
  { key: 'stations_flagged', label: 'Stations flagged for drift', unit: 'stations', shape: 'rate', betterWhen: 'lower', definition: 'Stations whose daily means failed a pattern test inside a qualifying run against the line.' },
  { key: 'days_with_data', label: 'Days with readings', unit: 'days', shape: 'rate', betterWhen: 'neither', definition: 'Production days in the period holding at least one cone reading.' },
];

export interface KpiRow extends KpiDefinition {
  current: number | null;
  prior: number | null;
  delta: Delta | null;
  /**
   * UX Phase 5 Brief 1, unit U5 (16 Sep 2026): whether the delta above is
   * safe to read as a trend. The record has a coverage hole (10 Jul – 5 Aug
   * 2026, IFL's table rebuild has not been sent yet) that `priorPeriod`
   * (common.ts) — CALENDAR days — does not know about, so a prior period can
   * hold far fewer days of data than the current one while still being
   * treated as a full comparison. For a `shape: 'total'` KPI (a raw sum/count
   * — cones, sacks, kg, seconds, stops, readings) that difference in coverage
   * moves the figure by itself, so `comparable` is false and the delta must
   * not be presented as a trend. `shape: 'rate'` KPIs (percentages, means,
   * ratios such as average sack weight or cones per sack, and
   * `days_with_data` itself) stay comparable regardless — they are
   * coverage-independent by construction. This is decided by `shape`, NOT by
   * `unit`: a mean can share its unit with a total (average sack is 'kg',
   * same as sack weight) without sharing its coverage sensitivity.
   */
  comparable: boolean;
  /** Why `comparable` is false, printed rather than left for the reader to guess; null when comparable. */
  incomparableReason: string | null;
  approval: 'awaiting';
}

/** One product's share of a period, for the product-mix comparison below. */
export interface ProductMixRow {
  /** material_id, or null for readings that predate product recording. */
  productId: number | null;
  label: string;
  cones: number;
  /**
   * RT-018 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): PDAS's own
   * MaterialActive, as last mirrored — this row names a specific product
   * that ran in the period, so it carries the same flag Product › Running
   * and the other per-product reports do. No retirement TIMESTAMP exists
   * anywhere in PDAS or its mirror; this is the product's status AS OF NOW.
   * Null for the "No product on the reading" row.
   */
  productActive: boolean | null;
}

export interface ManagementSummaryData {
  period: ResolvedPeriod;
  prior: DayRange;
  coverage: { current: ReportData['coverage']; prior: ReportData['coverage'] };
  /**
   * F12: the share of each period's cone readings that carry a product at
   * all, 0..1. Published so a reader can see for themselves why an
   * attribution-sensitive KPI's comparison was withheld, rather than being
   * asked to take the sentence on trust.
   */
  attribution: { current: number | null; prior: number | null };
  kpis: KpiRow[];
  /**
   * Which products each period actually ran (UX Phase 5 Brief 1, unit U5),
   * so a mean-weight comparison across two periods can state whether it is
   * comparing the same products or two different ones — a KPI comparable by
   * the coverage test above can still be comparing different products.
   */
  productMix: { current: ProductMixRow[]; prior: ProductMixRow[] };
  /** The verdict mark's figures for the period: what is signed for. */
  verdict: { cones: number; sacks: number; sackWeightKg: number };
  approval: 'awaiting';
  note: string;
  /** RT-002/RT-029 follow-up (23 Sep 2026): the scope `cones_rejected_by_scale`'s own count was resolved and bound to, per period — see register.ts's countEvents. */
  generationNote: { current: GenerationNote; prior: GenerationNote };
}

interface PeriodFigures {
  coverage: ReportData['coverage'];
  values: Record<string, number | null>;
  totals: ReportData['totals'];
  /** Raw product-id + cones, labelled later (once) by the caller. */
  productMix: { productId: number | null; cones: number }[];
  /** F12: share of this period's cone readings carrying a product, 0..1; null when the period holds none. */
  attributedShare: number | null;
  generationNote: GenerationNote;
}

/**
 * How much the two periods' COVERAGE may differ before a count-shaped KPI's
 * delta stops being presented as a trend.
 *
 * THE THRESHOLD: more than 20% of the (equal-length) period's days differing
 * in daysWithData between current and prior.
 *
 * WHY 20%, not stricter or looser: the periods `priorPeriod` builds are
 * always equal length, so `daysInPeriod` is the same denominator on both
 * sides — the comparison is "how many of those days actually held data,
 * current versus prior". A gap of one or two days out of a multi-week period
 * (a sync hiccup, a maintenance day) is already visible honestly in the
 * `coverage` figures printed beside the KPI table and does not, by itself,
 * explain a double-digit percentage swing in a count — so it should not
 * silently suppress the comparison. The brief's own example — 9 of 34 prior
 * days against a fully-covered current period — is a 74% gap, more than
 * three and a half times this line; 20% is comfortably below that while
 * still well above ordinary single-day noise (about 1 day in 5, i.e. one
 * missed day in a five-day week or seven in a five-week month).
 */
const COVERAGE_MATERIAL_THRESHOLD = 0.2;

function coverageDiffers(cur: ReportData['coverage'], prior: ReportData['coverage']): boolean {
  const denom = Math.max(cur.daysInPeriod, prior.daysInPeriod, 1);
  return Math.abs(cur.daysWithData - prior.daysWithData) / denom > COVERAGE_MATERIAL_THRESHOLD;
}

/**
 * F12 — the SECOND comparability test, on the same 20% line and for the same
 * reason: below it the difference is ordinary noise, above it the KPI is
 * measuring the availability of product attribution rather than the plant.
 *
 * The case that produced it is not marginal — 99.9% attributed against 0.0%,
 * a gap of essentially 1.0, five times this threshold — so the line's exact
 * placement is not load-bearing; what matters is that the test exists at all.
 * A period with no readings gives a null share and no comparison to guard:
 * `figuresFor` has already nulled every value for an empty period, so the
 * delta is null and nothing is presented either way.
 */
const ATTRIBUTION_MATERIAL_THRESHOLD = 0.2;

function attributionDiffers(cur: number | null, prior: number | null): boolean {
  if (cur == null || prior == null) return false;
  return Math.abs(cur - prior) > ATTRIBUTION_MATERIAL_THRESHOLD;
}

async function figuresFor(pool: ConnectionPool, lineId: number, range: DayRange): Promise<PeriodFigures> {
  const resolved: ResolvedPeriod = { period: 'custom', from: range.from, to: range.to };
  const [report, weights, stations, scaleRejected, byProduct] = await Promise.all([
    getReport(pool, lineId, resolved),
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded' — getWeights
    // resolves that to the basis Setup has on file, like every other reader.
    getWeights(pool, lineId, undefined, range.from, range.to),
    getWeightStations(pool, lineId, range.from, range.to),
    countEvents(pool, lineId, 'cone', { from: range.from, to: range.to, inRange: false }),
    // U5 (16 Sep 2026): raw product-id + cones for the product-mix comparison
    // below; labelled once in getManagementSummary, not per period.
    getProduction(pool, lineId, { from: range.from, to: range.to, groupBy: 'product' }),
  ]);
  const t = report.totals;
  const empty = report.coverage.daysWithData === 0;
  const st = report.readings?.states ?? null;
  const judged = st ? st.within + st.low + st.high + st.rejected : 0;
  const values: Record<string, number | null> = {
    cones_weighed: t.cones,
    cones_in_range_pct: t.conesInRangePct,
    cones_rejected_by_scale: empty ? null : scaleRejected.count,
    rejects_at_inspection: t.rejectedCones,
    inspection_reject_rate_pct: t.rejectRatePct,
    cones_within_limits_pct: st ? pct(st.within, judged) : null,
    mean_cone_weight_g: weights.cone.avg,
    cone_weight_sd_g: weights.cone.stdev,
    implausible_readings: empty ? null : weights.cone.implausible,
    sacks_weighed: t.sacks,
    sack_weight_kg: t.sackWeightKg,
    avg_sack_kg: t.avgSackKg,
    cones_per_sack: t.conesPerSack,
    time_lost_seconds: report.downtime?.stoppedSeconds ?? null,
    stoppages: report.downtime?.stoppageCount ?? null,
    stations_flagged: empty ? null : stations.stations.filter((s) => s.flagged).length,
    days_with_data: report.coverage.daysWithData,
  };
  // A period with no readings has no figures, only zeros the services print
  // for an empty range; those must not become a prior of 0 and a delta of
  // "up from 0". Null them all except the coverage count itself.
  if (empty) for (const k of Object.keys(values)) if (k !== 'days_with_data') values[k] = null;
  const productMix = byProduct.rows.map((r) => ({
    productId: r.group === NO_PRODUCT_GROUP ? null : Number(r.group),
    cones: r.cones,
  }));
  // F12: the share of this period's cone readings that carry a product at
  // all. Measured from the same grouped query the product mix comes from,
  // not asserted from a date: the discontinuity is IFL's 2026-08-05 rebuild,
  // but the thing that actually decides comparability is whether the readings
  // could be judged, and that is this number. Null when the period has no
  // readings — there is nothing to be a share of.
  const mixCones = productMix.reduce((a, m) => a + m.cones, 0);
  const attributedCones = productMix.reduce((a, m) => a + (m.productId == null ? 0 : m.cones), 0);
  const attributedShare = mixCones > 0 ? attributedCones / mixCones : null;
  return { coverage: report.coverage, values, totals: t, productMix, attributedShare, generationNote: scaleRejected.note };
}

export async function getManagementSummary(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  _filters: ReportFilters,
): Promise<ManagementSummaryData> {
  const prior = priorPeriod(resolved.from, resolved.to);
  const [cur, prev, catalogue] = await Promise.all([
    figuresFor(pool, lineId, { from: resolved.from, to: resolved.to }),
    figuresFor(pool, lineId, prior),
    loadProductCatalogue(pool),
  ]);
  // A count-shaped KPI's delta is only presented as a trend when the two
  // periods' coverage is close enough that the delta is not simply an
  // artefact of one having far fewer days of data than the other (the
  // record's 10 Jul – 5 Aug hole makes this a real, not hypothetical, case).
  const covDiffers = coverageDiffers(cur.coverage, prev.coverage);
  // Verification 25 Sep 2026 (M19-M23): the prior period's figures are all
  // read from ONE source generation (generation.ts, stray-generation rule and
  // no unconstrained tables), and it is named here. When coverage is thin the
  // comparison is withheld for EVERY KPI, rates included: a rate or a mean
  // over a handful of days beside a whole period is not a trend either.
  const priorGen = prev.generationNote.generation;
  const priorGenText = priorGen
    ? ` The prior period was read from ${priorGen.label ?? priorGen.sourceDb ?? 'one source generation'}` +
      (priorGen.simulator ? ' (plant simulator, synthetic data)' : '') +
      (prev.generationNote.otherGenerationExcluded > 0
        ? `; ${prev.generationNote.otherGenerationExcluded} ${prev.generationNote.otherGenerationExcluded === 1 ? 'reading' : 'readings'} from another generation in that period ${prev.generationNote.otherGenerationExcluded === 1 ? 'was' : 'were'} left out.`
        : '.')
    : '';
  const incomparableReason =
    `Prior period covers ${prev.coverage.daysWithData} of ${prev.coverage.daysInPeriod} days with readings, versus ` +
    `${cur.coverage.daysWithData} of ${cur.coverage.daysInPeriod} for the current period — no change is stated for any ` +
    'figure, because it would measure that coverage gap, not a change in production.' + priorGenText;
  // F12 (23 Sep 2026): an attribution-sensitive KPI compared across the
  // 2026-08-05 rebuild is not a trend. Before that date no reading carried a
  // MaterialId, so nothing could be judged against product limits and the
  // figure is the absence of a column, not a quality level.
  const attrDiffers = attributionDiffers(cur.attributedShare, prev.attributedShare);
  const share = (s: number | null) => (s == null ? 'none' : `${Math.round(s * 1000) / 10}%`);
  const attributionReason =
    `Not comparable: product attribution covers ${share(prev.attributedShare)} of the prior period's cone readings ` +
    `against ${share(cur.attributedShare)} for this one. A reading with no product on it cannot be judged against ` +
    'product limits at all, so the difference measures when the plant started recording a product on the reading ' +
    '(its source tables were rebuilt on 5 August 2026), not a change in conformance.';
  const kpis: KpiRow[] = KPI_DEFINITIONS.map((k) => {
    const current = round(cur.values[k.key] ?? null);
    const before = round(prev.values[k.key] ?? null);
    const coverageBlocks = covDiffers;
    const attributionBlocks = k.attributionSensitive === true && attrDiffers;
    const comparable = !coverageBlocks && !attributionBlocks;
    return {
      ...k, current, prior: before, delta: delta(current, before),
      comparable,
      incomparableReason: comparable
        ? null
        : [attributionBlocks ? attributionReason : null, coverageBlocks ? incomparableReason : null]
            .filter(Boolean)
            .join(' '),
      approval: 'awaiting',
    };
  });
  // F7 (23 Sep 2026): the DISTINCT label — see productNames.ts.
  const labelFor = (pid: number | null) => (pid == null ? 'No product on the reading' : catalogue.distinctLabel(pid));
  // RT-018: same catalogue lookup product.ts and weightStations.ts already use.
  const activeFlagFor = (pid: number | null) => (pid == null ? null : (catalogue.product(pid)?.activeFlag ?? null));
  const productMix = {
    current: cur.productMix.map((m) => ({ ...m, label: labelFor(m.productId), productActive: activeFlagFor(m.productId) })),
    prior: prev.productMix.map((m) => ({ ...m, label: labelFor(m.productId), productActive: activeFlagFor(m.productId) })),
  };
  return {
    period: resolved,
    prior,
    coverage: { current: cur.coverage, prior: prev.coverage },
    attribution: { current: cur.attributedShare, prior: prev.attributedShare },
    kpis,
    productMix,
    verdict: { cones: cur.totals.cones, sacks: cur.totals.sacks, sackWeightKg: cur.totals.sackWeightKg },
    approval: 'awaiting',
    generationNote: { current: cur.generationNote, prior: prev.generationNote },
    note:
      'Each figure is shown beside the same figure for the period of equal length immediately before it. A comparison is ' +
      'withheld — shown as “not comparable”, with the reason — when the two periods differ too much in how many days held ' +
      'readings, or in how many of those readings carried a product at all; either difference would be reported as a ' +
      'change in the plant when it is not one. The KPI set and its definitions (KPI-DEFINITIONS.md) are the developer’s ' +
      'proposal and await IFL’s approval.',
  };
}

export const SUMMARY_CSV_HEADERS = [
  'kpi', 'label', 'unit', 'current', 'prior', 'delta', 'delta_pct', 'better_when', 'period', 'prior_period', 'ifl_approval',
  'comparable', 'incomparable_reason',
  // F12 (23 Sep 2026): the evidence behind an attribution-based withholding
  // travels with the file, so the exported sheet can be checked without the app.
  'product_attribution_current_pct', 'product_attribution_prior_pct',
] as const;

export function summaryCsv(d: ManagementSummaryData): CsvTable {
  const period = `${d.period.from} to ${d.period.to}`;
  const priorPeriodLabel = `${d.prior.from} to ${d.prior.to}`;
  const sharePct = (s: number | null) => (s == null ? null : Math.round(s * 1000) / 10);
  const rows: CsvRow[] = d.kpis.map((k) => [
    k.key, k.label, k.unit, k.current, k.prior, k.delta?.abs ?? null, k.delta?.pct ?? null, k.betterWhen, period, priorPeriodLabel, k.approval,
    k.comparable, k.incomparableReason,
    sharePct(d.attribution.current), sharePct(d.attribution.prior),
  ]);
  return { headers: SUMMARY_CSV_HEADERS, rows };
}
