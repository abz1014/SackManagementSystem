/**
 * "Does anything need attention?" — the three sentences on the Line screen.
 *
 * This replaces the old Exceptions feed, which the scope review recommended
 * cutting: it synthesised control-chart violations into a page of its own, no
 * requirement asked for it, and the same panel also sat on the dashboard. What
 * survives is the part a GM actually needs on opening the app, restricted to
 * findings that each answer a line of IFL's requirement list.
 *
 * THREE SOURCES, AND NOTHING ELSE MAY BE ADDED HERE:
 *   1. a station the drift test has flagged          (requirement 5)
 *   2. a sustained rise in reject rate               (requirement 4)
 *   3. cones passed by the scale but outside limits  (requirement 2)
 *
 * There is deliberately no "quiet station" alert: no requirement mentions one,
 * and the dimmed box in the station row already says it. False alarms on the
 * GM's home screen cost more trust than the list earns.
 *
 * THE DETECTORS DO NOT USE THE SELECTED PERIOD. Rules 1 and 2 run on DAILY
 * means over a fixed trailing window, because the per-station pattern tests
 * need six to fifteen consecutive days and one shift is one point. Chained to
 * a "This shift" period they would report "nothing needs attention" about a
 * station that has read heavy all week — which is worse than saying nothing.
 * Rule 3 is a count, so it honours the period, and the screen says which is
 * which.
 *
 * AND "CONSECUTIVE" MEANS ON THE CALENDAR. The daily means list only days that
 * hold data, and the record has a permanent hole (10 Jul to 5 Aug 2026, when
 * IFL rebuilt their tables). Counting array neighbours as consecutive days
 * reported a station "heavy for 2 days" across 26 days of nothing; every run
 * here tests consecutiveProductionDays between adjacent entries instead.
 *
 * THE FINDINGS CARRY NUMBERS, NOT SENTENCES. Copy lives in the web app's
 * words file so an Urdu set can be added without touching the API.
 */
import type { ConnectionPool } from 'mssql';
import type { CalibrationData, DriftProjection } from './calibration.js';
import { adjustmentRestarts, getStationDrift, latestRestart, listCalibrationAdjustments, projectDaysToLimit } from './calibration.js';
import { getRejectSpc, type RejectSpcData, type RejectTypeFilter } from './rejectSpc.js';
import { getPlausibilityRule } from './admin.js';
import { loadProductTimeline, limitsOf, productDisagreement, type DayRange } from './productAt.js';
import { loadProductCatalogue, limitsFromVersion } from './productLimits.js';
import { consecutiveProductionDays } from './plantClock.js';

/** At most three sentences; the rest are counted and linked. */
export const MAX_SHOWN = 3;

/**
 * A station must hold its side of the line mean for at least this many days
 * before it is worth a sentence on the GM's home screen. Three separates a
 * genuine trend from two ordinary days in a row.
 */
export const MIN_DAYS_HELD = 3;

export type FindingKind = 'station_drift' | 'reject_rise' | 'outside_product_limits';

export interface AttentionFinding {
  kind: FindingKind;
  /** The IFL requirement line this finding serves. Shown in Details. */
  requirement: 2 | 4 | 5;
  /** Which screen explains it. */
  screen: 'weight' | 'rejects' | 'readings';
  /* station_drift */
  station?: number;
  /** Signed grams against the line mean over the trailing window. */
  deltaG?: number;
  /** Calendar-consecutive production days the station has held that side. */
  days?: number;
  /**
   * Where the run's straight line reaches the product's limit at its current
   * rate (roadmap Phase 9 item 6, 15 Sep 2026) — a projection from recent
   * readings under a stated linear assumption, only when limits were in
   * force. Null otherwise; the sentence then stops at the observation.
   */
  projection?: DriftProjection | null;
  /* reject_rise */
  rejectKind?: 'quality' | 'weight';
  sinceUtc?: string;
  ratePct?: number;
  usualPct?: number;
  /* outside_product_limits */
  count?: number;
}

export interface AttentionData {
  /** The fixed window rules 1 and 2 used. The screen states it. */
  window: { from: string; to: string; days: number };
  /** The selected period, which only rule 3 uses. */
  period: { from: string; to: string; shift: string | null };
  findings: AttentionFinding[];
  /** Before the cap, so the screen can say "and 2 more". */
  totalFindings: number;
  thresholds: { driftG: number; minDaysHeld: number };
}

/* ------------------------------------------------------------ rule 1 */

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Population standard deviation — used only to size a practical threshold. */
function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * How far from the line a station has to sit before it is worth acting on.
 *
 * A tenth of the product's own tolerance when one is recorded — a station
 * eating 10% of the allowed band is a real maintenance item. Otherwise three
 * tenths of the spread BETWEEN stations, which adapts to how tightly this line
 * actually runs. Without a threshold every station is "distinguishable" at six
 * hundred cones a day and the list would name all fourteen.
 */
export function driftThresholdG(stationMeans: number[], toleranceWidthG: number | null): number {
  const fromSpec = toleranceWidthG != null && toleranceWidthG > 0 ? 0.1 * toleranceWidthG : null;
  const fromSpread = 0.3 * stdev(stationMeans);
  const t = fromSpec ?? fromSpread;
  return Math.round(t * 100) / 100;
}

export interface DriftOptions {
  toleranceWidthG: number | null;
  /** Station id -> the moment it was last adjusted, on the PRODUCTION clock. */
  adjustedAtMsByStation: Map<number, number>;
  minDaysHeld?: number;
  /** The product's limits in force now, the edges the projection extends to; null = no projection. */
  limitsG?: { loG: number; hiG: number; targetG?: number | null } | null;
}

/**
 * Stations worth a sentence, worst first.
 *
 * A logged adjustment RESTARTS the station's history: days before it are
 * ignored, so an engineer who corrected a scale yesterday is not told for the
 * next fortnight that it has been drifting for a fortnight.
 */
export function stationDriftFindings(cal: CalibrationData, opts: DriftOptions): AttentionFinding[] {
  const stations = cal.stations.filter((s) => s.n > 0);
  if (stations.length === 0) return [];

  const totalN = stations.reduce((s, x) => s + x.n, 0);
  const lineMean = stations.reduce((s, x) => s + x.n * x.grandMean, 0) / totalN;
  const threshold = driftThresholdG(stations.map((s) => s.grandMean), opts.toleranceWidthG);
  const minDays = opts.minDaysHeld ?? MIN_DAYS_HELD;

  const out: AttentionFinding[] = [];
  for (const st of stations) {
    const adjustedAt = opts.adjustedAtMsByStation.get(st.station);
    // Only days at or after the last adjustment count toward the pattern.
    const days = adjustedAt == null
      ? st.days
      : st.days.filter((d) => new Date(`${d.date}T23:59:59Z`).getTime() >= adjustedAt);
    if (days.length === 0) continue;

    // THE RUN FIRST, THE OFFSET SECOND. The sentence this produces claims a
    // station "has read about N g heavier for D days", so N must be measured
    // over those D days. Averaging across the whole window instead lets two
    // old days on the other side cancel out a jump that started on Tuesday,
    // and the screen then understates exactly the change it is reporting.
    const last = days[days.length - 1]!;
    const side = sign(last.mean - lineMean);
    if (side === 0) continue;

    const run: typeof days = [];
    for (let i = days.length - 1; i >= 0; i--) {
      if (sign(days[i]!.mean - lineMean) !== side) break;
      // A hole in the calendar ends the run as surely as a change of side.
      if (i < days.length - 1 && !consecutiveProductionDays(days[i]!.date, days[i + 1]!.date)) break;
      run.unshift(days[i]!);
    }
    if (run.length < minDays) continue;

    const n = run.reduce((s, d) => s + d.n, 0);
    if (n === 0) continue;
    const mean = run.reduce((s, d) => s + d.n * d.mean, 0) / n;
    const deltaG = Math.round((mean - lineMean) * 100) / 100;
    if (Math.abs(deltaG) < threshold) continue;

    // The pattern test must have fired inside the run: a standing offset is
    // something to correct at leisure, and the home screen is for what
    // CHANGED.
    if (!run.some((d) => d.nelson.length > 0)) continue;

    out.push({
      kind: 'station_drift',
      requirement: 5,
      screen: 'weight',
      station: st.station,
      deltaG,
      days: run.length,
      // The same line the station table draws, over the same run.
      projection: projectDaysToLimit(run, opts.limitsG ?? null),
    });
  }

  return out.sort((a, b) => Math.abs(b.deltaG ?? 0) - Math.abs(a.deltaG ?? 0));
}

/* ------------------------------------------------------------ rule 2 */

/**
 * A sustained rise that is STILL GOING: an episode is only worth the GM's
 * attention if it reaches the most recent bucket. A burst that ended last
 * Tuesday is history, and history belongs on the Rejects screen.
 */
export function rejectRiseFinding(spc: RejectSpcData, kind: 'quality' | 'weight'): AttentionFinding | null {
  const buckets = spc.buckets;
  if (buckets.length === 0 || spc.pBar == null) return null;
  const lastTs = buckets[buckets.length - 1]!.bucketTs;

  const ongoing = spc.episodes.find((e) => e.endTs === lastTs);
  if (!ongoing) return null;

  // totalInspected, not totalProduced: this rate is printed in the same
  // sentence as usualPct (= pBar), so the two must divide by the same
  // population. Dividing by cones alone here made the Home screen state a
  // rise and its own baseline on different denominators.
  const rate = ongoing.totalInspected > 0 ? (100 * ongoing.totalRejects) / ongoing.totalInspected : null;
  if (rate == null) return null;

  return {
    kind: 'reject_rise',
    requirement: 4,
    screen: 'rejects',
    rejectKind: kind,
    sinceUtc: ongoing.startTs,
    ratePct: Math.round(rate * 10) / 10,
    usualPct: Math.round(spc.pBar * 1000) / 10,
  };
}

/* ---------------------------------------------------------- the endpoint */

export async function getAttention(
  pool: ConnectionPool,
  lineId: number,
  trailing: { from: string; to: string },
  period: DayRange,
): Promise<AttentionData> {
  const [plausibility, timeline, adjustments, catalogue] = await Promise.all([
    getPlausibilityRule(pool, lineId),
    loadProductTimeline(pool, lineId),
    listCalibrationAdjustments(pool, lineId),
    loadProductCatalogue(pool),
  ]);

  // The tolerance in force now sizes the drift threshold. Using the current
  // product here is right: the threshold is "how much of the allowed band is
  // worth acting on", a property of the product being made, not of a reading.
  // "Now" means the NEWEST recorded version of that product's limits — the
  // versioned history, not the mirror, so this and the per-reading verdicts
  // read from one source (productLimits.ts).
  const cur = timeline.entries[0] ?? null;
  const limits = cur ? (limitsFromVersion(catalogue.latest(cur.productId)) ?? limitsOf(cur)) : null;
  const toleranceWidthG = limits ? limits.hiG - limits.loG : null;

  // Every logged adjustment (a station's own and the line-wide ones) restarts
  // that station's run, centreline and sigma — calibration.ts, Phase 9.
  const restarts = adjustmentRestarts(adjustments);

  const [cal, quality, weight, disagreement] = await Promise.all([
    getStationDrift(pool, lineId, trailing.from, trailing.to, plausibility, { restarts }),
    getRejectSpc(pool, lineId, trailing.from, trailing.to, 'day', 'quality' as RejectTypeFilter),
    getRejectSpc(pool, lineId, trailing.from, trailing.to, 'day', 'weight' as RejectTypeFilter),
    productDisagreement(pool, lineId, timeline, period, catalogue),
  ]);

  // The newest restart per station in the window's roster (a line-wide
  // adjustment counts for every station), for the run count.
  const adjustedAtMsByStation = new Map<number, number>();
  for (const st of cal.stations) {
    const ms = latestRestart(restarts, st.station);
    if (ms != null) adjustedAtMsByStation.set(st.station, ms);
  }

  const stationMeans = cal.stations.filter((s) => s.n > 0).map((s) => s.grandMean);
  const findings: AttentionFinding[] = [
    ...stationDriftFindings(cal, {
      toleranceWidthG,
      adjustedAtMsByStation,
      limitsG: limits ? { loG: limits.loG, hiG: limits.hiG, targetG: limits.targetG } : null,
    }),
  ];

  const rises = [rejectRiseFinding(quality, 'quality'), rejectRiseFinding(weight, 'weight')].filter(
    (f): f is AttentionFinding => f != null,
  );
  findings.push(...rises);

  if (disagreement.passedButOutside > 0) {
    findings.push({
      kind: 'outside_product_limits',
      requirement: 2,
      screen: 'readings',
      count: disagreement.passedButOutside,
    });
  }

  return {
    window: { from: trailing.from, to: trailing.to, days: cal.days },
    period: { from: period.from, to: period.to, shift: period.shift ?? null },
    findings: findings.slice(0, MAX_SHOWN),
    totalFindings: findings.length,
    thresholds: {
      driftG: driftThresholdG(stationMeans, toleranceWidthG),
      minDaysHeld: MIN_DAYS_HELD,
    },
  };
}
