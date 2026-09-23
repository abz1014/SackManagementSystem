/**
 * Product report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * Per product in the period: cones, rejects, the scale's in-range share,
 * the weight average and spread, and the five-state classification. The
 * counts come from production.ts's new `groupBy: 'product'`; the weight
 * statistics and the state counts have no service that groups them by
 * product, so the two queries below live here — over the ONE population
 * predicate (`plausibleWhere`) and the ONE state CASE (`bindStateCase`),
 * which is what keeps "the average weight of product 21" equal to what the
 * Weight screen would show with a product filter, had it one.
 *
 * THE UNATTRIBUTED SENTENCE. Product attribution is asymmetric across IFL's
 * 2026-08-05 rebuild: every July-generation reading carries material_id NULL
 * because the column did not exist at source, and back-filling it would be
 * fabrication (CLAUDE.md, Phase 2 readiness item 5). Those readings group
 * under `none` here and the report says how many there were, rather than
 * quietly reporting a period that looks complete and is not. Whether a
 * product report is wanted at all, given IFL's original Q1 answer, is a
 * clarification for IFL (gap analysis §10).
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { bindStateCase, foldStateCounts, loadStateContext, plausibleWhere, type StateCounts } from '../coneState.js';
import { getProduction, NO_PRODUCT_GROUP } from '../production.js';
import { loadProductCatalogue, limitsFromVersion } from '../productLimits.js';
import { toReportLine, type ReportLine, type ResolvedPeriod } from '../report.js';
import { resolvePeriodTarget, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

export interface ProductReportRow extends ReportLine {
  /** material_id, or null for readings that predate product recording. */
  productId: number | null;
  productLabel: string;
  /** Over the plausible population, as every weight statistic is. */
  weight: { n: number; avgG: number | null; sdG: number | null; minG: number | null; maxG: number | null };
  states: StateCounts;
  implausible: number;
  /**
   * UX Phase 5 Brief 1, unit U3 (16 Sep 2026): a per-product row is the one
   * shape where a target is unambiguous — one product, one version in force
   * at the period's end, from the same versioned history spc.ts and
   * weightStations.ts read. Null for the NO_PRODUCT_GROUP row (nothing to
   * judge it against) and for a product whose version carries no usable
   * limits.
   */
  target: {
    setpointG: number;
    loG: number;
    hiG: number;
    inForceAtUtc: string;
    /**
     * F6 (23 Sep 2026): the limits were first SEEN at `inForceAtUtc`, not
     * known to have STARTED then — read the instant as "no later than".
     * Carried through from productLimits.ts's `effectiveIsLowerBound` instead
     * of being dropped on the way out, as it was here and in coneWeight.ts.
     */
    inForceIsLowerBound: boolean;
    limitsChangedInPeriod: number;
  } | null;
  /** Signed grams of this row's own mean weight against its own target; null when `target` is null or the mean is unknown. */
  vsTargetG: number | null;
  /** F6: why `target` is null although the product has recorded limits; null otherwise. */
  targetOmittedReason: string | null;
}

export interface ProductReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  rows: ProductReportRow[];
  /** Readings in the period with no product at all, out of every reading in it. */
  unattributed: { cones: number; rejects: number; sacks: number; ofCones: number; ofRejects: number; ofSacks: number };
  note: string;
}

export async function getProductReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
): Promise<ProductReportData> {
  const { from, to } = resolved;
  const [ctx, catalogue, prod] = await Promise.all([
    loadStateContext(pool, lineId),
    loadProductCatalogue(pool),
    getProduction(pool, lineId, { from, to, shift: filters.shift, station: filters.station, groupBy: 'product' }),
  ]);

  const bind = (req: mssql.Request) => {
    req.input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
    const w = ['line_id = @line', 'shift_date BETWEEN @from AND @to'];
    if (filters.shift) { w.push('shift_code = @shift'); req.input('shift', mssql.VarChar(10), filters.shift); }
    if (filters.station != null) { w.push('source_station = @station'); req.input('station', mssql.Int, filters.station); }
    return w.join(' AND ');
  };
  const grp = `ISNULL(CAST(material_id AS varchar(12)), '${NO_PRODUCT_GROUP}')`;

  // Weight statistics per product, over the plausible population.
  const wReq = pool.request();
  const wWhere = bind(wReq);
  const plaus = plausibleWhere(wReq, 'weight_g', ctx.plausibility);
  const weights = await wReq.query<{ grp: string; n: number; avg: number | null; sd: number | null; mn: number | null; mx: number | null; excluded: number }>(
    `SELECT ${grp} AS grp, COUNT(CASE WHEN ${plaus} THEN 1 END) n,
            AVG(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) avg,
            STDEV(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) sd,
            MIN(CASE WHEN ${plaus} THEN weight_g END) mn,
            MAX(CASE WHEN ${plaus} THEN weight_g END) mx,
            SUM(CASE WHEN weight_g IS NOT NULL AND NOT (${plaus}) THEN 1 ELSE 0 END) excluded
       FROM sms.cone_event WHERE ${wWhere}
      GROUP BY ${grp}`,
  );

  // The five states per product, from the shared CASE.
  const sReq = pool.request();
  const sWhere = bind(sReq);
  const stateCase = bindStateCase(sReq, ctx, '', 'cs');
  const states = await sReq.query<{ grp: string; state: string; n: number }>(
    `SELECT ${grp} AS grp, ${stateCase} AS state, COUNT(*) n
       FROM sms.cone_event WHERE ${sWhere}
      GROUP BY ${grp}, ${stateCase}`,
  );
  const statesOf = new Map<string, { state: string; n: number }[]>();
  for (const r of states.recordset) {
    const list = statesOf.get(r.grp) ?? [];
    list.push({ state: r.state, n: Number(r.n) });
    statesOf.set(r.grp, list);
  }
  const weightOf = new Map(weights.recordset.map((r) => [r.grp, r]));

  // Period bounds on the production-time convention, the same instants
  // spc.ts's getSpec and weightStations.ts use for "the limits in force at
  // the period end" and "changed inside the period".
  const startMs = new Date(`${from}T00:00:00Z`).getTime();
  const endMs = new Date(`${to}T23:59:59Z`).getTime();

  const rows: ProductReportRow[] = prod.rows.map((r) => {
    const line = toReportLine(r);
    const w = weightOf.get(r.group);
    const productId = r.group === NO_PRODUCT_GROUP ? null : Number(r.group);
    const avgG = round(w?.avg);
    let target: ProductReportRow['target'] = null;
    let targetOmittedReason: string | null = null;
    if (productId != null) {
      const v = catalogue.versionAt(productId, endMs);
      const lim = limitsFromVersion(v);
      // F6: a version that begins AFTER this period ended did not exist while
      // these readings were taken, and `vsTargetG` computed against it would
      // be a difference from limits that were never applied. No target, and
      // the row says why.
      const pt = resolvePeriodTarget(v, endMs, to);
      targetOmittedReason = pt.omittedReason;
      if (v && lim && pt.usable) {
        const changed = catalogue
          .versionsAscending(productId)
          .filter((x) => x.effectiveFromMs > startMs && x.effectiveFromMs <= endMs).length;
        target = {
          setpointG: lim.targetG, loG: lim.loG, hiG: lim.hiG,
          inForceAtUtc: v.effectiveFromUtc, inForceIsLowerBound: pt.isLowerBound, limitsChangedInPeriod: changed,
        };
      }
    }
    return {
      ...line,
      productId,
      // F7 (23 Sep 2026): the DISTINCT label, not the bare description. Six
      // PDAS materials on this line are all called "205-IL0-SD"; this row's
      // name has to survive being exported to a spreadsheet, where there is
      // no row to click and nothing but the name and the numbers.
      productLabel: productId == null ? 'No product on the reading' : catalogue.distinctLabel(productId),
      weight: {
        n: Number(w?.n ?? 0),
        avgG,
        sdG: round(w?.sd),
        minG: round(w?.mn),
        maxG: round(w?.mx),
      },
      states: foldStateCounts(statesOf.get(r.group) ?? []),
      implausible: Number(w?.excluded ?? 0),
      target,
      vsTargetG: target == null || avgG == null ? null : round(avgG - target.setpointG),
      targetOmittedReason,
    };
  });

  const none = rows.find((r) => r.productId == null);
  const sum = (f: (r: ProductReportRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    period: resolved,
    filters,
    rows,
    unattributed: {
      cones: none?.cones ?? 0,
      rejects: none?.rejectedCones ?? 0,
      sacks: none?.sacks ?? 0,
      ofCones: sum((r) => r.cones),
      ofRejects: sum((r) => r.rejectedCones),
      ofSacks: sum((r) => r.sacks),
    },
    note:
      'Each reading is grouped by the product recorded on it by the plant. Readings from before the source recorded a product ' +
      'are listed as "No product on the reading" and are never assigned one after the fact.',
  };
}

export const PRODUCT_CSV_HEADERS = [
  'product_id', 'product', 'cones', 'cones_in_range_pct', 'rejected_at_inspection', 'inspection_reject_rate_pct',
  'sacks', 'sack_weight_kg', 'weight_n', 'weight_avg_g', 'weight_sd_g', 'weight_min_g', 'weight_max_g',
  'within', 'low', 'high', 'rejected', 'unknown', 'implausible_excluded',
  'target_g', 'vs_target_g', 'limits_changed_in_period',
  // F6 (23 Sep 2026): a target may never travel without the instant it was in
  // force at, and "no later than" is a different claim from "since".
  'target_in_force_at_utc', 'target_in_force_is_lower_bound', 'target_omitted_reason',
] as const;

export function productCsv(d: ProductReportData): CsvTable {
  const rows: CsvRow[] = d.rows.map((r) => [
    r.productId, r.productLabel, r.cones, r.conesInRangePct, r.rejectedCones, r.rejectRatePct,
    r.sacks, r.sackWeightKg, r.weight.n, r.weight.avgG, r.weight.sdG, r.weight.minG, r.weight.maxG,
    r.states.within, r.states.low, r.states.high, r.states.rejected, r.states.unknown, r.implausible,
    r.target?.setpointG ?? null, r.vsTargetG, r.target?.limitsChangedInPeriod ?? null,
    r.target?.inForceAtUtc ?? null, r.target?.inForceIsLowerBound ?? null, r.targetOmittedReason,
  ]);
  return { headers: PRODUCT_CSV_HEADERS, rows };
}
