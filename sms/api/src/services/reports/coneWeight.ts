/**
 * Cone weight report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * Mean, median, spread, the five-state counts, the histogram, and the
 * per-station table — the Weight screen's figures on paper. Every one comes
 * from the service the screen uses: weights.ts for the mean, SD and the
 * histogram (whose bucket width is derived from the readings' own spread —
 * it was a hardcoded 20 g until 23 Sep 2026, which put 76 % of the cones in
 * one bar; `bucketSizeG` below carries whatever it resolved to and must be
 * printed), production.ts for the state
 * counts, weightStations.ts for the station rows, all over the ONE
 * population rule.
 *
 * THE MEDIAN. Roadmap Phase 9 added `median` to /api/weights in this same
 * wave; when the service reports one it is used as-is. Otherwise it is
 * computed HERE with the same `plausibleWhere` predicate the mean uses — the
 * same readings, so the two figures describe one population.
 * PERCENTILE_CONT(0.5) is the interpolated median (the mean of the two
 * middle values on an even count), as a spreadsheet's MEDIAN() would give.
 *
 * NO FILTERS on this report in this phase: weights.ts takes no shift and
 * weightStations.ts takes no shift or station, and a report that honoured a
 * filter on some tables and not on others would print two populations under
 * one heading. The route refuses a filter rather than ignoring it.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { getPlausibilityRule } from '../admin.js';
import { plausibleWhere, type StateCounts } from '../coneState.js';
import { andEpoch, noteOf, resolveGenerationScope, UNSCOPED, type GenerationNote, type GenerationScope } from '../generation.js';
import { getProduction } from '../production.js';
import type { ResolvedPeriod } from '../report.js';
import { getWeights, type Basis, type Bucket } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { loadProductCatalogue } from '../productLimits.js';
import { resolvePeriodTarget, round, type ReportFilters } from './common.js';
import { describeRanTarget, productsRanInPeriod, type RanProduct } from './ranProducts.js';
import type { CsvRow, CsvTable } from './csv.js';
import { shiftRangeClause, type ShiftRange } from '../../shiftRange.js';

export interface ConeWeightReportData {
  period: ResolvedPeriod;
  /** Whatever Setup has on file (H8, 15 Sep 2026) — this used to be hardcoded. */
  basis: Basis;
  /** Every cone reading in the period. */
  cones: number;
  /** The plausible population every statistic below is computed over. */
  weighed: number;
  implausible: number;
  meanG: number | null;
  medianG: number | null;
  /** Where the median came from — the weights service (Phase 9) or this report's own query. */
  medianSource: 'weights_service' | 'report_query';
  sdG: number | null;
  minG: number | null;
  maxG: number | null;
  states: StateCounts | null;
  bucketSizeG: number;
  histogram: Bucket[];
  /**
   * UX Phase 5 Brief 1, unit U1 (16 Sep 2026): the ONE target this report
   * prints, taken from the same resolution the station table (below) already
   * uses — getWeightStations()'s targetG/productLabel, the line-wide product
   * IN FORCE AT THE PERIOD'S END — never weights.ts's own nominal figure
   * (the product running NOW, regardless of the period, with a hardcoded
   * constant behind it when none was even selected). Before this fix the figure tile and
   * the "vs target" column could print two different numbers for the same
   * report. `source` is 'none', never a fabricated number, when no product
   * was in force at the period's end.
   */
  target: {
    setpointG: number | null;
    productId: number | null;
    label: string | null;
    /** When this target began applying — the version qualifier, same instant convention as spc.ts's limitsEffectiveFromUtc. */
    inForceAtUtc: string | null;
    /**
     * F6 (23 Sep 2026): "first SEEN at that instant, not known to have STARTED
     * then" — productLimits.ts's `effectiveIsLowerBound`, carried through at
     * last instead of being dropped between layers. When true, `inForceAtUtc`
     * means NO LATER THAN that instant, which is a weaker claim and must be
     * printed as one.
     */
    inForceIsLowerBound: boolean;
    /** How many times this target's OWN limits changed inside the period (a version that BEGAN inside it, not merely in force at its end). */
    limitsChangedInPeriod: number;
    source: 'in_force_at_period_end' | 'none';
    /**
     * Why `source` is 'none' although the line had a product, in words fit to
     * print. Null when a target is stated, and null for the ordinary "no
     * product was in force" case, which needs no explanation beyond itself.
     */
    omittedReason: string | null;
    /**
     * RT-018 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): PDAS's own
     * MaterialActive, as last mirrored — carried straight through from
     * `getWeightStations`' own `productActive`, the same source this
     * report's `setpointG`/`label` already come from. No retirement
     * TIMESTAMP exists anywhere in PDAS or its mirror; this is the
     * product's status as of NOW, not as of the period. Null when no
     * target is stated (`source: 'none'`) or the mirror carries no flag.
     */
    productActive: boolean | null;
    /** Verification 25 Sep 2026 (W8): the products the readings themselves carried, with their setpoints. */
    productsRan: RanProduct[];
  };
  byStation: { station: number; n: number; meanG: number; vsLineG: number; vsTargetG: number | null; flagged: boolean }[];
  lineMeanG: number | null;
  plausibility: { loG: number; hiG: number };
  note: string;
  /**
   * RT-002/RT-029 (23 Sep 2026 red-team audit): `medianConeWeight`'s own
   * query carried no epoch predicate while `w.cone.*` (weights.ts) and
   * `prod`/`prod.states` (production.ts) — the report's other figures over
   * the same plausible population — were already generation-scoped. Null
   * when the median came from the weights service instead (no query of our
   * own ran) rather than from a scope that was never resolved.
   */
  generationNote: GenerationNote | null;
}

/**
 * The interpolated median over the plausible population, one query. Exported
 * so the test can pin the predicate it binds. `scope` defaults to
 * `UNSCOPED` (no epoch predicate) so a direct caller — this file's own test
 * calls it with four arguments — keeps its old, single-generation-agnostic
 * behaviour; `getConeWeightReport` below resolves and passes its own.
 */
export async function medianConeWeight(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  window: { loG: number; hiG: number },
  scope: GenerationScope = UNSCOPED,
  /**
   * Chart overhaul wave 2 (Task TD, 29 Sep 2026): optional, so this stays
   * the same fallback query for every existing caller (undefined here is a
   * no-op). Narrowing it matters only on the rare path where the weights
   * service reports no median of its own (`serviceMedian == null` in
   * `getConeWeightReport`) and this report falls back to its own query —
   * without it, a shift-narrowed mean (from `getWeights`) could sit beside a
   * median computed over the WHOLE day, two different populations under one
   * heading.
   */
  shiftRange?: ShiftRange,
): Promise<number | null> {
  const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const plaus = plausibleWhere(req, 'weight_g', window);
  const shiftFrag = shiftRange ? ` AND ${shiftRangeClause(shiftRange, { date: 'shift_date', code: 'shift_code' }, req)}` : '';
  const where = andEpoch(`line_id = @line AND shift_date BETWEEN @from AND @to AND ${plaus}${shiftFrag}`, req, scope, 'cone_event');
  const r = await req.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(weight_g AS float)) OVER () AS med
       FROM sms.cone_event
      WHERE ${where}`,
  );
  return round(r.recordset[0]?.med ?? null);
}

export async function getConeWeightReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  _filters: ReportFilters,
  /**
   * Chart overhaul wave 2 (Task TD, 29 Sep 2026): now threaded into
   * `getWeights` (weights.ts, TB1-owned) — `w`'s mean/median/SD/histogram
   * all narrow to the shift range, byte-identical when absent. Also threaded
   * into `getWeightStations`'s optional `period` parameter, same as
   * station.ts, though this report does not currently surface the figure
   * (`rejectRatePct`) that parameter narrows — see that call's own comment.
   * `prod` was scoped before this task.
   */
  shiftRange?: ShiftRange,
): Promise<ConeWeightReportData> {
  const { from, to } = resolved;
  const [w, prod, stations, plausibility, catalogue] = await Promise.all([
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded' — getWeights
    // resolves that to the basis Setup has on file (weights.ts's loadWeightRule),
    // the same row every other basis-aware figure in the app reads.
    getWeights(pool, lineId, undefined, from, to, shiftRange),
    getProduction(pool, lineId, { from, to, groupBy: 'none', withStates: true, shiftRange }),
    // station.ts's own call carries the full reasoning for this 5th
    // argument: it narrows only weightStations.ts's reject-rate window, not
    // the trailing mean/vsLine/vsTarget population this report's `stations`
    // (byStation, lineMeanG) reads from — those still describe the whole
    // `[from, to]` window, unchanged by this task, per that file's own F4/F6
    // population contract.
    getWeightStations(pool, lineId, from, to, undefined, { from, to, shiftRange }),
    getPlausibilityRule(pool, lineId),
    // F6 (23 Sep 2026): the versioned limits history, read HERE rather than
    // taken on trust from getWeightStations, which resolves the same version
    // and then drops its `effectiveIsLowerBound` flag
    // (weightStations.ts:196 — a different owner's file; reported, not
    // edited). This report states the target on its own front page, so it
    // resolves the qualifier itself rather than inheriting a claim it cannot
    // check.
    loadProductCatalogue(pool),
  ]);
  const window = { loG: plausibility.coneLoG, hiG: plausibility.coneHiG };
  // The same instant convention weightStations.ts and product.ts use for
  // "the limits in force at the period's end".
  const periodEndMs = new Date(`${to}T23:59:59Z`).getTime();
  const targetVersion = stations.productId != null ? catalogue.versionAt(stations.productId, periodEndMs) : null;
  const resolvedTarget = resolvePeriodTarget(targetVersion, periodEndMs, to);
  // Suppress ONLY the demonstrated F6 case — a version that began after the
  // period ended. A product with no recorded version at all keeps the old
  // behaviour (a target with a null instant, which claims no date and so
  // states nothing untrue); narrowing it that far is deliberate, so this fix
  // cannot quietly blank a target it was not written to doubt.
  const stateTarget = stations.targetG != null && !(targetVersion != null && !resolvedTarget.usable);
  // Phase 9's median (`cone.median`, landed in this same wave), when the
  // service reports one; this report's own query over the same population
  // otherwise. Read loosely on purpose, so a weights.ts built before Phase 9
  // still gets a median here rather than a type error.
  const serviceMedian = (w.cone as { median?: number | null }).median;
  // RT-002/RT-029: only resolved when this report is about to run its own
  // query — a scope round trip nobody will bind a predicate with is a cost
  // with no corresponding claim.
  // Verification 25 Sep 2026: the scope is now always resolved — the
  // products-ran query below and the printed generation line both need it.
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event']);
  const medianG = serviceMedian != null ? serviceMedian : await medianConeWeight(pool, lineId, from, to, window, scope ?? UNSCOPED, shiftRange);
  // W8: name the products that RAN (from each cone's own material_id), not
  // the app's "current product" setting. Falls back to the old line-wide
  // resolution only when no reading carried a product (pre-MaterialId data).
  const ran = describeRanTarget(await productsRanInPeriod(pool, lineId, from, to, catalogue, scope));
  const useRan = ran.products.length > 0;

  return {
    period: resolved,
    basis: w.basis,
    cones: prod.rows[0]?.cones ?? 0,
    weighed: w.cone.count,
    implausible: w.cone.implausible,
    meanG: w.cone.avg,
    medianG,
    medianSource: serviceMedian != null ? 'weights_service' : 'report_query',
    sdG: w.cone.stdev,
    minG: w.cone.min,
    maxG: w.cone.max,
    states: prod.states,
    bucketSizeG: w.cone.bucketSize,
    histogram: w.cone.histogram,
    target: useRan
      ? {
          setpointG: ran.targetG,
          productId: ran.products.length === 1 ? ran.products[0]!.productId : null,
          label: ran.label,
          inForceAtUtc: ran.inForceAtUtc,
          inForceIsLowerBound: ran.inForceIsLowerBound,
          limitsChangedInPeriod: 0,
          source: ran.targetG != null ? 'in_force_at_period_end' : 'none',
          omittedReason: ran.omittedReason,
          // Retired products are marked inline in `label`; no second marker.
          productActive: null,
          productsRan: ran.products,
        }
      : {
          setpointG: stateTarget ? stations.targetG : null,
          productId: stations.productId,
          label: stateTarget ? stations.productLabel : null,
          inForceAtUtc: stateTarget ? (resolvedTarget.inForceAtUtc ?? stations.targetEffectiveFromUtc) : null,
          inForceIsLowerBound: stateTarget && resolvedTarget.isLowerBound,
          limitsChangedInPeriod: stateTarget ? (stations.limitsChangedInWindow ?? 0) : 0,
          source: stateTarget ? 'in_force_at_period_end' : 'none',
          omittedReason: stateTarget ? null : resolvedTarget.omittedReason,
          productActive: stateTarget ? stations.productActive ?? null : null,
          productsRan: [],
        },
    byStation: stations.stations.map((s) => ({
      station: s.station, n: s.n, meanG: s.meanG, vsLineG: s.vsLineG, vsTargetG: s.vsTargetG, flagged: s.flagged,
    })),
    lineMeanG: stations.lineMeanG,
    plausibility: window,
    note:
      (w.basis === 'net'
        ? `Net basis: cone tube weight subtracted from every reading, per the weight rule on file. `
        : w.basis === 'gross'
          ? `Gross basis: weights as the scale recorded them (identical to As-recorded until IFL confirms the basis, Q4/Q5). `
          : `Weights as the scale recorded them (the weight basis is not yet confirmed by IFL). `) +
      'Every statistic is over readings inside the plausibility window; the excluded count is stated. The target names the ' +
      'products the readings themselves carried, with the limits in force for each at the END of this period, from the same ' +
      'versioned limits the station table below uses — never today\'s product applied backwards over the whole period, and ' +
      'never an invented number when none was in force.' +
      (useRan ? (ran.omittedReason ? ` ${ran.omittedReason}` : '') : resolvedTarget.omittedReason ? ` ${resolvedTarget.omittedReason}` : '') +
      ((useRan ? ran.inForceIsLowerBound : stateTarget && resolvedTarget.isLowerBound)
        ? ' Those limits were first SEEN at the instant stated, not known to have started then, so read it as "no later than".'
        : ''),
    generationNote: noteOf(scope),
  };
}

export const CONE_WEIGHT_CSV_HEADERS = [
  'section', 'key', 'value', 'station', 'n', 'mean_g', 'vs_line_g', 'vs_target_g', 'flagged', 'bucket_g', 'count',
] as const;

export function coneWeightCsv(d: ConeWeightReportData): CsvTable {
  const kv = (key: string, value: CsvRow[number]): CsvRow => ['summary', key, value, null, null, null, null, null, null, null, null];
  const rows: CsvRow[] = [
    kv('cones', d.cones),
    kv('weighed_plausible', d.weighed),
    kv('implausible_excluded', d.implausible),
    kv('mean_g', d.meanG),
    kv('median_g', d.medianG),
    kv('sd_g', d.sdG),
    kv('min_g', d.minG),
    kv('max_g', d.maxG),
    kv('target_g', d.target.setpointG),
    kv('target_source', d.target.source),
    kv('target_in_force_at_utc', d.target.inForceAtUtc),
    kv('target_in_force_is_lower_bound', d.target.inForceIsLowerBound),
    kv('target_omitted_reason', d.target.omittedReason),
    // RT-018: attribution as a trailing row, same convention every other
    // attribution fact in this CSV already follows — never a header
    // comment, which Excel shows as a mangled first row.
    kv('target_product_active', d.target.productActive),
    kv('plausible_lo_g', d.plausibility.loG),
    kv('plausible_hi_g', d.plausibility.hiG),
  ];
  if (d.states) for (const [state, n] of Object.entries(d.states)) rows.push(kv(`state_${state}`, n));
  for (const s of d.byStation) {
    rows.push(['station', null, null, s.station, s.n, s.meanG, s.vsLineG, s.vsTargetG, s.flagged, null, null]);
  }
  for (const b of d.histogram) rows.push(['histogram', null, null, null, null, null, null, null, null, b.bucket, b.count]);
  return { headers: CONE_WEIGHT_CSV_HEADERS, rows };
}
