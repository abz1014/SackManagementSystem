/**
 * Pure helpers for Quality > Rejects and the reason sheet: nothing here fetches or renders.
 * Business rules (the rate, the vital few, the reason code string, the detectors) stay where
 * they live (api.ts rejectCodeParam, lib/pareto, the server); this file only shapes their output.
 */
import { pareto } from '../../../bridge/lib';
import type { RejectDayCodeRow, RejectGeneration, RejectReason, RejectSpcData } from '../../../bridge/api';
import { rejectCodeParam } from '../../../bridge/api';
import { writeRoute, type Route } from '../../../route';

/** How many reasons the Pareto, its list and the heat matrix show before "Show all". */
export const TOP_REASONS = 8;

/** Keys that survive a hop to another screen: the global period (nav.ts PERIOD_KEYS) and the shared filters. */
const PERIOD_KEYS = ['p', 'from', 'to', 'cmp', 'at'] as const;

export interface ReasonRow extends RejectReason {
  /** Share of cones that failed inspection, percent, within the inspection reasons shown. */
  share: number;
  /** Running share in the same order, percent. */
  runShare: number;
  /** The jc URL value. */
  code: string;
}

/**
 * Inspection reasons only (the weight-check failure arrives in the same payload as one row and is a
 * different verdict, GLOSSARY 1.3), in the server's order (count, descending), with shares recomputed
 * over that set so the Pareto and the vital-few cut describe one population.
 */
export function inspectionReasons(reasons: readonly RejectReason[]): ReasonRow[] {
  const rows = reasons.filter((r) => r.rejectType !== 'weight');
  const total = rows.reduce((s, r) => s + r.count, 0);
  let run = 0;
  return rows.map((r) => {
    run += r.count;
    return { ...r, code: rejectCodeParam(r), share: total > 0 ? (100 * r.count) / total : 0, runShare: total > 0 ? (100 * run) / total : 0 };
  });
}

export const inspectionTotal = (rows: readonly ReasonRow[]): number => rows.reduce((s, r) => s + r.count, 0);

/** Pareto input: the lib reads `cumulativePct`, so it is fed the recomputed running share. */
export function paretoRows(rows: readonly ReasonRow[], label: (r: ReasonRow) => string) {
  return rows.map((r) => ({ label: label(r), count: r.count, cumulativePct: r.runShare }));
}

/** "The k biggest reasons cover X %": k is the shown count, X the running share at k. */
export function coverage(rows: readonly ReasonRow[], k: number): { k: number; pct: number } | null {
  if (rows.length === 0) return null;
  const n = Math.min(k, rows.length);
  return { k: n, pct: rows[n - 1]!.runShare };
}

export function vitalCount(rows: readonly ReasonRow[]): number {
  return pareto.vitalFew(rows.map((r) => ({ cumulativePct: r.runShare })), 80);
}

/* ---------------------------------------------------------------- the figures */

const finiteOrNull = (n: number): number | null => (Number.isFinite(n) ? n : null);

/**
 * The ONE generation entry that q.totalProduced / q.totalRejects describe (the old screen's rule,
 * Rejects.tsx preferredGeneration): matching on both totals finds it without needing provenance.
 */
export function preferredGeneration(d: RejectSpcData | null): RejectGeneration | null {
  if (!d) return null;
  if (d.generations.length <= 1) return d.generations[0] ?? null;
  return d.generations.find((g) => g.totalProduced === d.totalProduced && g.totalRejects === d.totalRejects) ?? null;
}

export interface Figures {
  inspectionN: number;
  weightN: number;
  /** Cones checked: cones plus the rejects with no matching cone row (rejectSpc.ts totalInspected). */
  inspected: number;
  inspectionPct: number;
  weightPct: number;
  togetherPct: number;
}

/**
 * Both rates divide by the same `totalInspected` the server reports for the preferred generation, so
 * they agree with Today and Reports. Null until both series answered and every field survived.
 */
export function figures(q: RejectSpcData | null, w: RejectSpcData | null): Figures | null {
  if (!q || !w) return null;
  const inspected = finiteOrNull(preferredGeneration(q)?.totalInspected ?? NaN);
  const qn = finiteOrNull(q.totalRejects);
  const wn = finiteOrNull(w.totalRejects);
  if (inspected == null || inspected <= 0 || qn == null || wn == null) return null;
  return {
    inspectionN: qn,
    weightN: wn,
    inspected,
    inspectionPct: (100 * qn) / inspected,
    weightPct: (100 * wn) / inspected,
    togetherPct: (100 * (qn + wn)) / inspected,
  };
}

/* ------------------------------------------------------------------- the trend */

export interface RisingState {
  /** Start of the ongoing rise (an episode reaching the newest bucket), or null. */
  since: string | null;
  episodes: number;
  lastEnded: string | null;
}

export function risingState(d: RejectSpcData | null): RisingState | null {
  if (!d) return null;
  const last = d.buckets.length > 0 ? d.buckets[d.buckets.length - 1]!.bucketTs : null;
  const on = last ? d.episodes.find((e) => e.endTs === last) : undefined;
  const ended = d.episodes.map((e) => e.endTs).sort().slice(-1)[0] ?? null;
  return { since: on?.startTs ?? null, episodes: d.episodes.length, lastEnded: ended };
}

/** "Thu 9 Jul" from a bucket timestamp or a bare day. */
export const dayLabel = (ts: string): string =>
  new Date(ts.length === 10 ? `${ts}T12:00:00Z` : ts).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** A day bucket as percent of cones; null where the server gave no valid rate (a gap, never a zero). */
export const ratePct = (rate: number | null): number | null => (rate == null || !Number.isFinite(rate) ? null : 100 * rate);

/* ---------------------------------------------------------------- heat matrix */

export interface HeatCell {
  day: string;
  /** Percent of the day's cones; 0 when the reason did not occur that day. */
  pct: number;
  count: number;
}
export interface HeatRow {
  code: string;
  reason: ReasonRow;
  cells: HeatCell[];
  total: number;
}
export interface Heat {
  days: string[];
  rows: HeatRow[];
}

/**
 * Reasons x production days from the by-day-code rows. Reason order is the Pareto's (count, descending),
 * so the matrix and the list agree; a reason with no row on a day is a true zero (the by-day query lists
 * every code that occurred), a day with no rows at all is not a column.
 */
export function buildHeat(rows: readonly RejectDayCodeRow[], reasons: readonly ReasonRow[]): Heat {
  const inspection = rows.filter((r) => r.rejectType !== 'weight');
  const days = Array.from(new Set(inspection.map((r) => r.day))).sort();
  const byKey = new Map<string, RejectDayCodeRow>();
  for (const r of inspection) byKey.set(`${r.day}|${rejectCodeParam(r)}`, r);
  return {
    days,
    rows: reasons.map((reason) => {
      const cells = days.map((day) => {
        const hit = byKey.get(`${day}|${reason.code}`);
        return { day, pct: hit && hit.ratePct != null && Number.isFinite(hit.ratePct) ? hit.ratePct : 0, count: hit ? hit.count : 0 };
      });
      return { code: reason.code, reason, cells, total: cells.reduce((s, c) => s + c.count, 0) };
    }),
  };
}

/** Five steps of the sequential ramp; 0 is "none". The thresholds are printed in the legend. */
export const HEAT_STEPS = [0.5, 1, 2.5, 5] as const;
export function heatStep(pct: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!(pct > 0)) return 0;
  if (pct < HEAT_STEPS[0]) return 1;
  if (pct < HEAT_STEPS[1]) return 2;
  if (pct < HEAT_STEPS[2]) return 3;
  if (pct < HEAT_STEPS[3]) return 4;
  return 5;
}

/* ------------------------------------------------------------------ reason ids */

export interface ReasonId {
  day: string;
  rejectType: 'quality' | 'weight';
  tubeCode: number | null;
  materialCode: number | null;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The sheet's id as it travels in the URL: `<day>|<type>|<tube>|<material>`, a missing half as ''. Same shape the old app wrote. */
export function reasonIdOf(r: ReasonId): string {
  return `${r.day}|${r.rejectType}|${r.tubeCode ?? ''}|${r.materialCode ?? ''}`;
}

/** Null for anything malformed, so a hand-edited URL renders "couldn't load", not a crash. */
export function parseReasonId(raw: string): ReasonId | null {
  const parts = raw.split('|');
  if (parts.length !== 4) return null;
  const [day, type, tube, material] = parts as [string, string, string, string];
  if (!DATE_RE.test(day) || (type !== 'quality' && type !== 'weight')) return null;
  const half = (s: string): number | null | undefined => (s === '' ? null : /^\d{1,9}$/.test(s) ? Number(s) : undefined);
  const t = half(tube);
  const m = half(material);
  if (t === undefined || m === undefined) return null;
  return { day, rejectType: type, tubeCode: t, materialCode: m };
}

/* ------------------------------------------------------------------------ hops */

function carried(route: Route, extra: readonly string[] = []): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const k of [...PERIOD_KEYS, ...extra]) if (route.keys[k] !== undefined) keys[k] = route.keys[k]!;
  return keys;
}

/** "See the cones": the Register on cones that failed inspection (legacy rf = rl = inspectionRejects), period and filters carried. */
export function conesHop(route: Route): Route {
  return { s: 'quality', t: 'register', sheet: null, wall: false, keys: { ...carried(route, ['st', 'pr']), rf: 'inspectionRejects', rl: 'inspectionRejects' } };
}
/** "By station": the Stations tab, period and product carried. The station filter is not (it would hide the other stations). */
export function stationsHop(route: Route): Route {
  return { s: 'quality', t: 'stations', sheet: null, wall: false, keys: carried(route, ['pr']) };
}
/** Reason sheet: this production day in the Register. */
export function dayRegisterHop(day: string): Route {
  return { s: 'quality', t: 'register', sheet: null, wall: false, keys: { p: 'pick', from: day, to: day, rf: 'inspectionRejects', rl: 'inspectionRejects' } };
}
/** Reason sheet: this production day on the reject report. */
export function dayReportHop(day: string): Route {
  return { s: 'reports', t: null, sheet: null, wall: false, keys: { rt: 'reject', p: 'pick', from: day, to: day } };
}
export const hrefOf = (r: Route): string => `?${writeRoute(r).toString()}`;
