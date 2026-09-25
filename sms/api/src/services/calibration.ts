/**
 * Calibration advisory (Phase 5 — roadmap table). Two questions the existing
 * Weight screen cannot answer:
 *
 *  1. Is any ONE station's scale drifting, even while the line-wide mean
 *     looks fine? spc.ts's per-station analysis (StationStat) gives a single
 *     mean over the whole selected range — it can tell you a station runs
 *     light, but not whether that offset has been GROWING. A scale creeping
 *     out of calibration shows up as a trend day-over-day, which a one-number
 *     summary erases by averaging it away.
 *  2. Has anyone actually recalibrated a station, and when? Nothing recorded
 *     that before — sms.calibration_adjustment (below) is the ledger.
 *
 * Cone-only: sacks carry no station column, same restriction as spc.ts's
 * per-station analysis.
 *
 * Deliberately reuses spc.ts's plausibility guard and nelson.ts's engine
 * rather than reimplementing either — this is the same statistics applied at
 * a different grain (per station, per day), not a different method.
 *
 * THE CENTRELINE AND THE I-MR SIGMA RESTART AT A LOGGED ADJUSTMENT (roadmap
 * Phase 9 item 3, 15 Sep 2026). Until then only the RUN COUNT restarted
 * (attention.ts / weightStations.ts dropped the days before the adjustment),
 * while the centreline the Nelson zones were measured from was still the
 * whole-window mean and the sigma still included the pre-adjustment moving
 * ranges. So a station adjusted by 9 g on Tuesday was, on Wednesday, judged
 * against a centreline that was mostly last week's scale — and the day after
 * an adjustment nearly always "fired", which is exactly the false flag the
 * restart exists to prevent. Now each station's days are cut into EPOCHS at
 * every logged adjustment inside the window; each epoch has its own
 * centreline (its volume-weighted mean) and its own I-MR sigma, and a run can
 * never cross an epoch boundary. Calendar gaps still split runs (the engine
 * needs consecutive days) but do not restart the centreline: a hole in the
 * record is the same scale with missing days, an adjustment is a different
 * scale. `grandMean` stays the whole-window mean because the station table's
 * "Average" column describes the window; `centrelineG` is what the zones were
 * measured from in the newest epoch.
 *
 * THE MEDIAN (Phase 9 item 1) is computed here per station under the ONE
 * population rule (coneState.ts plausibleWhere), so the station table and
 * /api/calibration report it beside the mean from the same population.
 *
 * THE PROJECTION (Phase 9 item 6) is `projectDaysToLimit` below: a straight
 * line through the flagged run's daily means, extended to the product's
 * limit. It is a projection from recent readings under a stated assumption —
 * linear, at the rate of the last D days — and nothing more; the words on
 * screen say so. It is not a prediction and there is no model behind it.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { PlausibilityRule } from './admin.js';
import { nelsonViolations, nelsonRuleTable, type NelsonRuleId, type NelsonRuleInfo } from './nelson.js';
import { consecutiveProductionDays, plantOffsetMinutes, toPlantIso, toPlantMs } from './plantClock.js';
import { plausibleWhere } from './coneState.js';
import { epochFragment, noteOf, resolveGenerationScope, type GenerationNote } from './generation.js';

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** I-MR sigma for a sequence of individual points: mean moving range / d2.
 *  d2 = 1.128 is the standard constant for a 2-point moving range (Montgomery,
 *  Introduction to Statistical Quality Control). 0 with fewer than 2 points —
 *  there is no "day to day" to measure yet. */
export function individualsSigma(values: number[]): number {
  if (values.length < 2) return 0;
  let sumMr = 0;
  for (let i = 1; i < values.length; i++) sumMr += Math.abs(values[i]! - values[i - 1]!);
  const mrBar = sumMr / (values.length - 1);
  return mrBar / 1.128;
}

export interface StationDriftDay {
  date: string; // YYYY-MM-DD (shift_date)
  n: number;
  mean: number;
  nelson: NelsonRuleId[];
}

export interface StationDrift {
  station: number;
  n: number;
  grandMean: number;
  /** Median of the station's plausible cone weights over the window — same population as grandMean. */
  medianG: number | null;
  /** Informational only — the within-DAY spread of individual cone weights.
   *  NOT what the Nelson zones are measured against; see sigmaDayToDay. */
  stdevWithin: number;
  /** The I-MR sigma actually used for Nelson zone widths in the NEWEST epoch —
   *  how much this station's daily mean normally moves day to day. */
  sigmaDayToDay: number;
  /** The centreline the Nelson zones were measured from in the newest epoch:
   *  the whole-window mean when no adjustment falls inside the window, else
   *  the mean of the days since the last one. */
  centrelineG: number;
  /** Production day of the newest logged adjustment inside the window, or
   *  null. Days before it belong to a different scale. */
  restartedOn: string | null;
  /** Longest calendar-contiguous run of days in the newest epoch — the
   *  series length the pattern rules actually had to work with. */
  longestRun: number;
  days: StationDriftDay[];
  /** Any day in range triggered a Nelson rule — the actionable subset, same
   *  distinction spc.ts draws between "distinguishable" and "flagged". */
  flagged: boolean;
}

export interface CalibrationData {
  unit: 'g';
  from: string;
  to: string;
  days: number; // distinct production days in range — the practical ceiling on which Nelson rules can ever fire (see nelson.ts)
  stations: StationDrift[];
  flaggedStationCount: number;
  /** Every pattern rule with its label and the run length it needs, so a
   *  screen can name a flag and say which rules this series could never
   *  complete. */
  rules: NelsonRuleInfo[];
  /** Which source generation the drift series was fitted over, and what was left out. */
  generationNote?: GenerationNote;
}

export interface StationDriftOptions {
  /**
   * The instants (PRODUCTION clock, ms) at which scales were adjusted, per
   * station and line-wide. Each one inside the window starts a new epoch for
   * that station. Build it with adjustmentRestarts() from the ledger; omit
   * for the raw series.
   */
  restarts?: Restarts;
}

/** End-of-day instant of a production day on the production clock, for comparing against a restart. */
const endOfDayMs = (date: string) => new Date(`${date}T23:59:59.999Z`).getTime();

/**
 * Cut a station's days into epochs at each restart instant. A day belongs to
 * the epoch that begins at the newest restart at or before the END of that
 * day — the same rule attention.ts and weightStations.ts have used to drop
 * pre-adjustment days, so the three agree on which day the new scale starts.
 */
export function splitEpochs<T extends { date: string }>(days: T[], restartsMs: number[]): T[][] {
  const sorted = [...restartsMs].sort((a, b) => a - b);
  const epochs: T[][] = [];
  let cur: T[] = [];
  let next = 0;
  for (const d of days) {
    const end = endOfDayMs(d.date);
    let crossed = false;
    while (next < sorted.length && sorted[next]! <= end) {
      next++;
      crossed = true;
    }
    if (crossed && cur.length > 0) {
      epochs.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length > 0) epochs.push(cur);
  return epochs;
}

/** The longest calendar-contiguous run within an ordered list of days. */
export function longestContiguousRun(days: { date: string }[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && consecutiveProductionDays(days[i - 1]!.date, days[i]!.date) ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export async function getStationDrift(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  plausibility: PlausibilityRule,
  opts: StationDriftOptions = {},
): Promise<CalibrationData> {
  // SOURCE GENERATIONS (generation.ts, 23 Sep 2026). Station drift is a model
  // of one station's mean moving day by day. Two generations of the same
  // source table interleaved in time give that station two daily means per
  // day, silently averaged into one — and on this development sidecar one of
  // them is the plant simulator, whose station bias is synthetic. A drift
  // slope fitted across a generation boundary is not a measurement of
  // anything physical.
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event']);
  const gen0 = epochFragment(scope, 'cone_event');
  const genAnd = gen0.sql ? ' AND ' + gen0.sql : '';
  const bindGen = (rq: mssql.Request) => {
    for (const q of gen0.params) rq.input(q.name, mssql.Int, q.id);
    return rq;
  };
  const r = await bindGen(pool.request())
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .input('plausLo', mssql.Float, plausibility.coneLoG)
    .input('plausHi', mssql.Float, plausibility.coneHiG)
    .query<{ st: number; d: Date; n: number; mean: number; sd: number | null }>(
      `SELECT source_station st, shift_date d, COUNT(*) n,
              AVG(CAST(weight_g AS float)) mean, STDEV(CAST(weight_g AS float)) sd
       FROM sms.cone_event
       WHERE line_id=@line AND shift_date BETWEEN @from AND @to${genAnd}
         AND weight_g IS NOT NULL AND weight_g BETWEEN @plausLo AND @plausHi
         AND source_station IS NOT NULL
       GROUP BY source_station, shift_date
       ORDER BY source_station, shift_date`,
    );

  // The per-station median over the window, from the SAME population as the
  // mean above (the one plausibility predicate, coneState.ts). PERCENTILE_CONT
  // is a window function, so one row per station is kept with DISTINCT.
  const medReq = bindGen(pool.request())
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  const medWhere = plausibleWhere(medReq, 'weight_g', { loG: plausibility.coneLoG, hiG: plausibility.coneHiG });
  const med = await medReq.query<{ st: number; med: number | null }>(
    `SELECT DISTINCT source_station st,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(weight_g AS float)) OVER (PARTITION BY source_station) med
     FROM sms.cone_event
     WHERE line_id=@line AND shift_date BETWEEN @from AND @to${genAnd}
       AND weight_g IS NOT NULL AND ${medWhere}
       AND source_station IS NOT NULL`,
  );
  const medianByStation = new Map<number, number | null>();
  for (const row of med.recordset ?? []) medianByStation.set(Number(row.st), row.med == null ? null : Number(row.med));

  const byStation = new Map<number, { d: Date; n: number; mean: number; sd: number | null }[]>();
  for (const row of r.recordset) {
    const list = byStation.get(row.st) ?? [];
    list.push(row);
    byStation.set(row.st, list);
  }

  const daySet = new Set(r.recordset.map((row) => new Date(row.d).toISOString().slice(0, 10)));
  const dateOf = (x: { d: Date | string }) => new Date(x.d).toISOString().slice(0, 10);

  const stations: StationDrift[] = [...byStation.entries()]
    .sort(([a], [b]) => a - b)
    .map(([station, rows]) => {
      const totalN = rows.reduce((s, x) => s + x.n, 0);
      const grandMean = totalN > 0 ? rows.reduce((s, x) => s + x.n * x.mean, 0) / totalN : 0;
      let pooledNum = 0;
      let pooledDen = 0;
      for (const x of rows) {
        if (x.sd != null && x.n > 1) {
          pooledNum += (x.n - 1) * x.sd * x.sd;
          pooledDen += x.n - 1;
        }
      }
      const stdevWithin = pooledDen > 0 ? Math.sqrt(pooledNum / pooledDen) : 0;

      // Nelson zones need the sigma of a DAY'S MEAN moving day to day, not
      // stdevWithin/√n — that sampling-error estimate shrinks toward zero as
      // more cones are weighed in a day and would flag ordinary day-to-day
      // wobble as an extreme pattern. Verified on real data: with ~650
      // cones/station/day the naive SE was ~0.28g against real day-to-day
      // swings of 1-8g, flagging all 14 of 14 stations — an obviously wrong
      // "everything is drifting" result. The correct sigma for a sequence of
      // individual points (here: one mean per day) is the classic I-MR
      // estimator — average moving range / d2 (1.128 for a 2-point range).
      //
      // Both the centreline and that sigma are per EPOCH (see the header):
      // a logged adjustment inside the window starts a new one.
      const dated = rows.map((x) => ({ date: dateOf(x), n: x.n, mean: x.mean }));
      const epochs = splitEpochs(dated, restartsFor(opts.restarts, station));

      const nelson: NelsonRuleId[][] = [];
      let centrelineG = grandMean;
      let sigmaDayToDay = 0;
      for (const epoch of epochs) {
        const epochN = epoch.reduce((s, x) => s + x.n, 0);
        const centre = epochN > 0 ? epoch.reduce((s, x) => s + x.n * x.mean, 0) / epochN : grandMean;
        const sigma = individualsSigma(epoch.map((x) => x.mean));
        centrelineG = centre;
        sigmaDayToDay = sigma;

        // Nelson's "N in a row" rules (2: nine on one side, 3: six trending)
        // assume consecutive DAYS. `epoch` holds only days with readings, so
        // array neighbours are not calendar neighbours — and the record has a
        // hole (10 Jul → 5 Aug 2026, IFL's table rebuild) across which two
        // entries would otherwise read as one continuous run. The rows are
        // split into calendar-contiguous segments and each is evaluated
        // alone, so no run can straddle a gap. The engine itself stays
        // date-blind.
        const points = epoch.map((x) => ({ value: x.mean, se: sigma }));
        let segStart = 0;
        for (let k = 1; k <= epoch.length; k++) {
          const boundary = k === epoch.length || !consecutiveProductionDays(epoch[k - 1]!.date, epoch[k]!.date);
          if (boundary) {
            nelson.push(...nelsonViolations(points.slice(segStart, k), centre));
            segStart = k;
          }
        }
      }

      const newest = epochs[epochs.length - 1] ?? [];
      const restartedOn =
        epochs.length > 1 && newest.length > 0 ? newest[0]!.date : null;

      const days: StationDriftDay[] = dated.map((x, i) => ({
        date: x.date,
        n: x.n,
        mean: round(x.mean, 2),
        nelson: nelson[i]!,
      }));

      return {
        station,
        n: totalN,
        grandMean: round(grandMean, 2),
        medianG: medianByStation.has(station) ? (medianByStation.get(station) == null ? null : round(medianByStation.get(station)!, 2)) : null,
        stdevWithin: round(stdevWithin, 3),
        sigmaDayToDay: round(sigmaDayToDay, 3),
        centrelineG: round(centrelineG, 2),
        restartedOn,
        longestRun: longestContiguousRun(newest),
        days,
        flagged: days.some((d) => d.nelson.length > 0),
      };
    });

  return {
    unit: 'g',
    from,
    to,
    days: daySet.size,
    stations,
    flaggedStationCount: stations.filter((s) => s.flagged).length,
    rules: nelsonRuleTable(),
    generationNote: noteOf(scope),
  };
}

/* ------------------------------------------------------------ projection */

/**
 * RT-020 (25 Sep 2026): the projection used to print a precise day count from
 * 3-5 noisy daily means with no uncertainty stated at all — "168 days to the
 * lower limit" reads as a fact when it is a point estimate from a handful of
 * points. This adds the OLS slope's standard error and a 90% confidence
 * interval on the slope (t-distribution, n-2 degrees of freedom), converts
 * that into a RANGE of days-to-limit, and refuses a projection outright
 * (`status: 'not_established'`, `daysToLimit: null`) when the interval
 * includes zero or disagrees in sign with the point slope — i.e. the data
 * cannot rule out "no real trend" or "the wrong direction" at 90% confidence.
 *
 * MINIMUM 5 DAILY POINTS for any projection at all (raised from 2): an OLS
 * line through 2-4 points has 0-2 residual degrees of freedom, and Student's
 * t blows the interval up so wide the range is not worth printing — the
 * finding this projects from typically needs 5+ days to have fired in the
 * first place under the day-to-day I-MR sigma this module already uses, so
 * this is not a stricter gate than the rest of the module already implies.
 */
const T_TABLE_90: Record<number, number> = {
  1: 6.314, 2: 2.92, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.86,
  9: 1.833, 10: 1.812, 11: 1.796, 12: 1.782, 13: 1.771, 14: 1.761, 15: 1.753,
  16: 1.746, 17: 1.74, 18: 1.734, 19: 1.729, 20: 1.725, 21: 1.721, 22: 1.717,
  23: 1.714, 24: 1.711, 25: 1.708, 26: 1.706, 27: 1.703, 28: 1.701, 29: 1.699,
  30: 1.697,
};
/** Normal-approximation critical value for the 90% two-sided interval (z), used above df=30. */
const Z_90 = 1.645;

/** Student's t critical value for a 90% two-sided interval at `df` degrees of
 *  freedom: the hard-coded table for df 1..30, the normal approximation
 *  above it (t converges to z as df→∞; the two agree to 3 d.p. by df≈100). */
export function tCritical90(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T_TABLE_90[df]!;
  return Z_90;
}

export interface OlsSlopeStats {
  slope: number;
  /** Standard error of the slope estimate. NaN when df < 1 (fewer than 3 points). */
  se: number;
  df: number;
  /** 90% confidence interval on the slope. */
  ciLow: number;
  ciHigh: number;
}

/** OLS slope with its standard error and a 90% CI (t, n-2 df). Same x/y
 *  convention as slopePerDay: x is whole calendar days from the first point. */
export function olsSlopeStats(points: { date: string; mean: number }[]): OlsSlopeStats | null {
  const n = points.length;
  if (n < 3) return null; // need df >= 1 to say anything about uncertainty
  const x0 = new Date(`${points[0]!.date}T12:00:00Z`).getTime();
  const xs = points.map((p) => Math.round((new Date(`${p.date}T12:00:00Z`).getTime() - x0) / 86_400_000));
  const ys = points.map((p) => p.mean);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  if (sxx === 0) return null; // every point on the same day — no x variation to fit against
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const yhat = my + slope * (xs[i]! - mx);
    sse += (ys[i]! - yhat) ** 2;
  }
  const df = n - 2;
  const mse = sse / df;
  const se = Math.sqrt(mse / sxx);
  const t = tCritical90(df);
  return { slope, se, df, ciLow: slope - t * se, ciHigh: slope + t * se };
}

/** Minimum daily points for any projection (RT-020). */
export const MIN_PROJECTION_POINTS = 5;

export interface DriftProjection {
  /** Signed grams per day, a least-squares line through the run's daily means. */
  slopeGPerDay: number;
  /** The days the slope was fitted over — the run the finding names. */
  overDays: number;
  /** Which limit the line is heading for. */
  towards: 'upper' | 'lower';
  /** That limit, in grams (the product's tolerance edge). */
  limitG: number;
  /** The product's target, so a sentence can state the limit as "+40 g from target". */
  targetG: number | null;
  /** Signed grams from the run's last daily mean to that limit; 0 or past when already beyond. */
  distanceG: number;
  /**
   * Days from the run's last day until the line reaches the limit at this
   * rate; 0 when the last mean is already beyond it. Null when the line is
   * heading back TOWARD the target (the offset from the target and the slope
   * have opposite signs): extending it through the target to the far limit
   * would be arithmetic, not a projection anyone should act on. A station
   * that is under the target and falling IS projected (station 3, 19-20 Aug
   * 2026 on the real data: 9 g heavier than the line, 1 g under the target,
   * -0.23 g/day, 168 days to the lower limit — which the screen prints as
   * "not within 90 days"). Also null when `status` is 'not_established'.
   */
  daysToLimit: number | null;
  /** RT-020: the days-to-limit computed from the slope's 90% CI bounds
   *  instead of the point slope — the faster/slower ends of the range. Null
   *  under the same conditions as daysToLimit, or when there are too few
   *  points to compute a CI at all (n < 5, though MIN_PROJECTION_POINTS
   *  already enforces that for the whole projection). */
  daysLow: number | null;
  daysHigh: number | null;
  /** The confidence level the interval and daysLow/daysHigh were built at. */
  confidence: 0.9;
  /** How many daily points the slope (and its CI) were fitted over. */
  nPoints: number;
  /**
   * 'established': the 90% CI excludes zero and agrees in sign with the
   * point slope — the range is worth printing. 'not_established': the CI
   * includes zero, or disagrees in sign with the point slope (which can
   * happen right at the boundary of a wide interval) — daysToLimit/daysLow/
   * daysHigh are null and `reason` says why.
   */
  status: 'established' | 'not_established';
  reason?: string;
  /** The assumption, restated as data so a screen cannot omit it. */
  assumption: 'linear_over_run';
}

/** Ordinary least-squares slope of `values` against calendar-day positions. */
export function slopePerDay(points: { date: string; mean: number }[]): number {
  if (points.length < 2) return 0;
  const x0 = new Date(`${points[0]!.date}T12:00:00Z`).getTime();
  const xs = points.map((p) => Math.round((new Date(`${p.date}T12:00:00Z`).getTime() - x0) / 86_400_000));
  const ys = points.map((p) => p.mean);
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Where the run's line reaches the product's limit if it keeps its rate.
 *
 * Fitted over the run only (the consecutive days the finding names), because
 * that is the change being reported; the assumption is linear continuation at
 * that rate, which is stated in the words beside the figure. Null when there
 * are fewer than two days, the slope is zero (nothing to extend), or no
 * limit lies in the direction of travel.
 */
export function projectDaysToLimit(
  run: { date: string; mean: number }[],
  limits: { loG: number; hiG: number; targetG?: number | null } | null,
  minDays = MIN_PROJECTION_POINTS,
): DriftProjection | null {
  if (!limits || run.length < minDays) return null;
  const slope = slopePerDay(run);
  if (slope === 0 || !Number.isFinite(slope)) return null;
  const last = run[run.length - 1]!.mean;
  const towards: 'upper' | 'lower' = slope > 0 ? 'upper' : 'lower';
  const limitG = towards === 'upper' ? limits.hiG : limits.loG;
  const distanceG = limitG - last;
  // Already past the limit in the direction of travel: the answer is "now".
  const beyond = towards === 'upper' ? last >= limitG : last <= limitG;
  // Heading back toward the target: no days-to-limit (see the field's note).
  const centre = limits.targetG ?? (limits.loG + limits.hiG) / 2;
  const offset = last - centre;
  const returning = offset !== 0 && Math.sign(offset) !== Math.sign(slope);
  const daysToLimit = beyond ? 0 : returning ? null : Math.max(0, Math.round(distanceG / slope));

  // RT-020: the slope's own uncertainty. `stats` is null only when there are
  // fewer than 3 points (df < 1) — cannot happen here given MIN_PROJECTION_POINTS
  // gates the caller at 5, but kept defensive since minDays is a parameter.
  const stats = olsSlopeStats(run);
  let daysLow: number | null = null;
  let daysHigh: number | null = null;
  let status: 'established' | 'not_established' = 'not_established';
  let reason: string | undefined;
  if (!stats) {
    reason = `Only ${run.length} daily points — too few to estimate the slope's uncertainty.`;
  } else if (beyond) {
    // Already past the limit: "now" needs no interval around it.
    status = 'established';
    daysLow = 0;
    daysHigh = 0;
  } else if (stats.ciLow <= 0 && stats.ciHigh >= 0) {
    reason = `The 90% confidence interval on the drift rate (${round(stats.ciLow, 2)} to ${round(stats.ciHigh, 2)} g/day) includes zero — a real trend is not established from ${run.length} days.`;
  } else if (Math.sign(stats.ciLow) !== Math.sign(stats.ciHigh)) {
    // Cannot happen given the branch above, kept for clarity/defensiveness.
    reason = `The 90% confidence interval on the drift rate spans zero — a real trend is not established from ${run.length} days.`;
  } else if (returning) {
    // A confidently-signed slope heading back toward the target: established
    // as a rate, but there is still no forward days-to-limit to give (see
    // daysToLimit's own note) — the range fields stay null, not the status.
    status = 'established';
  } else {
    // The bound of the CI CLOSER to zero (shallower slope) gives the LONGER
    // days-to-limit; the bound FARTHER from zero (steeper) gives the shorter.
    const slopeNearer = Math.abs(stats.ciLow) < Math.abs(stats.ciHigh) ? stats.ciLow : stats.ciHigh;
    const slopeFarther = Math.abs(stats.ciLow) < Math.abs(stats.ciHigh) ? stats.ciHigh : stats.ciLow;
    const dNearer = Math.max(0, Math.round(distanceG / slopeNearer));
    const dFarther = Math.max(0, Math.round(distanceG / slopeFarther));
    daysLow = Math.min(dNearer, dFarther);
    daysHigh = Math.max(dNearer, dFarther);
    status = 'established';
  }

  return {
    slopeGPerDay: round(slope, 2),
    overDays: run.length,
    towards,
    limitG,
    targetG: limits.targetG ?? null,
    distanceG: round(distanceG, 2),
    daysToLimit: status === 'established' ? daysToLimit : null,
    daysLow,
    daysHigh,
    confidence: 0.9,
    nPoints: run.length,
    status,
    ...(reason ? { reason } : {}),
    assumption: 'linear_over_run',
  };
}

// ---- adjustment ledger ----

export interface CalibrationAdjustment {
  adjustmentId: number;
  stationId: number | null;
  /** Genuine UTC — an app-written instant (plantClock.ts, clock 2). */
  adjustedAtUtc: string;
  /** The same instant on the production-time convention (clock 1), for
   *  comparing with shift_date and for printing a plant time. */
  adjustedAtPlant: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  reason: string | null;
  note: string | null;
  /** Signed grams the scale was moved by (finding M9): positive = now reads
   *  heavier, negative = lighter. Null when not recorded. */
  amountG: number | null;
  /** Reference readings around the adjustment (roadmap Phase 9 item 5,
   *  migration 034): what the scale read for the reference weight before and
   *  after, and the reference weight itself. All optional. */
  beforeG: number | null;
  afterG: number | null;
  referenceG: number | null;
  /** The product (PDAS MaterialId) in force on the station at the time, as
   *  recorded by the person logging it — auto-filled from the machine's
   *  newest cones, never inferred afterwards. */
  productId: number | null;
  productLabel: string | null;
}

export interface AdjustmentFilter {
  /** Production days (YYYY-MM-DD), compared on the PLANT clock. */
  from?: string;
  to?: string;
  /** One station's rows PLUS the line-wide rows (station NULL), which apply to every station. */
  station?: number | null;
  limit?: number;
}

export interface AdjustmentList {
  adjustments: CalibrationAdjustment[];
  /** The offset the plant-time fields above were converted with — the one
   *  the web must use, never the browser's. */
  plantOffsetMinutes: number;
  from: string | null;
  to: string | null;
  station: number | null;
}

export async function listCalibrationAdjustments(
  pool: ConnectionPool,
  lineId: number,
  filter: AdjustmentFilter = {},
): Promise<CalibrationAdjustment[]> {
  const limit = filter.limit ?? 500;
  const req = pool.request().input('line', mssql.Int, lineId).input('n', mssql.Int, limit);
  const where: string[] = ['a.line_id=@line'];
  // `from`/`to` are production days; adjusted_at_utc is genuine UTC. The
  // comparison happens on the plant clock (the two clocks, CLAUDE.md): the
  // offset is bound as a parameter and applied in SQL so the day boundary is
  // the plant's midnight, not Greenwich's.
  if (filter.from || filter.to) req.input('offset', mssql.Int, plantOffsetMinutes());
  if (filter.from) {
    req.input('from', mssql.Date, filter.from);
    where.push('DATEADD(minute, @offset, a.adjusted_at_utc) >= CAST(@from AS datetime2)');
  }
  if (filter.to) {
    req.input('to', mssql.Date, filter.to);
    where.push('DATEADD(minute, @offset, a.adjusted_at_utc) < DATEADD(day, 1, CAST(@to AS datetime2))');
  }
  if (filter.station != null) {
    req.input('station', mssql.Int, filter.station);
    where.push('(a.station_id = @station OR a.station_id IS NULL)');
  }
  const r = await req.query<{
    adjustment_id: number; station_id: number | null; adjusted_at_utc: Date; recorded_at_utc: Date;
    recorded_by: string | null; reason: string | null; note: string | null; amount_g: number | null;
    before_g: number | null; after_g: number | null; reference_g: number | null; product_id: number | null;
    product_descr: string | null; product_lot: string | null;
  }>(
    `SELECT TOP (@n) a.adjustment_id, a.station_id, a.adjusted_at_utc, a.recorded_at_utc,
            u.display_name AS recorded_by, a.reason, a.note, a.amount_g,
            a.before_g, a.after_g, a.reference_g, a.product_id,
            p.description AS product_descr, p.lot_code AS product_lot
     FROM sms.calibration_adjustment a
     LEFT JOIN sms.app_user u ON u.user_id = a.recorded_by
     LEFT JOIN sms.product p ON p.product_id = a.product_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.adjusted_at_utc DESC, a.adjustment_id DESC`,
  );
  const num = (v: unknown) => (v == null ? null : Number(v));
  return r.recordset.map((x) => ({
    adjustmentId: x.adjustment_id,
    stationId: x.station_id,
    adjustedAtUtc: new Date(x.adjusted_at_utc).toISOString(),
    adjustedAtPlant: toPlantIso(x.adjusted_at_utc),
    recordedAtUtc: new Date(x.recorded_at_utc).toISOString(),
    recordedBy: x.recorded_by,
    reason: x.reason,
    note: x.note,
    amountG: num(x.amount_g),
    beforeG: num(x.before_g),
    afterG: num(x.after_g),
    referenceG: num(x.reference_g),
    productId: num(x.product_id),
    productLabel: x.product_id == null ? null : (x.product_descr || x.product_lot || `product ${x.product_id}`),
  }));
}

/**
 * Every adjustment instant on the PRODUCTION clock: per station, and the
 * line-wide rows (station NULL), which restart every station's scale.
 */
export interface Restarts {
  byStation: Map<number, number[]>;
  lineWide: number[];
}

export function adjustmentRestarts(adjustments: CalibrationAdjustment[]): Restarts {
  const byStation = new Map<number, number[]>();
  const lineWide: number[] = [];
  for (const a of adjustments) {
    // The ledger stores genuine UTC; the daily means are production days.
    const ms = toPlantMs(a.adjustedAtUtc);
    if (a.stationId == null) lineWide.push(ms);
    else byStation.set(a.stationId, [...(byStation.get(a.stationId) ?? []), ms]);
  }
  return { byStation, lineWide };
}

/** The restarts for one station, oldest first: its own plus the line-wide ones. */
export function restartsFor(r: Restarts | undefined, station: number): number[] {
  if (!r) return [];
  return [...(r.byStation.get(station) ?? []), ...r.lineWide].sort((a, b) => a - b);
}

/** The newest restart for one station, or null â€” what "days since the last adjustment" is measured from. */
export function latestRestart(r: Restarts | undefined, station: number): number | null {
  const all = restartsFor(r, station);
  return all.length ? all[all.length - 1]! : null;
}

export interface AdjustmentInput {
  stationId: number | null;
  adjustedAtUtc: Date;
  recordedBy: number;
  reason: string | null;
  note: string | null;
  amountG: number | null;
  beforeG?: number | null;
  afterG?: number | null;
  referenceG?: number | null;
  productId?: number | null;
}

export async function recordCalibrationAdjustment(
  pool: ConnectionPool,
  lineId: number,
  a: AdjustmentInput,
): Promise<number> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('station', mssql.Int, a.stationId)
    .input('adj', mssql.DateTime2, a.adjustedAtUtc)
    .input('by', mssql.Int, a.recordedBy)
    .input('reason', mssql.NVarChar(255), a.reason)
    .input('note', mssql.NVarChar(500), a.note)
    .input('amount', mssql.Decimal(10, 2), a.amountG)
    .input('before', mssql.Decimal(10, 2), a.beforeG ?? null)
    .input('after', mssql.Decimal(10, 2), a.afterG ?? null)
    .input('reference', mssql.Decimal(10, 2), a.referenceG ?? null)
    .input('product', mssql.Int, a.productId ?? null)
    .query<{ id: number }>(
      `INSERT INTO sms.calibration_adjustment
         (line_id, station_id, adjusted_at_utc, recorded_by, reason, note, amount_g, before_g, after_g, reference_g, product_id)
       OUTPUT INSERTED.adjustment_id id
       VALUES (@line, @station, @adj, @by, @reason, @note, @amount, @before, @after, @reference, @product)`,
    );
  return r.recordset[0]!.id;
}
