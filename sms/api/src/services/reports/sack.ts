/**
 * Sack report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * Count, kilograms, average, the scale's in-range share, cones per sack, by
 * shift and by product — from production.ts (the counts, under the weight
 * rule's basis), the register (the scale-rejected count, so it is the number
 * the Readings sack listing shows) and weights.ts (the distribution).
 *
 * THREE CAVEATS THIS REPORT PRINTS, because a sack report that leaves the
 * building without them will be read as more than the data supports:
 *  - a sack's time is the plant's INSERT time (sack1_TP1U2 has no PLC event
 *    time — SCHEMA.md DQ-5), so "sacks this shift" is shifted by the lag;
 *  - no sack is attributed to a machine, because the source records none
 *    at any layer (the roadmap's rule 6 forbids inferring it);
 *  - cones per sack is cones weighed ÷ sacks weighed, an approximation:
 *    the plant records no key from a cone to its sack (measured 0–250 cones
 *    between consecutive sacks, 2 Sep 2026). Never a packing list.
 *
 * The STOCK block is roadmap Phase 7's `/api/sacks/stock` (routes/sacks.ts,
 * being built in the same wave). The screen asks that endpoint directly and
 * says "stock ledger not started" until it answers; it is not composed here
 * because this module cannot import a service that does not yet exist.
 *
 * FIVE FIXES, 1 Oct 2026 (IFL's eight reports, Task D-R5). The counts still
 * come from production.ts; the figures that were WRONG now come from the shared
 * cells (sackCells.ts — the same grouping the Sack Packing Weight Summary
 * reads), so the two reports cannot print different averages for the same sacks:
 *  - D-S1: the shift range is passed to getWeights; the distribution used to be
 *    cut at whole days whatever range the totals beside it were cut at.
 *  - D-S2: every average is over the PLAUSIBLE sacks. The old mean divided every
 *    sack's weight, a 0 kg or 16 kg scale fault included, by every sack: on
 *    2026-09-02 morning it printed 46.69 kg where the plausible sacks average
 *    47.35.
 *  - D-S4: the weight basis is the rule in force at the period END, always. With
 *    a shift filter it used to be the basis "right now", so one period could
 *    state two bases depending on whether a shift was chosen.
 *  - D-S5: the in-range share is over sacks that carry a scale verdict. A sack
 *    with no verdict is neither a pass nor a failure; it used to count as a pass.
 *  - D-S6: the day table lists only days with at least one sack, and the number
 *    of cone-only days left out is stated (`omittedConeOnlyDays`).
 */
import type { ConnectionPool } from 'mssql';
import { getProduction, NO_PRODUCT_GROUP } from '../production.js';
import { loadProductCatalogue } from '../productLimits.js';
import { countEvents } from '../register.js';
import type { GenerationNote } from '../generation.js';
import { toReportLine, type ReportLine, type ResolvedPeriod } from '../report.js';
import { getSackCells, rollup, rollupAll } from '../sackCells.js';
import { getWeights, type WeightStats } from '../weights.js';
import { pct, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import type { ShiftRange } from '../../shiftRange.js';

export interface SackReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  weightBasis: string;
  totals: ReportLine;
  /** Sacks the scale marked out of range, and the in-range share of every sack weighed. */
  rejectedByScale: number;
  inRangePct: number | null;
  /** cones ÷ sacks — approximate, and labelled so on every surface. */
  conesPerSack: number | null;
  byShift: ReportLine[];
  /** IFL reports (1 Oct 2026, D-S6): lists only the days with at least one sack; the cone-only days left out are counted in `omittedConeOnlyDays`. */
  byDay: ReportLine[];
  /**
   * How many days of the period had cones but no sack and so are not in
   * `byDay` — stated beside the table so a shorter list never reads as a
   * shorter period. Optional until the sack-report fixes land (W2-S): absent
   * means "not computed", never "none".
   */
  omittedConeOnlyDays?: number;
  byProduct: { productId: number | null; productLabel: string; sacks: number; sackWeightKg: number; avgSackKg: number | null }[];
  /** Null under a shift filter: weights.ts takes none, and a whole-period distribution under a shift heading would mislead. */
  distribution: Pick<WeightStats, 'count' | 'implausible' | 'avg' | 'min' | 'max' | 'stdev' | 'bucketSize' | 'histogram'> | null;
  caveats: { time: string; machine: string; conesPerSack: string };
  /** RT-002/RT-029 follow-up (23 Sep 2026): the scope `rejectedByScale`'s own count was resolved and bound to — see register.ts's countEvents. */
  generationNote: GenerationNote;
}

export async function getSackReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  /** Chart overhaul wave 2 (Task TB2, 28 Sep 2026). */
  shiftRange?: ShiftRange,
): Promise<SackReportData> {
  const { from, to } = resolved;
  const shift = filters.shift;
  const [total, byShift, byDay, byProduct, rejected, catalogue, weights, sackCells] = await Promise.all([
    getProduction(pool, lineId, { from, to, shift, groupBy: 'none', shiftRange }),
    getProduction(pool, lineId, { from, to, shift, groupBy: 'shift', shiftRange }),
    getProduction(pool, lineId, { from, to, shift, groupBy: 'day', shiftRange }),
    getProduction(pool, lineId, { from, to, shift, groupBy: 'product', shiftRange }),
    countEvents(pool, lineId, 'sack', { from, to, shift, inRange: false, shiftRange }),
    loadProductCatalogue(pool),
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded' — getWeights
    // resolves that to the basis Setup has on file.
    // IFL reports D-S1 (1 Oct 2026): the shift range is passed, so a
    // shift-bounded period's distribution is cut at the same two shift edges
    // as the totals beside it (it used to take whole days, whatever the range).
    // Still skipped under a single-shift filter: getWeights takes none, and a
    // whole-period distribution under a shift heading would mislead.
    shift ? Promise.resolve(null) : getWeights(pool, lineId, undefined, from, to, shiftRange),
    // The shared cell grouping (sackCells.ts) — the ONE source of this
    // report's averages, scale-verdict share and weight basis, so a figure here
    // is the figure the Sacks screen and the Sack Packing Weight Summary print.
    getSackCells(pool, lineId, { from, to, shift, shiftRange }),
  ]);
  const cells = sackCells.cells;
  const totals0 = total.rows[0] ? toReportLine(total.rows[0]) : toReportLine({ group: 'total', cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null });

  // D-S2 (1 Oct 2026): every average is over the PLAUSIBLE sacks. `toReportLine`
  // divides every sack's weight by every sack, so a 0 kg or 16 kg scale fault
  // dragged the mean of the day, the shift and the product it landed in. The
  // plausible mean comes from the cells (same filters, same generation, same
  // rule as of the period end); a group with no plausible sack prints no
  // average rather than a polluted one.
  const withAvg = (line: ReportLine, avg: number | null | undefined): ReportLine => ({ ...line, avgSackKg: avg ?? null });
  const all = rollupAll(cells);
  const shiftAvg = rollup<string>(cells, (c) => c.shift);
  const dayAvg = rollup(cells, (c) => c.date);
  const productAvg = rollup(cells, (c) => (c.materialId == null ? NO_PRODUCT_GROUP : String(c.materialId)));
  const totals = withAvg(totals0, all.avgKg);

  const order = ['morning', 'evening', 'night'];
  // D-S6: only the days with at least one sack are listed. A day that holds
  // cones and no sack is not "a day with 0 sacks" in a sack report; it is
  // counted, and the screen says how many were left out.
  const dayLines = byDay.rows.map(toReportLine).map((r) => withAvg(r, dayAvg.get(String(r.group))?.avgKg));
  const sackDays = dayLines.filter((r) => r.sacks > 0);
  // D-S5 (1 Oct 2026): the in-range share is over the sacks that CARRY a scale
  // verdict. A sack with no verdict is neither a pass nor a failure; the old
  // `(sacks - rejected) / sacks` counted every one of them as a pass.
  const flagged = all.passed + all.rejected;
  return {
    period: resolved,
    filters,
    // D-S4 (1 Oct 2026): always the rule in force at the period END — what the
    // cells were computed under. It used to be the basis "right now" whenever a
    // shift filter skipped getWeights, so one period could print two bases.
    weightBasis: sackCells.weightBasis,
    totals,
    rejectedByScale: rejected.count,
    inRangePct: flagged > 0 ? pct(all.passed, flagged) : null,
    conesPerSack: totals.conesPerSack,
    byShift: byShift.rows
      .map(toReportLine)
      .map((r) => withAvg(r, shiftAvg.get(String(r.group))?.avgKg))
      .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)),
    byDay: sackDays,
    omittedConeOnlyDays: dayLines.length - sackDays.length,
    byProduct: byProduct.rows
      .map(toReportLine)
      .filter((r) => r.sacks > 0)
      .map((r) => ({
        productId: r.group === NO_PRODUCT_GROUP ? null : Number(r.group),
        // F7 (23 Sep 2026): the DISTINCT label — see productNames.ts. The
        // sack CSV writes this string into its `group` column and carries no
        // product id at all, so a collided name is unrecoverable there.
        productLabel: r.group === NO_PRODUCT_GROUP ? 'No product on the reading' : catalogue.distinctLabel(Number(r.group)),
        sacks: r.sacks,
        sackWeightKg: r.sackWeightKg,
        avgSackKg: productAvg.get(String(r.group))?.avgKg ?? null,
      })),
    distribution: weights
      ? {
          count: weights.sack.count, implausible: weights.sack.implausible, avg: weights.sack.avg, min: weights.sack.min,
          max: weights.sack.max, stdev: weights.sack.stdev, bucketSize: weights.sack.bucketSize, histogram: weights.sack.histogram,
        }
      : null,
    caveats: {
      time: 'A sack’s time is the plant’s insert time: the sack scale records no event time of its own.',
      machine: 'No sack is attributed to a machine: the plant’s sack records carry no machine at any layer, and none is inferred.',
      conesPerSack: 'Cones per sack is cones weighed divided by sacks weighed over the period — an approximation, not a packing list.',
    },
    generationNote: rejected.note,
  };
}

export const SACK_CSV_HEADERS = [
  'section', 'group', 'sacks', 'sack_weight_kg', 'avg_sack_kg', 'cones', 'cones_per_sack', 'rejected_by_scale', 'in_range_pct',
  // 23 Sep 2026: the per-row SACK verdict share. Until this column the only
  // in-range figure on any row of this file was `in_range_pct`, which is
  // populated on the TOTAL row alone; a shift or day row carried no sack
  // quality figure at all, so the period could not be charted from the
  // export either. Named for the scale, like the header above it.
  'sacks_passed_by_scale_pct',
  'bucket_kg', 'count',
  // F7 (23 Sep 2026): the `group` column carries the product NAME, and a
  // name that is unique on this dataset is not guaranteed unique in general.
  // `material_id` is — it is PDAS's own key — so the one identifier that
  // cannot collide travels with the file. Populated on 'product' rows only.
  'material_id',
] as const;

export function sackCsv(d: SackReportData): CsvTable {
  const line = (section: string, r: ReportLine): CsvRow => [section, r.group, r.sacks, r.sackWeightKg, r.avgSackKg, r.cones, r.conesPerSack, null, null, r.sacksPassedScalePct, null, null, null];
  const rows: CsvRow[] = [
    ['total', 'total', d.totals.sacks, d.totals.sackWeightKg, d.totals.avgSackKg, d.totals.cones, d.conesPerSack, d.rejectedByScale, d.inRangePct, d.totals.sacksPassedScalePct, null, null, null],
    ...d.byShift.map((r) => line('shift', r)),
    ...d.byDay.map((r) => line('day', r)),
    ...d.byProduct.map((p): CsvRow => ['product', p.productLabel, p.sacks, p.sackWeightKg, p.avgSackKg, null, null, null, null, null, null, null, p.productId]),
  ];
  if (d.distribution) {
    for (const b of d.distribution.histogram) rows.push(['histogram', null, null, null, null, null, null, null, null, null, b.bucket, b.count, null]);
  }
  return { headers: SACK_CSV_HEADERS, rows };
}
