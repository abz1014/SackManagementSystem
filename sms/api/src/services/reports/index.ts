/**
 * The dispatcher: one report type in, one composed report out, and the same
 * report as one CSV table — roadmap Phase 8 (15 Sep 2026), now eighteen types
 * (the six that complete IFL's own list of eight arrive as scaffolds on
 * 1 Oct 2026). The route module (routes/reports.ts) knows nothing about any
 * individual report.
 */
import type { ConnectionPool } from 'mssql';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import type { ReportFilters, ReportType } from './common.js';
import type { CsvTable } from './csv.js';
import { getDailyReport, dailyCsv, type DailyReportData } from './daily.js';
import { getShiftReport, shiftCsv, type ShiftReportData } from './shift.js';
import { getProductReport, productCsv, type ProductReportData } from './product.js';
import { getStationReport, stationCsv, type StationReportData } from './station.js';
import { getRejectReport, rejectCsv, type RejectReportData } from './reject.js';
import { getConeWeightReport, coneWeightCsv, type ConeWeightReportData } from './coneWeight.js';
import { getSackReport, sackCsv, type SackReportData } from './sack.js';
import { getCalibrationReport, calibrationCsv, type CalibrationReportData } from './calibration.js';
import { getManagementSummary, summaryCsv, type ManagementSummaryData } from './summary.js';
import { getMachineProductReport, machineProductCsv, type MachineProductReportData } from './machineProduct.js';
import { getShiftProductionReport, shiftProductionCsv, type ShiftProductionReportData } from './shiftProduction.js';
import { getRejectedConesReport, rejectedConesCsv, type RejectedConesReportData } from './rejectedCones.js';
import { getRejectedSacksReport, rejectedSacksCsv, type RejectedSacksReportData } from './rejectedSacks.js';
import { getSpsPackingReport, spsPackingCsv, type SpsPackingReportData } from './spsPacking.js';
import { getSackWeightRangeReport, sackWeightRangeCsv, type SackWeightRangeReportData } from './sackWeightRange.js';
import { getSackWeightSummaryReport, sackWeightSummaryCsv, type SackWeightSummaryReportData } from './sackWeightSummary.js';
import { getRejectedHangersReport, rejectedHangersCsv, type RejectedHangersReportData } from './rejectedHangers.js';
import { getRejectedUnknownLifterReport, rejectedUnknownLifterCsv, type RejectedUnknownLifterReportData } from './rejectedUnknownLifter.js';

export interface ReportDataByType {
  daily: DailyReportData;
  shift: ShiftReportData;
  product: ProductReportData;
  station: StationReportData;
  reject: RejectReportData;
  'cone-weight': ConeWeightReportData;
  sack: SackReportData;
  calibration: CalibrationReportData;
  'management-summary': ManagementSummaryData;
  'machine-product': MachineProductReportData;
  'shift-production': ShiftProductionReportData;
  'rejected-cones': RejectedConesReportData;
  'rejected-sacks': RejectedSacksReportData;
  'sps-packing': SpsPackingReportData;
  'sack-weight-range': SackWeightRangeReportData;
  'sack-weight-summary': SackWeightSummaryReportData;
  'rejected-hangers': RejectedHangersReportData;
  'rejected-unknown-lifter': RejectedUnknownLifterReportData;
}

export type AnyReportData = ReportDataByType[ReportType];

/**
 * Chart overhaul wave 2 (Task TD, 29 Sep 2026): widened with an optional 5th
 * `shiftRange` argument — every individual builder (daily/shift/product/
 * station/reject/cone-weight/sack/machine-product/management-summary)
 * already accepts one; `calibration` alone does not (there is no calibration
 * period to range — a2cea3f), which stays a valid `Builder<'calibration'>`
 * because a function accepting fewer parameters than a type declares is
 * still assignable to it. Previously fixed at 4 arguments, so `buildReport`
 * below could never pass the shiftRange every builder was already wired to
 * accept from routes/reports.ts's own `Parsed.shiftRange` (Task TC).
 */
type Builder<T extends ReportType> = (
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
) => Promise<ReportDataByType[T]>;

const BUILDERS: { [T in ReportType]: Builder<T> } = {
  daily: getDailyReport,
  shift: getShiftReport,
  product: getProductReport,
  station: getStationReport,
  reject: getRejectReport,
  'cone-weight': getConeWeightReport,
  sack: getSackReport,
  calibration: getCalibrationReport,
  'management-summary': getManagementSummary,
  'machine-product': getMachineProductReport,
  'shift-production': getShiftProductionReport,
  'rejected-cones': getRejectedConesReport,
  'rejected-sacks': getRejectedSacksReport,
  'sps-packing': getSpsPackingReport,
  'sack-weight-range': getSackWeightRangeReport,
  'sack-weight-summary': getSackWeightSummaryReport,
  'rejected-hangers': getRejectedHangersReport,
  'rejected-unknown-lifter': getRejectedUnknownLifterReport,
};

const CSV: { [T in ReportType]: (d: ReportDataByType[T]) => CsvTable } = {
  daily: dailyCsv,
  shift: shiftCsv,
  product: productCsv,
  station: stationCsv,
  reject: rejectCsv,
  'cone-weight': coneWeightCsv,
  sack: sackCsv,
  calibration: calibrationCsv,
  'management-summary': summaryCsv,
  'machine-product': machineProductCsv,
  'shift-production': shiftProductionCsv,
  'rejected-cones': rejectedConesCsv,
  'rejected-sacks': rejectedSacksCsv,
  'sps-packing': spsPackingCsv,
  'sack-weight-range': sackWeightRangeCsv,
  'sack-weight-summary': sackWeightSummaryCsv,
  'rejected-hangers': rejectedHangersCsv,
  'rejected-unknown-lifter': rejectedUnknownLifterCsv,
};

export function buildReport<T extends ReportType>(
  pool: ConnectionPool,
  lineId: number,
  type: T,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  /** Chart overhaul wave 2 (Task TD, 29 Sep 2026): threaded to the builder verbatim. */
  shiftRange?: ShiftRange,
): Promise<ReportDataByType[T]> {
  return BUILDERS[type](pool, lineId, resolved, filters, shiftRange);
}

export function reportCsv<T extends ReportType>(type: T, data: ReportDataByType[T]): CsvTable {
  // The table is keyed so that CSV[type] is exactly the serialiser for
  // ReportDataByType[type]; TypeScript cannot see that through the indexed
  // access, so the one cast lives here.
  return (CSV[type] as (d: ReportDataByType[T]) => CsvTable)(data);
}

export * from './common.js';
export type {
  ShiftProductionReportData, ShiftProductionRow, ShiftProductionSummaryRow, ShiftProductionShiftTotal, ShiftProductionDayTotal,
  ShiftProductionWinderTotal, ShiftProductionFigures,
} from './shiftProduction.js';
export type { RejectedConesReportData, RejectedConeRow, RejectedConeLimits, WeightRangeRow, WeightRangeByWinder } from './rejectedCones.js';
export type { RejectedSacksReportData, RejectedSackRow, RejectedSackShiftRow, RejectedSackDayRow, RejectedSackPassedRange, RejectedSackCounts } from './rejectedSacks.js';
export type { SpsPackingReportData, SpsCountColumn, SpsCell, SpsMatrixRow, SpsCountTotal, SpsBlock } from './spsPacking.js';
export type { SackWeightRangeReportData, SackWeightBand, SackBandCounts, SackBandKind, SackSpreadRow } from './sackWeightRange.js';
export type { SackWeightSummaryReportData, SackSummaryFigures, SackSummaryRow, SackSummaryDayTotal, SackSummaryShiftTotal, SackSummaryCountRow } from './sackWeightSummary.js';
export type { RejectedHangersReportData, RejectedHangerRow, RejectedHangerReject, RejectedHangerFlag } from './rejectedHangers.js';
export type { RejectedUnknownLifterReportData, LifterRow, UnknownLifterReject } from './rejectedUnknownLifter.js';
export { plantWallClock, parsePlantWallClock } from './plantTime.js';
export { buildHeader } from './header.js';
export { csvDocument, csvFilename, reportFilename, attributionRows, toCsv, escapeCell, periodText, CSV_BOM } from './csv.js';
export { reportNotesOf, PENDING_IFL_HEADING } from './notes.js';
export { buildXlsx, reportSheets, XLSX_CONTENT_TYPE } from './xlsx.js';
