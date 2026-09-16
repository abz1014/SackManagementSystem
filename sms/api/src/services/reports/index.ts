/**
 * The dispatcher: one report type in, one composed report out, and the same
 * report as one CSV table — roadmap Phase 8 (15 Sep 2026). The route module
 * (routes/reports.ts) knows nothing about any individual report.
 */
import type { ConnectionPool } from 'mssql';
import type { ResolvedPeriod } from '../report.js';
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
}

export type AnyReportData = ReportDataByType[ReportType];

type Builder<T extends ReportType> = (
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
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
};

export function buildReport<T extends ReportType>(
  pool: ConnectionPool,
  lineId: number,
  type: T,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
): Promise<ReportDataByType[T]> {
  return BUILDERS[type](pool, lineId, resolved, filters);
}

export function reportCsv<T extends ReportType>(type: T, data: ReportDataByType[T]): CsvTable {
  // The table is keyed so that CSV[type] is exactly the serialiser for
  // ReportDataByType[type]; TypeScript cannot see that through the indexed
  // access, so the one cast lives here.
  return (CSV[type] as (d: ReportDataByType[T]) => CsvTable)(data);
}

export * from './common.js';
export { buildHeader } from './header.js';
export { csvDocument, csvFilename, reportFilename, attributionRows, toCsv, escapeCell } from './csv.js';
export { buildXlsx, reportSheets, XLSX_CONTENT_TYPE } from './xlsx.js';
