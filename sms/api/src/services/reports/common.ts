/**
 * The nine report types on one surface — roadmap Phase 8 (15 Sep 2026).
 *
 * Until this wave the application produced ONE of the nine reports IFL's
 * quotation names (the daily production summary, `services/report.ts`). The
 * other eight had their figures computed somewhere — the station table, the
 * Pareto, the control chart, the ledger — but nowhere a manager could ask
 * for "the reject report for last month" and get one page, one CSV and one
 * printed sheet with the line, the period and who produced it on it.
 *
 * WHAT THIS FOLDER IS, AND IS NOT. Each module here COMPOSES a report from
 * the services that already compute its figures (production, rejects,
 * weightStations, weights, reconciliation, calibration, shiftCheck). It does
 * not recompute a number a service already computes: a figure on a report
 * must be the same figure the screen shows, and the only way to guarantee
 * that is to obtain it from the same function. Where a report needs a
 * figure no service computes (a per-product weight average, a median), the
 * query lives here and uses the ONE population rule and the ONE state CASE
 * from coneState.ts, so it cannot disagree with the rest of the application
 * about which readings count.
 *
 * Every KPI these reports print is defined in the repository-root
 * KPI-DEFINITIONS.md, the sheet IFL signs (Phase 8 acceptance). Every row of
 * it is "IFL approval: awaiting" until they do.
 */
import type { ShiftCode } from '@sms/shared';

export const REPORT_TYPES = [
  'daily',
  'shift',
  'product',
  'station',
  'reject',
  'cone-weight',
  'sack',
  'calibration',
  'management-summary',
  // The tenth type — product by machine and shift — on IFL's answer of
  // 15 Sep 2026 to Q28 ("sack stock per machine" = production per machine by
  // shift and day). Registered last so the nine existing CSV/RBAC pins hold.
  'machine-product',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(s: string): s is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(s);
}

/** Plain titles, for the print header and the CSV attribution rows. */
export const REPORT_TITLES: Record<ReportType, string> = {
  daily: 'Daily production report',
  shift: 'Shift report',
  product: 'Product report',
  station: 'Machine / station report',
  reject: 'Reject report',
  'cone-weight': 'Cone weight report',
  sack: 'Sack report',
  calibration: 'Calibration report',
  'management-summary': 'Management summary',
  'machine-product': 'Product by machine and shift',
};

/**
 * The rank each report needs. Every report is a read open to every signed-in
 * account (the one audience rule, CLAUDE.md), except the management summary,
 * which the contract puts at manager — it carries the period-over-period
 * KPI set, the one page meant for the GM. Exports are rank 3 like the
 * register export: walking off with a file is not the same act as reading.
 */
export const REPORT_RANK: Record<ReportType, 1 | 3> = {
  daily: 1,
  shift: 1,
  product: 1,
  station: 1,
  reject: 1,
  'cone-weight': 1,
  sack: 1,
  calibration: 1,
  'management-summary': 3,
  'machine-product': 1,
};
export const EXPORT_RANK = 3;

export type ReportFilterName = 'shift' | 'product' | 'station';

export interface ReportFilters {
  shift?: ShiftCode;
  /** material_id — the reading's own product. */
  product?: number;
  station?: number;
}

/**
 * Which filters each report accepts. A filter a report cannot honour is
 * REFUSED (400), never silently ignored: a "cone weight report for the night
 * shift" that quietly printed the whole day would be a wrong page with the
 * right title. The limits come from the services each report composes —
 * `getWeights` and `getWeightStations` take no shift, `sack_event` has no
 * station — and widen as those services do.
 */
export const FILTERS_BY_TYPE: Record<ReportType, readonly ReportFilterName[]> = {
  daily: ['shift'],
  shift: ['shift'],
  product: ['shift', 'station'],
  station: [],
  reject: ['shift', 'station', 'product'],
  'cone-weight': [],
  sack: ['shift'],
  calibration: ['station'],
  'management-summary': [],
  // Shift narrows the columns to one shift per day, station the rows to one
  // machine. No product filter: a cell that hid the other product a machine
  // ran in the same shift would misreport the shift.
  'machine-product': ['shift', 'station'],
};

/** A production-day range, inclusive, as every day-grained endpoint takes it. */
export interface DayRange {
  from: string;
  to: string;
}

/**
 * What every report response carries at the top, and every CSV in its
 * trailing attribution rows, and every printed page in its header: which
 * line, which period, under which filters, generated when on the PLANT's
 * clock, by whom, from which SMS version. A printed report without these is
 * an undated, unattributed sheet of numbers — the defect the gap analysis
 * recorded against the Readings print button.
 */
export interface ReportHeader {
  reportType: ReportType;
  title: string;
  lineName: string;
  plantName: string | null;
  unitName: string | null;
  period: { period: string; from: string; to: string; days: number };
  filters: ReportFilters;
  /** Plant wall clock, on the production-time convention (render in UTC). */
  generatedAtPlantUtc: string;
  generatedBy: string;
  smsVersion: string;
  /** Repository-root KPI-DEFINITIONS.md — the sheet IFL signs. */
  definitions: 'KPI-DEFINITIONS.md';
  approval: 'awaiting';
  /**
   * RT24-03 (24 Sep 2026): whether this report's period crosses IFL's
   * 2026-08-05 rebuild boundary and a source generation had to be excluded
   * to keep every figure on this report describing one physical table
   * generation — the same rule `generation.ts`'s `GenerationNote` states to
   * a screen, now stated on every EXPORTED surface too (CSV/XLSX/PDF used to
   * drop this silently; the JSON payload already carried it per report type,
   * see daily.ts's own `generationNote`). This is the single source of
   * truth every export format reads from — no format recomputes it.
   */
  spansGenerations: boolean;
  /** The generation this report is centred on (the newest one present in the window), as a printable label; null when `spansGenerations` is false or the label is unknown. */
  sourceGeneration: string | null;
  /** How many readings in the window belong to the generation that was excluded; null when `spansGenerations` is false. `percent` is null unless a caller can back it with a real denominator — never fabricated. */
  otherGenerationExcluded: { count: number; percent: number | null; simulator?: number } | null;
  /**
   * The one printable disclosure sentence (verification 25 Sep 2026, R6/R7):
   * names simulator data as "the plant simulator", never as "another
   * generation" or a rebuild. Null when there is nothing to disclose.
   */
  generationLine?: string | null;
  /**
   * Task B (28 Sep 2026): true when `sourceGeneration` names a plant-
   * simulator generation — a period entirely covered by the simulator never
   * sets `spansGenerations` (nothing was excluded from IT), so a screen that
   * only checked `spansGenerations` used to print a simulator-only report
   * with no disclosure at all. Optional: absent on a header built before this
   * field existed, never itself a claim of "no".
   */
  simulatorSource?: boolean;
}

/**
 * The two lines every export surface (CSV trailing rows, XLSX header sheet,
 * the printed page) states verbatim when a report spans a source-generation
 * boundary — one wording, read from the header, never recomputed per
 * format. Null when the report does not span generations, so a caller can
 * test "nothing to disclose" with a single null check.
 */
/** How a simulator source is named in print — its database name ends in _SIM. */
export const SIMULATOR_DB_HINT = 'DATA_TP1U2_SIM, synthetic data, not IFL’s';

export function generationDisclosureLines(h: Pick<ReportHeader, 'spansGenerations' | 'sourceGeneration' | 'otherGenerationExcluded'>): [string, string] | null {
  if (!h.spansGenerations) return null;
  const exc = h.otherGenerationExcluded;
  const pctPart = exc?.percent != null ? ` (${exc.percent}%)` : '';
  const count = exc ? exc.count : 0;
  const sim = Math.min(exc?.simulator ?? 0, count);
  const simPart =
    sim === 0 ? '' : sim === count ? `, all from the plant simulator (${SIMULATOR_DB_HINT})` : `, of which ${sim} from the plant simulator (${SIMULATOR_DB_HINT})`;
  return [
    `Data batch: ${h.sourceGeneration ?? 'unknown'}`,
    `Excluded from another data batch: ${count} readings${pctPart}${simPart}`,
  ];
}

/* ------------------------------------------------------- pure arithmetic */

const DAY_MS = 86_400_000;
const parseDay = (s: string): number => new Date(`${s}T12:00:00Z`).getTime();
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Calendar days in an inclusive range — the same count report.ts uses. */
export function daysIn(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS) + 1;
}

/**
 * The period of EQUAL LENGTH immediately before `[from, to]`, ending the day
 * before `from`. A 7-day week is compared with the 7 days before it; a
 * calendar month of 31 days with the 31 days before it (not "the previous
 * month", which may be 30 — equal length keeps the two counts comparable
 * without a per-day normalisation nobody would check). Pure, in UTC, on
 * production-day labels: no offset can move a boundary here.
 */
export function priorPeriod(from: string, to: string): DayRange {
  const n = daysIn(from, to);
  const priorTo = parseDay(from) - DAY_MS;
  const priorFrom = priorTo - (n - 1) * DAY_MS;
  return { from: isoDay(priorFrom), to: isoDay(priorTo) };
}

export interface Delta {
  /** current − prior, in the figure's own unit. */
  abs: number;
  /** (current − prior) / |prior| × 100, or null when the prior is 0 (no meaningful ratio). */
  pct: number | null;
}

/**
 * The change from the prior period. Null when either side is unknown: a
 * delta against a period with no readings is not "down 100 %", it is
 * nothing to compare with, and the screen prints a dash.
 */
export function delta(current: number | null, prior: number | null): Delta | null {
  if (current == null || prior == null) return null;
  const abs = Math.round((current - prior) * 100) / 100;
  const pct = prior === 0 ? null : Math.round((1000 * (current - prior)) / Math.abs(prior)) / 10;
  return { abs, pct };
}

/** Round to `dp` places; null stays null. */
export function round(n: number | null | undefined, dp = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** A percentage of `of`, to one decimal; null when `of` is 0. */
export function pct(part: number, of: number): number | null {
  return of > 0 ? Math.round((1000 * part) / of) / 10 : null;
}

/* ------------------------------------------------ the period's own target */

/**
 * THE §8 RULE, ENFORCED AT THE ONE PLACE A REPORT STATES A TARGET (friction
 * audit F6, 23 Sep 2026): "a reading is judged by the limits in force at its
 * own time, never by today's mirror."
 *
 * `ProductCatalogue.versionAt` is already honest — when NO version began at
 * or before the asked-for instant it returns the nearest one and marks it
 * `effectiveIsLowerBound: true`. That flag was then dropped by every caller
 * on the way to a report payload, so Report › Cone weight published
 * `inForceAtUtc: 2026-09-11` under `source: 'in_force_at_period_end'` for a
 * period ending 2026-09-07 — a target dated four days AFTER the readings it
 * was judging them against, printed under a caption promising the opposite.
 *
 * Two DIFFERENT things wear the same flag and this function separates them:
 *
 *  - a version the app merely OBSERVED already in place (migration 027's
 *    bootstrap rows, every `pdas_observed` row) that began at or before the
 *    period end. The limits did apply; we only cannot prove they started
 *    exactly then. Usable, qualified as "no later than" — `isLowerBound`.
 *  - a version whose effective instant is AFTER the period end. Those limits
 *    demonstrably did not exist while the readings were taken. NOT usable:
 *    the report states no target at all and says why, rather than picking the
 *    nearest version and calling it "in force".
 */
export interface PeriodTarget {
  /** True when a target may be stated for this period at all. */
  usable: boolean;
  /** The version's instant; null when there is no version. */
  inForceAtUtc: string | null;
  /** `inForceAtUtc` means NO LATER THAN, not exactly then. Only meaningful when `usable`. */
  isLowerBound: boolean;
  /** Printable reason the target was withheld; null when one is stated, or when there was simply no product. */
  omittedReason: string | null;
}

/** The date part of an ISO instant, for a sentence a manager reads. */
const instantDay = (iso: string) => iso.slice(0, 10);

export function resolvePeriodTarget(
  version: { effectiveFromMs: number; effectiveFromUtc: string; effectiveIsLowerBound: boolean } | null,
  periodEndMs: number,
  periodTo: string,
): PeriodTarget {
  if (!version) return { usable: false, inForceAtUtc: null, isLowerBound: false, omittedReason: null };
  if (version.effectiveFromMs > periodEndMs) {
    return {
      usable: false,
      inForceAtUtc: version.effectiveFromUtc,
      isLowerBound: false,
      omittedReason:
        `No target is stated: the earliest limits this system holds for that product were first recorded on ` +
        `${instantDay(version.effectiveFromUtc)}, after this period ended on ${periodTo}. What was actually in force ` +
        'during the period is not recorded anywhere, and a reading is judged by the limits in force at its own time — ' +
        'never by a later record applied backwards.',
    };
  }
  return {
    usable: true,
    inForceAtUtc: version.effectiveFromUtc,
    isLowerBound: version.effectiveIsLowerBound,
    omittedReason: null,
  };
}
