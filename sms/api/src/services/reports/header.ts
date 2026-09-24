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
import type { GenerationNote } from '../generation.js';
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
  /**
   * RT24-03 (24 Sep 2026): the already-composed report's own generation
   * disclosure, whichever shape that report type carries it in
   * (`data.generationNote`, `data.generationNote.current` on the management
   * summary, or `reject.ts`'s bare `spansGenerations`) — pass the report
   * data object itself; `extractGenerationNote` below normalises it. Null or
   * omitted means "no disclosure known", never "nothing to disclose" — a
   * caller that has no report data yet (the standalone `/api/reports/header`
   * route) genuinely cannot state one either way.
   */
  reportData?: unknown;
}

/**
 * Normalises whichever shape a report type's own composed data carries its
 * generation note in into one `GenerationNote`, so `buildHeader` does not
 * need a switch over every report type. Returns null when the given data
 * carries no generation information at all.
 */
export function extractGenerationNote(data: unknown): GenerationNote | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const gn = d.generationNote;
  if (gn == null) {
    // reject.ts's own shape: a bare `spansGenerations` boolean, no
    // generation reference and no excluded-row count.
    if (typeof d.spansGenerations === 'boolean') {
      return { generation: null, spansGenerations: d.spansGenerations, otherGenerationExcluded: 0 };
    }
    return null;
  }
  if (typeof gn === 'object' && gn !== null && 'current' in (gn as Record<string, unknown>)) {
    // management-summary's { current, prior } — the report is centred on `current`.
    return (gn as { current: GenerationNote }).current;
  }
  return gn as GenerationNote;
}

export async function buildHeader(pool: ConnectionPool, lineId: number, input: HeaderInput): Promise<ReportHeader> {
  const line = await getLineIdentity(pool, lineId);
  const nowMs = input.plantNowMsOverride ?? plantNowMs();
  const gn = extractGenerationNote(input.reportData);
  const spansGenerations = gn?.spansGenerations ?? false;
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
    spansGenerations,
    sourceGeneration: spansGenerations ? (gn?.generation?.label ?? null) : null,
    otherGenerationExcluded: spansGenerations && gn ? { count: gn.otherGenerationExcluded, percent: null } : null,
  };
}
