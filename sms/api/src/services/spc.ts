/**
 * Weight SPC — statistical process control on the cone/sack weight stream.
 *
 * WHY NOT RAW I-MR:
 * The line produces ~8,000 cones/day from 14 parallel winding stations whose
 * outputs interleave into ONE timestamp stream. Verified on real data: 90.2%
 * of consecutive cones come from a *different* station, so the moving range
 * |x_i − x_{i-1}| is dominated by station-to-station bias, not sequential
 * within-process variation — the I-MR assumption is violated, and an I-chart
 * of 8,000 individual points is an unreadable noise band regardless.
 *
 * WHAT WE DO INSTEAD:
 *  1. X̄/S with TIME-BASED rational subgroups. Cones are grouped into short
 *     time buckets, auto-sized from the DATA'S OWN occupied span (not the
 *     requested period's calendar span) to hold ~20 readings each — see
 *     pickBucketMinutes below. Fixed 21 Sep 2026 (DEFECTS.md D-1): the prior
 *     "~80 readable points" framing here was aspirational, not measured, and
 *     the code did not in fact achieve it — a month ran 197x over the
 *     20-reading target, tightening the per-subgroup control band the chart
 *     draws `xViolates` from. At this plant's production rate the achievable
 *     floor is ~80-85 readings/subgroup (see pickBucketMinutes), fairly
 *     constant across shift/day/week/month once sized correctly — read that
 *     rather than "readable points" as the real design target now.
 *     The X̄-chart shows whether the LINE MEAN drifts over time; the S-chart
 *     shows whether the spread changes. σ_within is estimated from pooled
 *     within-subgroup variance — a valid short-term σ that (unlike MR here)
 *     isn't corrupted by the station interleaving, because every subgroup
 *     contains the same station mix.
 *  2. PER-STATION analysis (ANOM-style). Each station's mean is compared to
 *     the grand mean ± 3σ/√n; stations outside that band are flagged as
 *     biased. This surfaces the actual actionable signal — e.g. one station
 *     running consistently light — that the firehose chart buried.
 *  3. A DISTRIBUTION histogram with spec/natural limits overlaid, which is
 *     what actually communicates capability, not 8,000 dots.
 *
 * Capability (Cp/Cpk/Pp/Ppk) requires a real spec limit (USL/LSL). We NEVER
 * fabricate one: populated only from IFL's own PDAS-confirmed setpoint ±
 * tolerance (sms.product) for a selected product, or an explicit manual
 * override. With neither, capability is null; the charts still work on the
 * data's own statistics.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';
import type { PlausibilityRule } from './admin.js';
import { plausibleWhere } from './coneState.js';
import { nelsonViolations, type NelsonRuleId } from './nelson.js';
import { loadProductCatalogue, limitsFromVersion } from './productLimits.js';

export type SpcType = 'cone' | 'sack';

export interface Subgroup {
  ts: string; // bucket start
  n: number;
  mean: number;
  s: number | null; // within-subgroup sample stdev (null if n < 2)
  xUcl: number;
  xLcl: number;
  sUcl: number | null;
  sLcl: number | null;
  xViolates: boolean; // rule 1 alone — kept for the existing "N of M outside the band" verdict
  sViolates: boolean;
  /** Rules 2-8 (rule 1 is xViolates above): non-random patterns a single-point
   *  3σ check misses entirely — see nelson.ts. Empty when the subgroup mean
   *  looks like ordinary process noise. */
  nelson: NelsonRuleId[];
}

export interface StationStat {
  station: number;
  n: number;
  mean: number;
  stdev: number | null;
  delta: number; // mean − grandMean
  distinguishable: boolean; // |delta| > 3·σ_within/√n — statistically real (easy at large n)
  flagged: boolean; // distinguishable AND |delta| ≥ practical threshold — worth acting on
}

export interface HistBin {
  start: number;
  end: number;
  count: number;
}

export interface SpecLimits {
  usl: number | null;
  lsl: number | null;
  nominal: number | null;
  source: 'product' | 'manual' | 'none';
  productLabel?: string;
  /**
   * When `source` is 'product' and a period was given: the version of the
   * limits the chart is drawn against (in force at the END of the period),
   * and how many times the limits changed INSIDE the period. A non-zero
   * count means the single pair of lines on the chart did not apply to every
   * point on it — the screen says so rather than letting the reader judge
   * last week's cones by this week's tolerance.
   */
  limitsEffectiveFromUtc?: string;
  limitsAreLowerBound?: boolean;
  limitsChangedInPeriod?: number;
}

/**
 * Agreement between the PLC's own pass/fail bit and IFL's product tolerance.
 * Both judgements are IFL's; where they diverge, only IFL can say which governs.
 */
export interface SpecAgreement {
  evaluated: number;
  /** PLC said in-range, the product tolerance says out. */
  plcPassedButOutOfTolerance: number;
  /** PLC said out-of-range, the product tolerance says in. */
  plcFailedButInTolerance: number;
  disagreementCount: number;
  disagreementPct: number;
  toleranceLabel: string;
  specSource: 'product' | 'manual' | 'none';
}

export interface SpcData {
  /** null unless a real spec is selected (never fabricated). */
  specAgreement: SpecAgreement | null;
  type: SpcType;
  unit: 'g' | 'kg';
  /** The station the chart is drawn for, or null for the whole line (roadmap Phase 4). */
  station: number | null;
  count: number;
  /**
   * Readings the population rule EXCLUDED as implausible (roadmap Phase 4,
   * 14 Sep 2026), so the screen can say "N readings, of which M excluded"
   * with the same figure the reconciliation and the report print.
   */
  implausible: number;
  /**
   * The source generation this chart is drawn from (DEFECTS.md D-10 follow-up,
   * 23 Sep 2026): null when the window's readings carry no epoch information
   * at all (pre-epoch data, or a test fixture). When non-null, every query
   * behind this payload is scoped to exactly this one epoch — see
   * `otherGenerationExcluded`.
   */
  generation: { epochId: number; ordinal: number; label: string | null; provenance: string | null } | null;
  /** Rows in the requested window that belong to a DIFFERENT generation than
   *  the one this chart was drawn from (including rows with no source_epoch
   *  at all) — excluded, not pooled in. 0 when the window sits inside one
   *  generation, which is the common case once a plant is live. */
  otherGenerationExcluded: number;
  /** True iff `otherGenerationExcluded` > 0 — the requested window touched
   *  more than one physical source generation. */
  spansGenerations: boolean;
  mean: number;
  /** Median of the same population as `mean` (roadmap Phase 9 item 1, 15 Sep
   *  2026) — the Weight screen prints the two side by side, so they must come
   *  from one query surface with one predicate. Null for an empty period. */
  median: number | null;
  stdevOverall: number; // long-term σ (all points) → Pp/Ppk
  stdevWithin: number; // short-term σ (pooled within-subgroup) → Cp/Cpk
  bucketMinutes: number;
  bucketLabel: string;
  grandMean: number;
  sChartCenter: number; // = stdevWithin
  xbarOutOfControl: number;
  /** Subgroups with at least one Nelson rule 2-8 violation (rule 1 is
   *  xbarOutOfControl above) — a non-random pattern with no single point ever
   *  crossing the 3σ band. */
  nelsonFlagged: number;
  subgroups: Subgroup[];
  stations: StationStat[]; // cone only; [] for sack (no station column)
  practicalThresholdG: number; // |delta| beyond which a station is worth acting on
  distinguishableStationCount: number; // statistically real (often near-all at large n)
  flaggedStationCount: number; // practically significant — the actionable subset
  histogram: HistBin[];
  spec: SpecLimits;
  capability: { cp: number | null; cpk: number | null; pp: number | null; ppk: number | null };
  /**
   * The X̄ band itself (DEFECTS.md D-10 fix, 23 Sep 2026) — an I-MR band on
   * the subgroup means, not the old σ_within/√n band. `valid` is false (and
   * every subgroup's `xViolates` is forced false, and `nelson` never fires)
   * when fewer than 3 time-contiguous subgroup-mean pairs exist to estimate
   * MR̄ from — there is then no trustworthy band, not a generously wide one.
   * `pairs` excludes any pair spanning a genuine data gap (a missing bucket).
   */
  xLimits: { valid: boolean; mrBar: number; sigmaBetween: number; halfWidth: number; pairs: number };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const NICE: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: '15-minute' },
  { minutes: 30, label: '30-minute' },
  { minutes: 60, label: 'hourly' },
  { minutes: 120, label: '2-hour' },
  { minutes: 240, label: '4-hour' },
  { minutes: 360, label: '6-hour' },
  { minutes: 720, label: '12-hour' },
  { minutes: 1440, label: 'daily' },
];

const TARGET_PER_SUBGROUP = 20;
const MIN_BUCKETS = 8;
// Defensive-only: bounds the realised bucket COUNT (post NICE lookup), never
// the target-driven desired count. Protects the SQL GROUP BY / payload size
// on a pathologically long period (far beyond the shift/day/week/month this
// screen supports) — it does not fight TARGET_PER_SUBGROUP the way the old
// MAX_BUCKETS=72 clamp on `desiredBuckets` did (see D-1, DEFECTS.md): that
// clamp bound the desired bucket COUNT, so once a period held much above
// ~1,440 readings (most shifts, every multi-day period) the cap — not the
// target — decided bucket width, and subgroups ballooned 8x-197x past
// TARGET_PER_SUBGROUP in direct proportion to how far volume exceeded it.
const MAX_REALISED_BUCKETS = 4000;

/**
 * Pick a "nice" bucket size (minutes) so each subgroup holds a STABLE number
 * of events, not merely so the count of buckets looks tidy. Rational subgroups
 * need enough members (~15–25) for the within-subgroup spread to estimate σ
 * reliably; sizing purely by time span breaks on low-rate streams — sacks run
 * ~13× fewer than cones, so a 30-min bucket that holds ~170 cones holds only
 * ~7 sacks (some n=1), producing unstable limits and false out-of-control
 * points. We target ~20 events/subgroup.
 *
 * `occupiedMinutes` is the span the DATA actually occupies, not the calendar
 * span of the requested period — see the caller. That fixes the other half
 * of D-1: a single 8-hour shift filtered out of a 24-hour day used to be
 * sized as if production ran the full 24 hours, inflating the chosen bucket
 * width (and therefore n_i) by up to 3x before the clamp above even entered
 * into it.
 *
 * HONEST LIMIT, not an oversight: NICE bottoms out at 15 minutes. Below that,
 * a bucket risks not covering a full cycle of the line's ~14 interleaved
 * stations (measured cycle ≈ 2.5 min at this line's rate), which is the
 * "constant station mix per subgroup" assumption stdevWithin is built on (see
 * file header) — going finer would trade that assumption for a closer-to-20
 * n_i, which is not a trade this module makes silently. At this plant's
 * measured rate (~5.5-6 cones/min), a 15-minute bucket holds roughly 80-85
 * cones — about 4x TARGET_PER_SUBGROUP — REGARDLESS of the requested period's
 * length, because the production rate is roughly constant: a shift, a day, a
 * week and a month all land near the same n_i once occupied-span sizing
 * replaces calendar-span sizing, rather than escalating with period length as
 * before. See spc.subgroupSizing.test.ts for the measured before/after.
 */
/**
 * The span used to size buckets, in minutes: the raw (max-min) span of the
 * filtered population's own timestamps, capped at `occDays * 1440` so a
 * genuine multi-day gap inside the period (idle days, or — concretely — the
 * source-generation cutover CLAUDE.md documents as the 10 Jul - 5 Aug data
 * gap) cannot inflate the span by days that produced nothing. `occDays` is
 * the count of distinct calendar dates that actually produced a plausible
 * reading, so `occDays * 1440` is "if the line had run flat out, wall-clock,
 * on every day that produced anything" — a looser bound than the true
 * running time (it doesn't know about idle time WITHIN a producing day), but
 * one cheap COUNT(DISTINCT date) buys it without a second row-scanning query.
 * Exported for spc.subgroupSizing.test.ts, which pins this against the exact
 * gap shape found in the live copy.
 */
export function occupiedMinutesFor(rawSpanMinutes: number, occDays: number): number {
  return occDays > 0 ? Math.min(Math.max(rawSpanMinutes, 1), occDays * 1440) : 0;
}

export function pickBucketMinutes(occupiedMinutes: number, count: number): { minutes: number; label: string } {
  if (count <= 0 || occupiedMinutes <= 0) return NICE[NICE.length - 1]!;
  const desiredBuckets = Math.max(MIN_BUCKETS, Math.round(count / TARGET_PER_SUBGROUP));
  const targetMinutes = occupiedMinutes / desiredBuckets;
  const chosen = NICE.find((b) => b.minutes >= targetMinutes) ?? NICE[NICE.length - 1]!;
  const realisedBuckets = Math.max(1, Math.round(occupiedMinutes / chosen.minutes));
  if (realisedBuckets > MAX_REALISED_BUCKETS) return NICE[NICE.length - 1]!;
  return chosen;
}

export async function getSpec(
  pool: ConnectionPool,
  productId: number | null,
  manualUsl: number | null,
  manualLsl: number | null,
  type: SpcType = 'cone',
  /** The chart's period, production dates. With it, limits come from the
   *  versioned history; without it, from the mirror's current row. */
  range?: { from: string; to: string },
): Promise<SpecLimits> {
  if (manualUsl != null && manualLsl != null) {
    return { usl: manualUsl, lsl: manualLsl, nominal: round((manualUsl + manualLsl) / 2), source: 'manual' };
  }
  // sms.product.setpoint_weight_g is a CONE setpoint in GRAMS. Applied to sacks,
  // whose weights are kilograms, it produced a 1960 kg "setpoint" against a
  // 47 kg mean — a Cpk of -3734 and a verdict reading "Sacks run 1912.7 kg
  // light". Manual limits are still honoured for sacks because the caller
  // supplies those in the record's own unit.
  if (type === 'sack') {
    return { usl: null, lsl: null, nominal: null, source: 'none' };
  }
  // Time-versioned limits (sms.product_limit_version, migration 027). Until
  // 14 Sep 2026 this read sms.product — the mirror's CURRENT values — so a
  // chart of last month was judged by this month's tolerance, which is the
  // exact error the versioned table was built to end (weightStations.ts and
  // productAt.ts had already moved; this was the one consumer left behind).
  // The same instant convention as weightStations: the end of the `to` day.
  if (productId != null && range) {
    const catalogue = await loadProductCatalogue(pool);
    const startMs = new Date(`${range.from}T00:00:00Z`).getTime();
    const endMs = new Date(`${range.to}T23:59:59Z`).getTime();
    const v = catalogue.versionAt(productId, endMs);
    const lim = limitsFromVersion(v);
    if (v && lim) {
      const changed = catalogue
        .versionsAscending(productId)
        .filter((x) => x.effectiveFromMs > startMs && x.effectiveFromMs <= endMs).length;
      return {
        usl: lim.hiG,
        lsl: lim.loG,
        nominal: lim.targetG,
        source: 'product',
        productLabel: catalogue.product(productId)?.label ?? `Product ${productId}`,
        limitsEffectiveFromUtc: v.effectiveFromUtc,
        limitsAreLowerBound: v.effectiveIsLowerBound,
        // The version in force at the end is not itself "a change inside the
        // period" unless it began inside it; the filter above counts it then.
        limitsChangedInPeriod: changed,
      };
    }
    // No version yet (a mirror that has never completed a pass since 027):
    // fall through to the current row, honestly labelled by the absence of
    // limitsEffectiveFromUtc.
  }
  if (productId != null) {
    const r = await pool
      .request()
      .input('id', mssql.Int, productId)
      .query<{ sp: number | null; om: number | null; op: number | null; d: string | null; l: string | null }>(
        `SELECT setpoint_weight_g sp, weight_offset_minus_g om, weight_offset_plus_g op, description d, lot_code l
         FROM sms.product WHERE product_id=@id`,
      );
    const row = r.recordset[0];
    if (row?.sp != null && row.om != null && row.op != null) {
      return {
        usl: Number(row.sp) + Number(row.op),
        lsl: Number(row.sp) - Number(row.om),
        nominal: Number(row.sp),
        source: 'product',
        productLabel: row.d || row.l || `Product ${productId}`,
      };
    }
  }
  return { usl: null, lsl: null, nominal: null, source: 'none' };
}

const HIST_BINS = 32;

/**
 * PLAUSIBILITY GUARD — physically-impossible readings only.
 *
 * This replaces what used to be an `in_range = 1` filter on the SPC population,
 * which conflated two different jobs:
 *
 *   in_range is the PLC's SPEC verdict — "is this cone inside the tolerance
 *   band" — and it is exactly the wrong thing to filter an SPC population by.
 *   The purpose of per-station analysis is to find a station drifting off
 *   target; filtering to in-spec cones first removes that station's worst
 *   output from the very evidence used to judge it. The bias is small in
 *   magnitude while the line runs well (0.29% out of range today; measured
 *   station means move only 0.01-0.19g) but it is wrong in DIRECTION and it
 *   grows precisely when a station is at its worst — i.e. it fails when it
 *   matters. Out-of-spec cones are real production and must count.
 *
 *   A data-quality guard is still needed, and is a separate concern: the scale
 *   emits occasional faults that are not light/heavy cones but non-readings.
 *   Verified in the supplied copy: one cone at 824g, and a fault population of
 *   ~214 cones at 2200-2354g — far outside the widest real product tolerance
 *   (the product master's envelope is 1910-2010g). Left in, those would move
 *   the mean and inflate sigma. So we exclude on PLAUSIBILITY, not on spec.
 *
 * Bounds are deliberately generous — wide enough that no genuinely out-of-spec
 * cone is ever discarded, tight enough to drop non-readings. Was a code
 * constant (module-level PLAUSIBLE object); now sms.plausibility_rule, an
 * app-owned versioned rule the caller fetches and passes in — same pattern as
 * `spec` below. Default 1500-2100g cone / 40-60kg sack, matching what was
 * hardcoded before ("sacks < 40 kg, cones < 1500 g" in CLAUDE.md).
 *
 * The predicate itself is coneState.ts's plausibleWhere — the ONE population
 * rule since roadmap Phase 4 (14 Sep 2026), shared with weights.ts,
 * production.ts and the reconciliation, so every weight statistic in the
 * application excludes the same readings.
 */
export async function getWeightSpc(
  pool: ConnectionPool,
  lineId: number,
  type: SpcType,
  from: string,
  to: string,
  spec: SpecLimits,
  plausibility: PlausibilityRule,
  shift: string | null = null,
  /** One station's stream (cone only): the Weight screen's selector (Phase 4). */
  station: number | null = null,
): Promise<SpcData> {
  const table = type === 'cone' ? 'sms.cone_event' : 'sms.sack_event';
  const col = type === 'cone' ? 'weight_g' : 'weight_kg';
  const unit: 'g' | 'kg' = type === 'cone' ? 'g' : 'kg';
  const plaus =
    type === 'cone'
      ? { loG: plausibility.coneLoG, hiG: plausibility.coneHiG }
      : { loG: plausibility.sackLoKg, hiG: plausibility.sackHiKg };
  // sack_event has no station column: a station on a sack query is ignored,
  // not bound, or it would be a SQL error rather than an empty chart.
  const stationFilter = type === 'cone' && station != null;

  // Base filter BEFORE the generation predicate — used only to resolve which
  // generation(s) are actually present in the requested window (below).
  const base0 =
    `line_id=@line AND shift_date BETWEEN @from AND @to AND ${col} IS NOT NULL` +
    (shift ? ' AND shift_code=@shift' : '') +
    (stationFilter ? ' AND source_station=@station' : '');

  // GENERATION PREDICATE (DEFECTS.md D-10 follow-up, 23 Sep 2026). Until this
  // pass, getWeightSpc carried no generation filter at all — unlike
  // rejectSpc.ts, which has refused to pool p̄ across the 5 Aug rebuild since
  // roadmap Phase 5 for exactly the right reason. On this dev copy that meant
  // silently pooling real epoch-9 cones (5 Aug-7 Sep) with plant-simulator
  // epoch-13 cones into ONE control chart the moment a query's date range
  // spanned both — a chart drawn from two physically different populations
  // with no boundary marked on it.
  //
  // Resolution: find every source_epoch present in the base-filtered window,
  // map each to its sms.source_epoch.generation_ordinal, provenance AND
  // source_db, and keep only ONE generation:
  //  - prefer a REAL generation over a SIMULATOR one when both are present
  //    in the window. This is not merely "newest": CLAUDE.md's live-
  //    rehearsal warning and this pass's own measurement (see DEFECTS.md
  //    D-10) both establish that the simulator does NOT reproduce the
  //    plant's between-subgroup wander (ratio 1.38x on simulator-dominated
  //    late-Sep data vs 2.81-3.62x on real data) — silently drawing this
  //    chart over simulator rows, even alone, would corrupt the very MR̄
  //    this fix depends on with a variance shape that isn't the plant's.
  //
  //    "Simulator" is determined from `source_db`, NOT `se.provenance` —
  //    verified live against this dev copy (23 Sep 2026): epoch 13
  //    (pack1_TP1U2, `DATA_TP1U2_SIM`, 212,873 rows spanning 21 Aug-22 Sep)
  //    is registered with `provenance='ifl_copy'`, not 'simulator' — almost
  //    certainly a bootstrap/registration slip, but it makes `provenance`
  //    alone unsafe to trust here. `scripts/simulate-plant.mjs` enforces
  //    `/_SIM$/i` on its target database name as a hard refusal (its own
  //    line 96-98) — that is the one invariant actually guaranteed to hold,
  //    so a generation is treated as simulator when EITHER its provenance
  //    says so OR its source_db ends in `_SIM`.
  //  - among generations of the preferred kind, take the NEWEST ordinal
  //    (ties cannot occur — UX_source_epoch_open allows at most one open
  //    epoch per line/table, and ordinals are assigned in time order).
  //  - with no real generation in the window at all, fall back to the
  //    newest simulator one — still a single generation, still counted
  //    honestly, and the caller can see `generation.provenance` says so.
  // Rows from any other generation — including rows with a NULL
  // source_epoch, i.e. "ingested before epoch tracking existed" — are
  // excluded and counted, never silently pooled in. With zero or one
  // generation present (the common case once a plant is live) this is a
  // no-op: `otherGenerationExcluded` is 0 and no predicate is added.
  const genReq = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  if (shift) genReq.input('shift', mssql.VarChar(10), shift);
  if (stationFilter) genReq.input('station', mssql.Int, station);
  const genWhere =
    `e.line_id=@line AND e.shift_date BETWEEN @from AND @to AND e.${col} IS NOT NULL` +
    (shift ? ' AND e.shift_code=@shift' : '') +
    (stationFilter ? ' AND e.source_station=@station' : '');
  const genRes = await genReq.query<{
    epoch_id: number | null;
    gen: number | null;
    label: string | null;
    provenance: string | null;
    source_db: string | null;
    n: number;
  }>(
    `SELECT e.source_epoch AS epoch_id, se.generation_ordinal AS gen, se.label AS label,
            se.provenance AS provenance, se.source_db AS source_db, COUNT(*) AS n
     FROM ${table} e LEFT JOIN sms.source_epoch se ON se.epoch_id = e.source_epoch
     WHERE ${genWhere}
     GROUP BY e.source_epoch, se.generation_ordinal, se.label, se.provenance, se.source_db`,
  );
  const genRows = genRes.recordset;
  const isSimulator = (r: { provenance: string | null; source_db: string | null }) =>
    r.provenance === 'simulator' || /_SIM$/i.test(r.source_db ?? '');
  const totalGenRows = genRows.reduce((s, r) => s + Number(r.n), 0);
  let genEpochId: number | null = null;
  let generation: SpcData['generation'] = null;
  let otherGenerationExcluded = 0;
  const withOrdinal = genRows.filter((r) => r.gen != null && r.epoch_id != null);
  const realGenerations = withOrdinal.filter((r) => !isSimulator(r));
  const candidates = realGenerations.length > 0 ? realGenerations : withOrdinal;
  if (candidates.length > 0) {
    const chosen = candidates.reduce((a, b) => (Number(b.gen) > Number(a.gen) ? b : a));
    genEpochId = Number(chosen.epoch_id);
    generation = { epochId: genEpochId, ordinal: Number(chosen.gen), label: chosen.label, provenance: chosen.provenance };
    const inChosen = genRows.filter((r) => r.epoch_id === chosen.epoch_id).reduce((s, r) => s + Number(r.n), 0);
    otherGenerationExcluded = totalGenRows - inChosen;
  }
  const spansGenerations = otherGenerationExcluded > 0;

  // Everything but the plausibility predicate, which plausibleWhere binds per
  // request below (its parameters must be on the request that runs).
  const base = base0 + (genEpochId != null ? ' AND source_epoch=@genEpoch' : '');
  const whereOn = (r: SqlRequest) => `${base} AND ${plausibleWhere(r, col, plaus)}`;

  // 1. Overall summary — one pass, no row transfer. Drives the bucket sizing.
  //    The implausible count is asked for in the same pass, over the same
  //    base filter, so "N of which M excluded" is one population split once.
  const sumReq = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  if (shift) sumReq.input('shift', mssql.VarChar(10), shift);
  if (stationFilter) sumReq.input('station', mssql.Int, station);
  if (genEpochId != null) sumReq.input('genEpoch', mssql.Int, genEpochId);
  const sumWhere = whereOn(sumReq);
  const sumRes = await sumReq
    .query<{
      n: number;
      mean: number | null;
      sd: number | null;
      excluded: number | null;
      minTs: Date | null;
      maxTs: Date | null;
      occDays: number | null;
    }>(
      `SELECT COUNT(*) n, AVG(CAST(${col} AS float)) mean, STDEV(CAST(${col} AS float)) sd,
              MIN(production_ts_utc) minTs, MAX(production_ts_utc) maxTs,
              COUNT(DISTINCT CAST(production_ts_utc AS date)) occDays,
              (SELECT COUNT(*) FROM ${table} WHERE ${base} AND NOT (${col} BETWEEN @plausLo AND @plausHi)) excluded
       FROM ${table} WHERE ${sumWhere}`,
    );
  const summ = sumRes.recordset[0]!;
  const count = summ.n;
  const mean = summ.mean ?? 0;

  // The median of the same population (Phase 9): its own statement, because
  // PERCENTILE_CONT is a window function and cannot sit beside the aggregates.
  const medReq = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  if (shift) medReq.input('shift', mssql.VarChar(10), shift);
  if (stationFilter) medReq.input('station', mssql.Int, station);
  if (genEpochId != null) medReq.input('genEpoch', mssql.Int, genEpochId);
  const medWhere = whereOn(medReq);
  const medRes = await medReq.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(${col} AS float)) OVER () med
     FROM ${table} WHERE ${medWhere}`,
  );
  const median = medRes.recordset?.[0]?.med == null ? null : Number(medRes.recordset[0]!.med);
  const stdevOverall = summ.sd ?? 0;
  const implausible = Number(summ.excluded ?? 0);

  // Bucket size depends on the event rate (count), not just the time span —
  // so low-rate sacks get wider buckets and stay statistically stable.
  //
  // OCCUPIED span, not the requested period's calendar span (D-1): raw
  // (max-min) captures a narrow filter inside a wide `from`/`to` — a single
  // shift filtered out of a full `from`/`to` day used to be sized as if
  // production ran the whole day. Capping that raw span at
  // `occDays * 1440 minutes` additionally keeps a genuine multi-day
  // PRODUCTION GAP inside the period (e.g. the source generation cutover —
  // see CLAUDE.md's "10 Jul – 5 Aug data gap") from inflating the span by the
  // idle days in the middle: occDays counts only the calendar dates that
  // actually produced a plausible reading, so the span used for sizing is
  // bounded by how much the line was actually running, not by how far apart
  // its first and last reading in the period happen to fall.
  const rawSpanMinutes =
    summ.minTs != null && summ.maxTs != null
      ? (new Date(summ.maxTs).getTime() - new Date(summ.minTs).getTime()) / 60_000
      : 0;
  const occDays = Number(summ.occDays ?? 0);
  const occupiedMinutes = occupiedMinutesFor(rawSpanMinutes, occDays);
  const { minutes: bucketMinutes, label: bucketLabel } = pickBucketMinutes(occupiedMinutes, count);

  // Every later query binds the same filter through the same builder; `where`
  // is the text the builder returns and is identical on every request.
  const req = (extra?: (r: SqlRequest) => void) => {
    const r = pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('from', mssql.Date, from)
      .input('to', mssql.Date, to)
      .input('bucketMin', mssql.Int, bucketMinutes);
    if (shift) r.input('shift', mssql.VarChar(10), shift);
    if (stationFilter) r.input('station', mssql.Int, station);
    if (genEpochId != null) r.input('genEpoch', mssql.Int, genEpochId);
    whereOn(r);
    extra?.(r);
    return r;
  };
  const where = `${base} AND ${col} BETWEEN @plausLo AND @plausHi`;

  // 2. Time-bucketed subgroups — mean & within-subgroup S computed in SQL.
  const bucketExpr =
    bucketMinutes >= 1440
      ? 'CAST(shift_date AS datetime2(3))'
      : `DATEADD(MINUTE, (DATEDIFF(MINUTE, 0, production_ts_utc) / @bucketMin) * @bucketMin, 0)`;
  const sgRes = await req().query<{ b: Date; n: number; mean: number; s: number | null }>(
    `SELECT ${bucketExpr} b, COUNT(*) n, AVG(CAST(${col} AS float)) mean, STDEV(CAST(${col} AS float)) s
     FROM ${table} WHERE ${where}
     GROUP BY ${bucketExpr} ORDER BY b`,
  );
  const rawSg = sgRes.recordset;

  // pooled within-subgroup σ = √( Σ(n_i−1)s_i² / Σ(n_i−1) ) — the valid
  // short-term σ; interleaving doesn't corrupt it (constant station mix per bucket).
  let pooledNum = 0;
  let pooledDen = 0;
  for (const g of rawSg) {
    if (g.s != null && g.n > 1) {
      pooledNum += (g.n - 1) * g.s * g.s;
      pooledDen += g.n - 1;
    }
  }
  const stdevWithin = pooledDen > 0 ? Math.sqrt(pooledNum / pooledDen) : 0;
  const grandMean = mean;

  // X̄ LIMITS — an I-MR band on the SUBGROUP MEANS (DEFECTS.md D-10 fix,
  // 23 Sep 2026), replacing the old X̿ ± 3σ_within/√n_i band.
  //
  // WHY the old band was wrong, not just narrow: σ_within is the pooled
  // WITHIN-subgroup spread — valid for the S-chart below, which is exactly
  // what it's measuring — but the X̄ band's job is to bound BETWEEN-subgroup
  // variation, which σ_within never models at all (it implicitly assumes
  // zero). Measured live against this data (see DEFECTS.md D-10, 23 Sep 2026
  // update): the observed SD of subgroup means runs 1.76×-3.62× wider than
  // σ_within/√n predicts, and the ratio GROWS with period length — the
  // signature of genuine level wander (drift, shift effects, product
  // changes), not noise. That is why the old band flagged 16-38.5% of points
  // against an expected ~0.3%: it was measuring the right process against
  // the wrong source of variation.
  //
  // Fix: treat the subgroup means themselves as an I-chart. MR̄ = the mean
  // moving range between TIME-CONTIGUOUS subgroup means (a bucket-to-bucket
  // step, not a step across a missing bucket); limits are X̿ ± 2.66·MR̄, the
  // standard I-MR-derived band (2.66 = 3/d2, d2=1.128 for n=2 moving ranges).
  // This band is ONE width for the whole chart, not per-subgroup — a genuine
  // change from the old shape, and correct: I-MR does not scale with a
  // subgroup's own n, because what it is bounding is not a per-subgroup
  // sampling error at all.
  //
  // "Contiguous" excludes exactly the two things the old band conflated: a
  // pair spanning a genuine data gap (the source-generation cutover, or any
  // idle stretch) is not evidence of process wander, only of missing data —
  // including such a pair would inflate MR̄ with a spurious jump. The
  // generation predicate above already keeps two different physical
  // populations out of one chart; this keeps a same-generation GAP from
  // corrupting the moving range within it.
  //
  // NOT segmented by product: unlike weightStations.ts's per-station-
  // per-material split, a time bucket here carries no product dimension (up
  // to six materials can run concurrently across stations in one bucket), so
  // "same-product contiguity" is not implemented — read the resulting MR̄ as
  // a line-wide figure, not a per-product one. That is a scope limit of this
  // pass, not an oversight: it would be a genuinely new statistic (a
  // per-product subgroup split), which this pass was explicitly asked not to
  // add.
  const bucketSpanMs = bucketMinutes * 60_000;
  const orderedMeans = rawSg.map((g) => ({ t: new Date(g.b).getTime(), mean: g.mean }));
  const movingRanges: number[] = [];
  for (let i = 1; i < orderedMeans.length; i++) {
    const gapMs = orderedMeans[i]!.t - orderedMeans[i - 1]!.t;
    // Allow slack for the daily bucketExpr's CAST(shift_date AS datetime2),
    // whose calendar-day steps do not land on exact multiples of bucketMs in
    // every timezone edge case; still rejects a genuine multi-bucket gap.
    if (gapMs > 0 && gapMs <= bucketSpanMs * 1.5) movingRanges.push(Math.abs(orderedMeans[i]!.mean - orderedMeans[i - 1]!.mean));
  }
  // Below this many contiguous pairs, MR̄ is not a trustworthy estimate — say
  // so rather than draw a band from (e.g.) one pair, same philosophy as
  // rejectSpc's MIN_EXPECTED_REJECTS_FOR_VALID_LIMITS.
  const MIN_MR_PAIRS = 3;
  const mrBar = movingRanges.length > 0 ? movingRanges.reduce((a, b) => a + b, 0) / movingRanges.length : 0;
  const xLimitsValid = movingRanges.length >= MIN_MR_PAIRS && mrBar > 0;
  const MR_D2_N2 = 1.128; // moving-range-of-2 control-chart constant
  const sigmaBetween = xLimitsValid ? mrBar / MR_D2_N2 : 0; // implied 1σ of the subgroup-mean series
  const xHalfWidth = xLimitsValid ? 2.66 * mrBar : 0; // = 3 · sigmaBetween

  // S limits stay exactly as they were — per-subgroup, from σ_within, the
  // large-sample normal approx σ_within·(1 ± 3/√(2n_i)) (valid since n_i is
  // large, c4 ≈ 1). The S-chart compares within-subgroup spread against
  // within-subgroup sigma — internally consistent — and D-10 never implicated it.
  const subgroups: Subgroup[] = rawSg.map((g) => {
    const xUcl = grandMean + xHalfWidth;
    const xLcl = grandMean - xHalfWidth;
    let sUcl: number | null = null;
    let sLcl: number | null = null;
    let sViolates = false;
    if (g.n > 1 && stdevWithin > 0) {
      const half = 3 / Math.sqrt(2 * g.n);
      sUcl = stdevWithin * (1 + half);
      sLcl = Math.max(0, stdevWithin * (1 - half));
      if (g.s != null) sViolates = g.s > sUcl || g.s < sLcl;
    }
    return {
      ts: new Date(g.b).toISOString(),
      n: g.n,
      mean: round(g.mean, 2),
      s: g.s != null ? round(g.s, 2) : null,
      xUcl: round(xUcl, 2),
      xLcl: round(xLcl, 2),
      sUcl: sUcl != null ? round(sUcl, 2) : null,
      sLcl: sLcl != null ? round(sLcl, 2) : null,
      xViolates: xLimitsValid && (g.mean > xUcl || g.mean < xLcl),
      sViolates,
      nelson: [], // filled below — needs the whole series, not just this one subgroup
    };
  });
  const xbarOutOfControl = subgroups.filter((g) => g.xViolates).length;

  // Rule 1 is exactly xViolates above (same centerline, same band) — kept
  // out of `nelson` so the two never say the same thing under different
  // names. Every point now shares the ONE band-derived sigma (sigmaBetween),
  // not a per-subgroup σ_within/√n — the same fix as xUcl/xLcl above, so
  // rule 1 and rules 2-8 are drawn from the same corrected model rather than
  // rules 2-8 quietly keeping the old ill-fitting one. When xLimitsValid is
  // false, sigmaBetween is 0 and nelsonViolations treats every point as
  // sitting exactly on the centerline (its own documented behaviour for an
  // unusable scale) — no rule fires on an unmeasurable band, same as rule 1.
  const nelsonPerPoint = nelsonViolations(
    rawSg.map((g) => ({ value: g.mean, se: sigmaBetween })),
    grandMean,
  );
  subgroups.forEach((g, i) => {
    g.nelson = nelsonPerPoint[i]!.filter((r) => r !== 1);
  });

  // 3. Per-station analysis (cone only — sacks have no station column).
  //
  // Two separate ideas, deliberately not conflated:
  //  - distinguishable = |delta| > 3σ/√n. At ~600 cones/station this is TRUE
  //    for almost every station — even a sub-gram offset is statistically real.
  //    Useful to know, but NOT actionable on its own.
  //  - flagged = distinguishable AND |delta| ≥ a PRACTICAL threshold. That
  //    threshold is 10% of the spec tolerance when a real spec is set, else
  //    0.3σ of the overall spread. Only these are worth a maintenance look.
  const practicalThresholdG =
    spec.usl != null && spec.lsl != null
      ? round(0.1 * (spec.usl - spec.lsl), 2)
      : round(0.3 * stdevOverall, 2);

  let stations: StationStat[] = [];
  if (type === 'cone') {
    const stRes = await req().query<{ st: number; n: number; mean: number; sd: number | null }>(
      `SELECT source_station st, COUNT(*) n, AVG(CAST(${col} AS float)) mean, STDEV(CAST(${col} AS float)) sd
       FROM ${table} WHERE ${where} AND source_station IS NOT NULL
       GROUP BY source_station ORDER BY source_station`,
    );
    stations = stRes.recordset.map((r) => {
      const se = stdevWithin > 0 && r.n > 0 ? stdevWithin / Math.sqrt(r.n) : 0;
      const delta = r.mean - grandMean;
      const distinguishable = se > 0 && Math.abs(delta) > 3 * se;
      return {
        station: r.st,
        n: r.n,
        mean: round(r.mean, 2),
        stdev: r.sd != null ? round(r.sd, 2) : null,
        delta: round(delta, 2),
        distinguishable,
        flagged: distinguishable && Math.abs(delta) >= practicalThresholdG,
      };
    });
  }
  const distinguishableStationCount = stations.filter((s) => s.distinguishable).length;
  const flaggedStationCount = stations.filter((s) => s.flagged).length;

  // 4. Distribution histogram — binned in SQL over a ±4σ window around mean.
  let histogram: HistBin[] = [];
  if (count > 0 && stdevOverall > 0) {
    const lo = mean - 4 * stdevOverall;
    const width = (8 * stdevOverall) / HIST_BINS;
    const binCase = `CASE
        WHEN (CAST(${col} AS float) - @lo) / @width < 0 THEN 0
        WHEN (CAST(${col} AS float) - @lo) / @width >= @bins THEN @bins - 1
        ELSE FLOOR((CAST(${col} AS float) - @lo) / @width) END`;
    const hRes = await req((r) => {
      r.input('lo', mssql.Float, lo);
      r.input('width', mssql.Float, width);
      r.input('bins', mssql.Int, HIST_BINS);
    }).query<{ bin: number; c: number }>(
      `SELECT ${binCase} bin, COUNT(*) c FROM ${table} WHERE ${where}
       GROUP BY ${binCase} ORDER BY bin`,
    );
    const counts = new Map(hRes.recordset.map((r) => [Number(r.bin), r.c]));
    histogram = Array.from({ length: HIST_BINS }, (_, i) => ({
      start: round(lo + i * width, 2),
      end: round(lo + (i + 1) * width, 2),
      count: counts.get(i) ?? 0,
    }));
  }

  // 5. Capability — only with a real spec.
  let cp: number | null = null;
  let cpk: number | null = null;
  let pp: number | null = null;
  let ppk: number | null = null;
  if (spec.usl != null && spec.lsl != null && stdevWithin > 0) {
    cp = round((spec.usl - spec.lsl) / (6 * stdevWithin), 3);
    cpk = round(Math.min(spec.usl - mean, mean - spec.lsl) / (3 * stdevWithin), 3);
  }
  if (spec.usl != null && spec.lsl != null && stdevOverall > 0) {
    pp = round((spec.usl - spec.lsl) / (6 * stdevOverall), 3);
    ppk = round(Math.min(spec.usl - mean, mean - spec.lsl) / (3 * stdevOverall), 3);
  }

  // 6. Does the PLC's own pass/fail bit agree with IFL's own product tolerance?
  //
  // Two independent judgements exist on the same cone and nobody had compared
  // them: `in_range` is set by the PLC against a band configured in the
  // controller, while the tolerance in PDAS (setpoint ± offset) is what the
  // product master says. Measured over the 19 production days, they disagree:
  // 1,007
  // cones are simultaneously in-range per the PLC and outside product 14's own
  // 1960 ± 30 g tolerance.
  //
  // Worth surfacing rather than smoothing over. Both numbers are IFL's, so this
  // is a reconciliation question only they can settle — and it is far better
  // raised by us up front than discovered by a UAT tester, at which point it
  // looks like our defect instead of a finding.
  let specAgreement: SpecAgreement | null = null;
  if (spec.usl != null && spec.lsl != null && type === 'cone') {
    const agRes = await req((r) => {
      r.input('usl', mssql.Float, spec.usl);
      r.input('lsl', mssql.Float, spec.lsl);
    }).query<{ n: number; pass_out: number; fail_in: number }>(
      `SELECT COUNT(*) n,
              SUM(CASE WHEN in_range = 1 AND (${col} < @lsl OR ${col} > @usl) THEN 1 ELSE 0 END) pass_out,
              SUM(CASE WHEN in_range = 0 AND ${col} BETWEEN @lsl AND @usl THEN 1 ELSE 0 END) fail_in
       FROM ${table} WHERE ${where}`,
    );
    const a = agRes.recordset[0]!;
    const disagree = Number(a.pass_out ?? 0) + Number(a.fail_in ?? 0);
    specAgreement = {
      evaluated: a.n,
      plcPassedButOutOfTolerance: Number(a.pass_out ?? 0),
      plcFailedButInTolerance: Number(a.fail_in ?? 0),
      disagreementCount: disagree,
      disagreementPct: a.n > 0 ? round((100 * disagree) / a.n, 2) : 0,
      toleranceLabel: `${spec.nominal ?? round((spec.usl + spec.lsl) / 2, 1)} ±${round((spec.usl - spec.lsl) / 2, 1)}${unit}`,
      specSource: spec.source,
    };
  }

  return {
    specAgreement,
    type,
    unit,
    station: stationFilter ? station : null,
    count,
    implausible,
    generation,
    otherGenerationExcluded,
    spansGenerations,
    mean: round(mean, 2),
    median: median == null ? null : round(median, 2),
    stdevOverall: round(stdevOverall, 3),
    stdevWithin: round(stdevWithin, 3),
    bucketMinutes,
    bucketLabel,
    grandMean: round(grandMean, 2),
    sChartCenter: round(stdevWithin, 3),
    xbarOutOfControl,
    nelsonFlagged: subgroups.filter((g) => g.nelson.length > 0).length,
    subgroups,
    stations,
    practicalThresholdG,
    distinguishableStationCount,
    flaggedStationCount,
    histogram,
    spec,
    capability: { cp, cpk, pp, ppk },
    xLimits: {
      valid: xLimitsValid,
      mrBar: round(mrBar, 3),
      sigmaBetween: round(sigmaBetween, 3),
      halfWidth: round(xHalfWidth, 3),
      pairs: movingRanges.length,
    },
  };
}
