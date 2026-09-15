/**
 * The report header — roadmap Phase 8 (15 Sep 2026).
 *
 * One function builds the block every report carries, so the JSON a screen
 * renders, the trailing rows of the CSV and the print header all say the
 * same line, the same period, the same generation time and the same author.
 *
 * TWO CLOCKS (plantClock.ts): "generated at" is the PLANT's wall clock, on
 * the production-time convention every reading is stored in, because a
 * printed plant record is stamped with the time the plant was keeping. It is
 * NOT the server's UTC — five hours apart on this plant.
 */
import type { ConnectionPool } from 'mssql';
import type { AuthUser } from '../../auth.js';
import { getLineIdentity } from '../lineConfig.js';
import { SERVICE_VERSION } from '../health.js';
import { plantNowMs } from '../plantClock.js';
import { daysIn, REPORT_TITLES, type ReportFilters, type ReportHeader, type ReportType } from './common.js';

export interface HeaderInput {
  reportType: ReportType;
  period: { period: string; from: string; to: string };
  filters: ReportFilters;
  user: Pick<AuthUser, 'username' | 'displayName'> | null | undefined;
  /** LINE_NAME from the environment — used only when sms.line has no row. */
  lineNameFallback: string;
  /** For a replay (?at=), the plant instant the report is generated "at". */
  plantNowMsOverride?: number | null;
}

export async function buildHeader(pool: ConnectionPool, lineId: number, input: HeaderInput): Promise<ReportHeader> {
  const line = await getLineIdentity(pool, lineId);
  const nowMs = input.plantNowMsOverride ?? plantNowMs();
  return {
    reportType: input.reportType,
    title: REPORT_TITLES[input.reportType],
    lineName: line?.displayName ?? input.lineNameFallback,
    plantName: line?.plant.name ?? null,
    unitName: line?.unit.name ?? null,
    period: { ...input.period, days: daysIn(input.period.from, input.period.to) },
    filters: input.filters,
    generatedAtPlantUtc: new Date(nowMs).toISOString(),
    generatedBy: input.user ? (input.user.displayName ?? input.user.username) : 'unknown',
    smsVersion: SERVICE_VERSION,
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
  };
}
