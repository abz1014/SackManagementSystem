/**
 * Calibration report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * Per station: the drift status the Weight screen shows (weightStations.ts
 * — flagged, days held, bias against line and target, last adjustment), the
 * number of days in the period on which a pattern test fired, and the
 * adjustments logged in the period.
 *
 * TWO CLOCKS, on the adjustments. `adjusted_at_utc` is an app-written
 * instant (genuine UTC); the period is production days on the plant's clock.
 * The bounds are converted with `fromPlantMs` before they meet the column —
 * compared raw they would be five hours out on this plant, and an adjustment
 * logged at 02:00 plant time on the first day would fall into the previous
 * period (plantClock.ts).
 *
 * The ledger read is a plain, parameterised SELECT here rather than
 * calibration.ts's `listCalibrationAdjustments`, because that function takes
 * no period (it answers the newest 200 line-wide — the defect the gap
 * analysis recorded) and roadmap Phase 9 is changing it in this same wave.
 * The screen's adjustments table ALSO asks Phase 9's `/api/calibration/
 * adjustments?from&to&station` for the richer per-adjustment fields and
 * merges them onto these rows by id when that endpoint answers.
 *
 * WHAT THIS REPORT CANNOT SAY: which way to turn a scale. Weighing data
 * cannot tell a heavy scale from heavy cones (REDESIGN rule 5). It reports
 * what was measured and what was logged, and stops.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { fromPlantMs } from '../plantClock.js';
import type { ResolvedPeriod } from '../report.js';
import { getWeightStations } from '../weightStations.js';
import { daysIn, type ReportFilters } from './common.js';
import { noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import { loadProductCatalogue } from '../productLimits.js';
import { describeRanTarget, productsRanInPeriod, type RanProduct } from './ranProducts.js';
import type { CsvRow, CsvTable } from './csv.js';

export interface CalibrationStationRow {
  station: number;
  n: number;
  meanG: number;
  vsLineG: number;
  vsTargetG: number | null;
  daysHeld: number;
  flagged: boolean;
  /** Days in the period on which at least one pattern test fired for this station. */
  daysFlagged: number;
  daysWithData: number;
  lastAdjustedUtc: string | null;
  adjustmentsInPeriod: number;
}

export interface CalibrationAdjustmentRow {
  adjustmentId: number;
  stationId: number | null;
  /** Genuine UTC — an app-written instant. */
  adjustedAtUtc: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  reason: string | null;
  note: string | null;
  amountG: number | null;
}

export interface CalibrationReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineMeanG: number | null;
  targetG: number | null;
  productLabel: string | null;
  thresholdG: number;
  minDaysHeld: number;
  /**
   * Production days in the period. When fewer than `minDaysHeld`, the drift
   * rule CANNOT fire by construction, so "no station flagged" is not evidence
   * of anything (verification 25 Sep 2026, C8) — `driftRuleCanFire` says so.
   */
  periodDays: number;
  driftRuleCanFire: boolean;
  /** Verification 25 Sep 2026 (C6/C7): the products the readings carried. */
  productsRan: RanProduct[];
  targetOmittedReason: string | null;
  stations: CalibrationStationRow[];
  flaggedStationCount: number;
  adjustments: CalibrationAdjustmentRow[];
  note: string;
  generationNote: GenerationNote;
}

/** The plant-day range as genuine-UTC bounds for an app-written column. */
export function periodAsUtcBounds(from: string, to: string): { fromUtc: Date; toUtc: Date } {
  return {
    fromUtc: new Date(fromPlantMs(new Date(`${from}T00:00:00.000Z`).getTime())),
    toUtc: new Date(fromPlantMs(new Date(`${to}T23:59:59.999Z`).getTime())),
  };
}

export async function listAdjustmentsInPeriod(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  station: number | null,
): Promise<CalibrationAdjustmentRow[]> {
  const { fromUtc, toUtc } = periodAsUtcBounds(from, to);
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('fromUtc', mssql.DateTime2, fromUtc)
    .input('toUtc', mssql.DateTime2, toUtc);
  if (station != null) req.input('station', mssql.Int, station);
  const r = await req.query<{
    adjustment_id: number; station_id: number | null; adjusted_at_utc: Date; recorded_at_utc: Date;
    recorded_by: string | null; reason: string | null; note: string | null; amount_g: number | null;
  }>(
    `SELECT a.adjustment_id, a.station_id, a.adjusted_at_utc, a.recorded_at_utc,
            u.display_name AS recorded_by, a.reason, a.note, a.amount_g
       FROM sms.calibration_adjustment a
       LEFT JOIN sms.app_user u ON u.user_id = a.recorded_by
      WHERE a.line_id = @line AND a.adjusted_at_utc BETWEEN @fromUtc AND @toUtc
        ${station != null ? 'AND (a.station_id = @station OR a.station_id IS NULL)' : ''}
      ORDER BY a.adjusted_at_utc ASC, a.adjustment_id ASC`,
  );
  return r.recordset.map((x) => ({
    adjustmentId: Number(x.adjustment_id),
    stationId: x.station_id == null ? null : Number(x.station_id),
    adjustedAtUtc: new Date(x.adjusted_at_utc).toISOString(),
    recordedAtUtc: new Date(x.recorded_at_utc).toISOString(),
    recordedBy: x.recorded_by,
    reason: x.reason,
    note: x.note,
    amountG: x.amount_g == null ? null : Number(x.amount_g),
  }));
}

export async function getCalibrationReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
): Promise<CalibrationReportData> {
  const { from, to } = resolved;
  const station = filters.station ?? null;
  const [ws, adjustments, scope, catalogue] = await Promise.all([
    getWeightStations(pool, lineId, from, to),
    listAdjustmentsInPeriod(pool, lineId, from, to, station),
    resolveGenerationScope(pool, lineId, { from, to }, ['cone_event']),
    loadProductCatalogue(pool),
  ]);
  const ran = describeRanTarget(await productsRanInPeriod(pool, lineId, from, to, catalogue, scope, station));
  const useRan = ran.products.length > 0;
  const periodDays = daysIn(from, to);
  const adjustmentsOf = new Map<number, number>();
  for (const a of adjustments) {
    if (a.stationId != null) adjustmentsOf.set(a.stationId, (adjustmentsOf.get(a.stationId) ?? 0) + 1);
  }
  const stations: CalibrationStationRow[] = ws.stations
    .filter((s) => station == null || s.station === station)
    .map((s) => ({
      station: s.station,
      n: s.n,
      meanG: s.meanG,
      vsLineG: s.vsLineG,
      vsTargetG: s.vsTargetG,
      daysHeld: s.daysHeld,
      flagged: s.flagged,
      daysFlagged: s.days.filter((d) => d.nelson.length > 0).length,
      daysWithData: s.days.length,
      lastAdjustedUtc: s.lastAdjustedUtc,
      adjustmentsInPeriod: adjustmentsOf.get(s.station) ?? 0,
    }))
    .sort((a, b) => a.station - b.station);
  return {
    period: resolved,
    filters,
    lineMeanG: ws.lineMeanG,
    targetG: useRan ? ran.targetG : ws.targetG,
    productLabel: useRan ? ran.label : ws.productLabel,
    thresholdG: ws.thresholdG,
    minDaysHeld: ws.minDaysHeld,
    periodDays,
    driftRuleCanFire: periodDays >= ws.minDaysHeld,
    productsRan: ran.products,
    targetOmittedReason: useRan ? ran.omittedReason : null,
    generationNote: noteOf(scope),
    stations,
    flaggedStationCount: stations.filter((s) => s.flagged).length,
    adjustments,
    note:
      'Drift is judged on daily station means against the line; a station is flagged when a pattern test fired inside a run ' +
      'of consecutive days on one side of the line, of at least the minimum length, at least the threshold away. Adjustments ' +
      'are those logged in this system from go-live; nothing before it is recorded. Weighing data cannot tell a heavy scale ' +
      'from heavy cones, so no direction of adjustment is stated.',
  };
}

export const CALIBRATION_CSV_HEADERS = [
  'section', 'station', 'n', 'mean_g', 'vs_line_g', 'vs_target_g', 'days_held', 'flagged', 'days_flagged', 'days_with_data',
  'last_adjusted_utc', 'adjustments_in_period', 'adjustment_id', 'adjusted_at_utc', 'amount_g', 'reason', 'note', 'recorded_by',
] as const;

export function calibrationCsv(d: CalibrationReportData): CsvTable {
  const rows: CsvRow[] = [
    ...d.stations.map((s): CsvRow => [
      'station', s.station, s.n, s.meanG, s.vsLineG, s.vsTargetG, s.daysHeld, s.flagged, s.daysFlagged, s.daysWithData,
      s.lastAdjustedUtc, s.adjustmentsInPeriod, null, null, null, null, null, null,
    ]),
    ...d.adjustments.map((a): CsvRow => [
      'adjustment', a.stationId, null, null, null, null, null, null, null, null,
      null, null, a.adjustmentId, a.adjustedAtUtc, a.amountG, a.reason, a.note, a.recordedBy,
    ]),
  ];
  return { headers: CALIBRATION_CSV_HEADERS, rows };
}
