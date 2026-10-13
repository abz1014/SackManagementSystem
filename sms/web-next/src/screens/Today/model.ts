/**
 * Pure figures for the Today screen. No fetching, no state decisions: station states, health and
 * period maths all arrive from the server or from lib/ (via the bridge). What is here is arithmetic
 * the old Line screen already did (Line.tsx periodFigures, kpiBlockNote) and word choice.
 *
 * A missing field is "could not be read", never zero (CLAUDE.md WS-B1): every reader below returns
 * null for an absent or non-numeric value, and callers print a dash.
 */
import type {
  AttentionFinding,
  MachineRunning,
  ProductionData,
  ProductionDataIssue,
  ProductionRow,
  StationStatusRow,
} from '../../bridge/api';
import { period as P } from '../../bridge/lib';
import { W } from '../../bridge/words';
import { C, formatClock, formatDate, FRAGMENTS } from '../../copy';
import { fmtDayShort, fmtTime } from '../../lib/fmt';
import type { KpiDelta } from '../../ui/KpiCard';

const T = C.today;
const TF = FRAGMENTS.today;

/** "12:00" when `iso` is on the same plant day as `nowIso`, else "12:00, Mon 7 Sep". Plant clock, 24-hour (lib/fmt). */
export function clockOn(iso: string, nowIso: string): string {
  return iso.slice(0, 10) === nowIso.slice(0, 10) ? fmtTime(iso) : `${fmtTime(iso)}, ${fmtDayShort(iso)}`;
}

/* ---------------------------------------------------------------- numbers */

export const nf0 = (n: number): string => (Number.isFinite(n) ? n.toLocaleString('en-GB') : '-');
export const nf1 = (n: number): string => (Number.isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** True when `dataIssues` names `field` for this row, or the key is structurally absent. */
export function unreadable(r: ProductionRow | null, data: ProductionData, field: keyof ProductionRow & string): boolean {
  if (r === null) return false;
  const issue = (data.dataIssues ?? []).some((i: ProductionDataIssue) => i.field === (field as ProductionDataIssue['field']) && i.group === r.group);
  return issue || !(field in r) || num((r as unknown as Record<string, unknown>)[field]) === null;
}

/** The single "total" row of a groupBy=none answer. */
export function totalRow(data: ProductionData | null | undefined): ProductionRow | null {
  return data?.rows?.[0] ?? null;
}

/** An answer with no readings at all (cones, sacks and failed inspections all absent or zero). */
export function isEmptyProduction(data: ProductionData): boolean {
  const r = totalRow(data);
  if (r === null) return true;
  return r.cones === 0 && (r.sacks === null || r.sacks === 0) && r.rejectedCones === 0;
}

export interface Figure {
  /** Formatted number, or null when it could not be read. */
  text: string | null;
  /** The number itself, for comparison. */
  value: number | null;
}
const fig = (v: number | null, f: (n: number) => string): Figure => ({ value: v, text: v === null ? null : f(v) });

export interface RateFigure {
  /** Percent, one decimal, or null (nothing weighed, or an input could not be read). */
  pct: number | null;
  /** Cones in the numerator. */
  n: number | null;
  /** Cones in the denominator, as the sentence states it. */
  of: number | null;
  unreadable: boolean;
}

/**
 * Failed inspection: rejectedCones over cones + unmatchedRejects. The IDENTICAL denominator Line,
 * Rejects and the reports use (a reject is mostly an existing cone row; adding every reject again
 * double-counts). A payload missing unmatchedRejects reads as unreadable, never as a recomputed rate.
 */
export function failedInspection(r: ProductionRow | null, data: ProductionData): RateFigure {
  if (r === null) return { pct: null, n: null, of: null, unreadable: false };
  const bad = unreadable(r, data, 'cones') || unreadable(r, data, 'rejectedCones') || unreadable(r, data, 'unmatchedRejects');
  const cones = num(r.cones);
  const n = num(r.rejectedCones);
  const unmatched = num(r.unmatchedRejects);
  if (bad || cones === null || n === null || unmatched === null) return { pct: null, n, of: null, unreadable: true };
  const weighed = cones + unmatched;
  return { pct: weighed > 0 ? Math.round((10000 * n) / weighed) / 100 : null, n, of: weighed, unreadable: false };
}

/**
 * Failed weight check (scale): every cone the scale marked out of range, over cones. The count is
 * the row's own `conesFailedScale` (SUM of in_range = 0), the same population as the summary KPI.
 * It is NOT `states.rejected`: that is an exclusive five-way classification in which a scale-flagged
 * cone with an implausible weight counts as "unknown" (design/redesign-2026-10/VERIFY-SCALE-COUNT.md).
 */
export function failedWeightCheck(r: ProductionRow | null, data: ProductionData): RateFigure {
  if (r === null) return { pct: null, n: null, of: null, unreadable: false };
  const cones = num(r.cones);
  const n = unreadable(r, data, 'conesFailedScale') ? null : num(r.conesFailedScale);
  if (unreadable(r, data, 'cones') || cones === null || n === null) return { pct: null, n, of: cones, unreadable: true };
  return { pct: cones > 0 ? Math.round((10000 * n) / cones) / 100 : null, n, of: cones, unreadable: false };
}

export interface Kpis {
  cones: Figure;
  sacks: Figure;
  kg: Figure;
  inspection: RateFigure;
  weight: RateFigure;
}
export function kpis(data: ProductionData): Kpis {
  const r = totalRow(data);
  const read = (f: keyof ProductionRow & string): number | null => (r === null || unreadable(r, data, f) ? null : num((r as unknown as Record<string, unknown>)[f]));
  return {
    cones: fig(read('cones'), nf0),
    sacks: fig(read('sacks'), nf0),
    kg: fig(read('sackWeightKg'), nf1),
    inspection: failedInspection(r, data),
    weight: failedWeightCheck(r, data),
  };
}

/* ------------------------------------------------------------ comparison */

function dir(diff: number): KpiDelta['direction'] {
  return diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
}

/** Percent change of a count or total against the comparison period. Null when it cannot be stated. */
export function countDelta(cur: Figure, prev: Figure, live: boolean, vs: (p: string) => string): KpiDelta | null {
  if (cur.value === null || prev.value === null || prev.text === null || prev.value === 0) return null;
  const diff = cur.value - prev.value;
  const pct = Math.abs((100 * diff) / prev.value);
  const text = `${nf1(pct)} %${live ? ` ${TF.kpi.soFar}` : ''}`;
  return { text, direction: dir(diff), vs: vs(prev.text) };
}

/** Change of a rate, in percentage points. */
export function rateDelta(cur: RateFigure, prev: RateFigure): KpiDelta | null {
  if (cur.pct === null || prev.pct === null) return null;
  const diff = Math.round((cur.pct - prev.pct) * 10) / 10;
  // A figure that rounds to 0.0 % next to "0.1 points vs 0.1 %" reads as nonsense: say which way it moved and what it was.
  if (diff !== 0 && nf1(cur.pct) === nf1(0)) {
    return { text: T.kpi.pointsMoved(nf1(Math.abs(diff)), diff < 0 ? 'lower' : 'higher'), direction: dir(diff), vs: TF.kpi.wasRate(nf1(prev.pct)) };
  }
  return { text: T.kpi.points(nf1(Math.abs(diff))), direction: dir(diff), vs: TF.kpi.vsRate(nf1(prev.pct)) };
}

/* ------------------------------------------------------------ the band */

export interface StationCounts {
  act: number;
  watch: number;
  judged: number;
}
/** How many stations the SERVER put in each state. Counting rows is not deciding a state. */
export function stationCounts(rows: readonly StationStatusRow[]): StationCounts {
  return {
    act: rows.filter((s) => s.state === 'act').length,
    watch: rows.filter((s) => s.state === 'watch').length,
    judged: rows.filter((s) => s.state !== 'nodata').length,
  };
}

export function stationSentence(c: StationCounts | null): string | null {
  if (c === null || c.judged === 0) return null;
  if (c.act > 0 && c.watch > 0) return `${T.band.needAction(c.act)}, ${T.band.toWatch(c.watch)}.`;
  if (c.act > 0) return `${T.band.needAction(c.act)}.`;
  if (c.watch > 0) return `${T.band.watchOnly(c.watch)}.`;
  return T.band.noneNeedAction;
}

/** "Line ran all three shifts." and its relatives, from the rows of a by-shift or by-day answer. */
export function ranSentence(
  rows: readonly ProductionRow[] | null,
  spread: 'day' | 'shift',
  period: { days: number; shift?: string; fromShift?: unknown },
): string | null {
  if (rows === null) return null;
  const real = rows.filter((r) => r.group !== 'total' && num(r.cones) !== null);
  const ran = real.filter((r) => r.cones > 0).length;
  if (ran === 0) return null;
  if (spread === 'shift') {
    if (period.shift) return T.band.ranShift;
    if (period.days === 1 && !period.fromShift) return ran === 3 ? T.band.ranAll : T.band.ranShifts(ran, 3);
    return T.band.ranShifts(ran, real.length);
  }
  return T.band.ranDays(ran, period.days);
}

/** The period in words for a caption: "1 Sep 2026" or "1 Sep 2026 to 7 Sep 2026". */
export function dayRange(from: string, to: string): string {
  const f = formatDate(`${from}T12:00:00Z`);
  return from === to ? f : `${f} to ${formatDate(`${to}T12:00:00Z`)}`;
}

/** The selected period in words, with its year: "1 Sep 2026", "13 Oct 2026, morning shift". */
export function periodWords(p: P.Period): string {
  if (p.shift) return `${formatDate(`${p.from}T12:00:00Z`)}, ${W.shift[p.shift]}`;
  if (p.fromShift || p.toShift) {
    // A range that ends on a shift name reads "1 Sep evening shift - 2 Sep morning shift, 2026"; a plain day range takes the year directly.
    const d = P.describePeriod(p);
    return /shift$/.test(d) ? `${d}, ${p.to.slice(0, 4)}` : `${d} ${p.to.slice(0, 4)}`;
  }
  return dayRange(p.from, p.to);
}

/* ------------------------------------------------------- product changes */

export interface ProductChange {
  station: number;
  stationName: string | null;
  materialId: number | null;
  productName: string | null;
  atUtc: string;
}

/**
 * Real product changes only: a station's `lastChange`, timed at the first cone of the new product,
 * newest first. A station with no lastChange contributes nothing (its run may be older than the
 * look-back). Changes after the period's end, or before its start when the start is an instant, are left out.
 */
export function productChanges(machines: readonly MachineRunning[], periodStartUtc: string | undefined, periodEndUtc: string): ProductChange[] {
  const out: ProductChange[] = [];
  for (const m of machines) {
    const c = m.lastChange;
    if (!c || !c.atUtc) continue;
    if (c.atUtc > periodEndUtc) continue;
    if (periodStartUtc && c.atUtc < periodStartUtc) continue;
    out.push({ station: m.station, stationName: m.stationName, materialId: m.materialId, productName: m.productName, atUtc: c.atUtc });
  }
  return out.sort((a, b) => (a.atUtc < b.atUtc ? 1 : a.atUtc > b.atUtc ? -1 : a.station - b.station));
}

/** The calendar day after `day` (YYYY-MM-DD). */
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * "20:56", or "20:56 on 28 Aug" when the change was not on the period's last production day. A production day's
 * night shift runs past midnight, so the day after `periodTo` still counts as inside it.
 */
export function changeTime(atUtc: string, periodTo: string, periodFrom: string = periodTo): string {
  const clock = formatClock(atUtc);
  const day = atUtc.slice(0, 10);
  // In a period of several days the clock alone does not say which day; name the date.
  const multiDay = periodFrom !== periodTo;
  return !multiDay && (day === periodTo || day === nextDay(periodTo)) ? clock : `${clock} on ${formatDate(atUtc).replace(/ \d{4}$/, '')}`;
}

/**
 * How long a station has been on its current product. `runStartIsLookbackLimit` means no change was
 * found in the look-back, so the run may be older: say "since at least", never a start time
 * (VERIFY-D2-D4 caution 3).
 */
export function runStartText(m: Pick<MachineRunning, 'runStartUtc' | 'runStartIsLookbackLimit'>): string | null {
  if (!m.runStartUtc) return null;
  const when = `${formatDate(m.runStartUtc)} ${formatClock(m.runStartUtc)}`;
  return m.runStartIsLookbackLimit ? TF.productChange.sinceAtLeast(when) : TF.productChange.since(when);
}

/* ------------------------------------------------------------- attention */

export function findingKind(f: AttentionFinding): string {
  return f.rejectKind === 'weight' ? T.attention.failedWeightKind : T.attention.failedInspectionKind;
}
