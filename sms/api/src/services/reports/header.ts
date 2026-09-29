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
import type { ShiftRange } from '../../shiftRange.js';
import { daysIn, generationDisclosureLines, REPORT_TITLES, SHIFT_SOURCE_NOTE, type ReportFilters, type ReportHeader, type ReportType } from './common.js';

/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): the plain-words form of a
 * shift-bounded period — "2 Sep morning shift – 3 Sep night shift" — for the
 * report header, the CSV/PDF/XLSX attribution block and the printed page.
 * "Plant time" is stated ONCE on the header (see `ReportHeader.period`'s own
 * caller, which already prints "plant time" beside `generatedAtPlantUtc"),
 * never repeated in this string.
 *
 * A same-shift, same-day range prints as one shift, not a redundant range —
 * `shiftRangeQuery`'s own pairing rule explicitly allows `from === to &&
 * fromShift === toShift` to name exactly one shift.
 *
 * `web/src/lib/period.ts`'s `describePeriod` (T0) is the client's copy of
 * this same wording; keep the two in sync — both take a `ShiftRange` and
 * must read identically on screen and on paper.
 */
export function describeShiftRangePeriod(range: ShiftRange): string {
  const day = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
  };
  const shiftWord = (s: ShiftRange['fromShift']): string => `${s} shift`;
  const sameShift = range.from === range.to && range.fromShift === range.toShift;
  if (sameShift) return `${day(range.from)} ${shiftWord(range.fromShift)}`;
  return `${day(range.from)} ${shiftWord(range.fromShift)} – ${day(range.to)} ${shiftWord(range.toShift)}`;
}

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
  /**
   * Task B (28 Sep 2026): the register's own resolved `GenerationNote`,
   * passed by `/api/reports/header` when it resolves a `batch` param for the
   * Readings/Sacks print header — a SEPARATE input from `reportData`, since
   * the register has no `AnyReportData` shape of its own to extract one
   * from. When both are given, `reportData`'s own note wins (a composed
   * report always has one); this is the register-only fallback.
   */
  generationNote?: GenerationNote | null;
  /**
   * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): when the caller resolved
   * a shift-bounded period, its plain-words form is built from THIS rather
   * than from `period.from`/`period.to` alone — see `periodLabel` and
   * `describeShiftRangePeriod`.
   */
  shiftRange?: ShiftRange | null;
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
  if (gn == null || (typeof gn === 'object' && gn !== null && 'current' in (gn as Record<string, unknown>) && (gn as { current: unknown }).current == null)) {
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
  // `reportData`'s own note wins when both are given — a composed report
  // always carries one; `generationNote` is the register-only fallback for
  // the standalone header route (Task B, 28 Sep 2026 — see HeaderInput).
  const gn = extractGenerationNote(input.reportData) ?? input.generationNote ?? null;
  const spansGenerations = gn?.spansGenerations ?? false;
  const g = gn?.generation ?? null;
  // A simulator generation is named as one, detected from its source database
  // name (…_SIM), not from the recorded provenance — see generation.ts.
  const genLabel = g ? (g.simulator ? `${g.label ?? g.sourceDb ?? 'unknown'} (plant simulator, synthetic data)` : g.label) : null;
  // Task B (28 Sep 2026): the disclosure prints when the period spans
  // batches OR the source itself is the simulator — a period entirely
  // covered by the simulator never sets `spansGenerations` (nothing was
  // EXCLUDED), so that alone used to leave a simulator-only report silently
  // unlabelled. `simulatorSource` names this case, and `sourceGeneration`
  // states it even when nothing else was excluded.
  const simulatorSource = g?.simulator === true;
  const disclosure = {
    spansGenerations,
    sourceGeneration: spansGenerations || simulatorSource ? (genLabel ?? null) : null,
    otherGenerationExcluded: spansGenerations && gn
      ? { count: gn.otherGenerationExcluded, percent: null, simulator: gn.excludedSimulator ?? 0 }
      : null,
  };
  const periodLabel = input.shiftRange ? describeShiftRangePeriod(input.shiftRange) : `${input.period.from} to ${input.period.to}`;
  const lines = generationDisclosureLines(disclosure);
  // When nothing was excluded but the source IS the simulator, there is no
  // "excluded" line to compose — state the one fact plainly instead.
  const generationLine = lines
    ? `${lines[0]}. ${lines[1]}.`
    : simulatorSource
      ? `Data batch: ${genLabel ?? 'unknown'}.`
      : null;
  return {
    reportType: input.reportType,
    title: REPORT_TITLES[input.reportType],
    lineName: line?.displayName ?? input.lineNameFallback,
    plantName: line?.plant.name ?? null,
    unitName: line?.unit.name ?? null,
    period: { ...input.period, days: daysIn(input.period.from, input.period.to) },
    periodLabel,
    filters: input.filters,
    generatedAtPlantUtc: new Date(nowMs).toISOString(),
    generatedBy: input.user ? (input.user.displayName ?? input.user.username) : 'unknown',
    smsVersion: SERVICE_VERSION,
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
    shiftNote: SHIFT_SOURCE_NOTE,
    ...disclosure,
    generationLine,
    simulatorSource,
  };
}
