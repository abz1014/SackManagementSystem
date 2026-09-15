/**
 * The ONE cone classification — roadmap Phase 4 item 1 (14 Sep 2026).
 *
 * WHY THIS FILE EXISTS. Until Phase 4 the application held two independent
 * two-state judgements about a cone — the scale's in-range bit, and whether
 * the weight sat inside the product's tolerance — and four separate pieces of
 * code turned them into words: ProductTimeline.verdict() (which no screen
 * called), register.ts's outsideLimitsSegments filter, spc.ts's
 * specAgreement, and a client-side re-implementation in ReadingSheet.tsx.
 * IFL's requirement is a single classification of every cone weight
 * (within / low / high / rejected / unknown), and four copies of a rule are
 * four chances for two screens to disagree about the same cone. This is the
 * only copy. Every consumer — the register rows, the detail sheet, the CSV,
 * the per-state counts on /api/production, the SQL CASE the API builds for
 * set-based queries (api/src/services/coneState.ts mirrors this order clause
 * for clause and is tested against the same fixture) — derives from it.
 *
 * THE RULE, in the order the checks run:
 *
 *   1. No weight, or a weight outside the plausibility window   -> 'unknown'
 *      A scale fault (824 g, 2,300 g) is a non-reading, not a light or heavy
 *      cone; judging it against a tolerance would be judging noise. The
 *      window is the app-owned plausibility rule (sms.plausibility_rule),
 *      whose bounds are the developer's measured defaults — IFL has not yet
 *      confirmed them (Q10).
 *   2. The scale's own bit is 0                                  -> 'rejected'
 *      REDESIGN rule 1: the scale's verdict is the single status flag, named
 *      as the scale's. It governs 'rejected' whatever the product says.
 *   3. No limits in force at the reading's OWN time              -> 'unknown'
 *      No product recorded then, or a product with no setpoint or offsets.
 *      Never today's limits: a reading is judged by the limits in force at
 *      its own time (productLimits.ts), or not at all.
 *   4. Otherwise, by those limits                                -> 'low' | 'high' | 'within'
 *      Inclusive at both ends: a cone exactly on a limit is within it, as
 *      the SQL comparisons (`>= lo AND <= hi`) have always said.
 *
 * WHEN THE SCALE AND THE PRODUCT DISAGREE. The scale can pass a cone the
 * product's tolerance would not (about a thousand in the July record). The
 * rule above makes that cone 'low' or 'high' — the product tolerance is the
 * more specific judgement of the two — AND the payload keeps `scalePassed:
 * true`, so a screen states both facts ("Passed by the scale; 12 g under
 * the product's lower limit") rather than hiding one behind the other. The
 * reverse case (scale rejected, weight inside the tolerance) is 'rejected',
 * because the scale's bit is the flag that put the cone in the reject bin.
 * Which judgement should govern when they disagree is a question only IFL
 * can answer; this ordering is the DEVELOPER'S RULE pending that answer, and
 * the fixture in sms/test/fixtures/cone-classification.json says so in its
 * header. Change the order here and the fixture, together, when IFL decides.
 */

export const CONE_STATES = ['within', 'low', 'high', 'rejected', 'unknown'] as const;
export type ConeState = (typeof CONE_STATES)[number];

export function isConeState(s: unknown): s is ConeState {
  return typeof s === 'string' && (CONE_STATES as readonly string[]).includes(s);
}

/** A product's limits as PDAS states them: a setpoint and two offsets. */
export interface ConeLimits {
  setpointG: number;
  /** Grams below the setpoint the tolerance extends. Sign is ignored. */
  minusG: number;
  /** Grams above the setpoint the tolerance extends. Sign is ignored. */
  plusG: number;
}

export interface ClassifyInput {
  /** The recorded weight; null when the reading carries none. */
  weightG: number | null | undefined;
  /**
   * The scale's own in-range bit. false = the scale rejected it. null = the
   * source recorded no bit; the cone is then judged by the product alone and
   * `scalePassed` comes back null, never a fabricated true.
   */
  inRange: boolean | null | undefined;
  /** The limits in force at the reading's OWN time, or null when none were. */
  limits: ConeLimits | null;
  /** Whether the weight is inside the plausibility window — see isPlausibleWeight. */
  plausible: boolean;
}

/** The lower and upper bound a limits row describes, inclusive. */
export function limitBounds(l: ConeLimits): { loG: number; hiG: number } {
  return { loG: l.setpointG - Math.abs(l.minusG), hiG: l.setpointG + Math.abs(l.plusG) };
}

/**
 * The population rule, in one place: a weight is plausible when it lies
 * inside the window, inclusive. Every weight statistic in the application
 * (weights.ts, spc.ts, production.ts, the reconciliation) excludes
 * implausible readings by exactly this test, and the SQL form
 * (`BETWEEN @lo AND @hi`) is inclusive to match.
 */
export function isPlausibleWeight(weight: number | null | undefined, window: { loG: number; hiG: number }): boolean {
  return weight != null && Number.isFinite(weight) && weight >= window.loG && weight <= window.hiG;
}

/** The state alone. See classifyConeDetail for the facts beside it. */
export function classifyCone(input: ClassifyInput): ConeState {
  return classifyConeDetail(input).state;
}

export interface ConeClassification {
  state: ConeState;
  /**
   * The scale's own verdict, kept beside the state so both facts can be
   * printed when they differ: true = passed, false = rejected, null = the
   * source recorded no bit.
   */
  scalePassed: boolean | null;
  /** Signed grams outside the limits (negative = under); 0 within; null when unjudged. */
  outsideByG: number | null;
  /** Why the state is 'unknown', when it is. */
  unknownReason: 'no_weight' | 'implausible' | 'no_limits' | null;
}

export function classifyConeDetail(input: ClassifyInput): ConeClassification {
  const w = input.weightG;
  const scalePassed = input.inRange == null ? null : Boolean(input.inRange);
  if (w == null || !Number.isFinite(w)) {
    return { state: 'unknown', scalePassed, outsideByG: null, unknownReason: 'no_weight' };
  }
  if (!input.plausible) {
    return { state: 'unknown', scalePassed, outsideByG: null, unknownReason: 'implausible' };
  }
  if (input.inRange === false) {
    return { state: 'rejected', scalePassed: false, outsideByG: outsideBy(w, input.limits), unknownReason: null };
  }
  if (!input.limits) {
    return { state: 'unknown', scalePassed, outsideByG: null, unknownReason: 'no_limits' };
  }
  const by = outsideBy(w, input.limits)!;
  const state: ConeState = by < 0 ? 'low' : by > 0 ? 'high' : 'within';
  return { state, scalePassed, outsideByG: by, unknownReason: null };
}

/** Signed distance outside the limits, to 0.01 g; 0 inside; null without limits. */
function outsideBy(weightG: number, limits: ConeLimits | null): number | null {
  if (!limits) return null;
  const { loG, hiG } = limitBounds(limits);
  const below = loG - weightG;
  const above = weightG - hiG;
  if (below > 0) return -Math.round(below * 100) / 100;
  if (above > 0) return Math.round(above * 100) / 100;
  return 0;
}
