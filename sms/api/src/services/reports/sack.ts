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
 */
import type { ConnectionPool } from 'mssql';
import { getProduction, NO_PRODUCT_GROUP } from '../production.js';
import { loadProductCatalogue } from '../productLimits.js';
import { countEvents } from '../register.js';
import type { GenerationNote } from '../generation.js';
import { toReportLine, type ReportLine, type ResolvedPeriod } from '../report.js';
import { getConfiguredBasis, getWeights, type WeightStats } from '../weights.js';
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
  byDay: ReportLine[];
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
  const [total, byShift, byDay, byProduct, rejected, catalogue, weights, shiftBasis] = await Promise.all([
    getProduction(pool, lineId, { from, to, shift, groupBy: 'none', shiftRange }),
    getProduction(pool, lineId, { from, to, shift, groupBy: 'shift', shiftRange }),
    getProduction(pool, lineId, { from, to, shift, groupBy: 'day', shiftRange }),
    getProduction(pool, lineId, { from, to, shift, groupBy: 'product', shiftRange }),
    countEvents(pool, lineId, 'sack', { from, to, shift, inRange: false, shiftRange }),
    loadProductCatalogue(pool),
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded' — getWeights
    // resolves that to the basis Setup has on file.
    shift ? Promise.resolve(null) : getWeights(pool, lineId, undefined, from, to),
    // Under a shift filter `getWeights` is skipped on purpose (see the module
    // comment), but `weightBasis` below still has to name the TRUE configured
    // basis, not a hardcoded fallback — so fetch just the basis, the cheap way.
    shift ? getConfiguredBasis(pool, lineId) : Promise.resolve(null),
  ]);
  const totals = total.rows[0] ? toReportLine(total.rows[0]) : toReportLine({ group: 'total', cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null });
  const order = ['morning', 'evening', 'night'];
  return {
    period: resolved,
    filters,
    weightBasis: weights?.basis ?? shiftBasis ?? 'as_recorded',
    totals,
    rejectedByScale: rejected.count,
    inRangePct: totals.sacks > 0 ? pct(totals.sacks - rejected.count, totals.sacks) : null,
    conesPerSack: totals.conesPerSack,
    byShift: byShift.rows.map(toReportLine).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)),
    byDay: byDay.rows.map(toReportLine),
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
        avgSackKg: r.avgSackKg,
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
