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
 *     time buckets (auto-sized to keep ~80 readable points across the range).
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
  xViolates: boolean;
  sViolates: boolean;
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
  count: number;
  mean: number;
  stdevOverall: number; // long-term σ (all points) → Pp/Ppk
  stdevWithin: number; // short-term σ (pooled within-subgroup) → Cp/Cpk
  bucketMinutes: number;
  bucketLabel: string;
  grandMean: number;
  sChartCenter: number; // = stdevWithin
  xbarOutOfControl: number;
  subgroups: Subgroup[];
  stations: StationStat[]; // cone only; [] for sack (no station column)
  practicalThresholdG: number; // |delta| beyond which a station is worth acting on
  distinguishableStationCount: number; // statistically real (often near-all at large n)
  flaggedStationCount: number; // practically significant — the actionable subset
  histogram: HistBin[];
  spec: SpecLimits;
  capability: { cp: number | null; cpk: number | null; pp: number | null; ppk: number | null };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Pick a "nice" bucket size (minutes) so each subgroup holds a STABLE number
 * of events, not merely so the count of buckets looks tidy. Rational subgroups
 * need enough members (~15–25) for the within-subgroup spread to estimate σ
 * reliably; sizing purely by time span breaks on low-rate streams — sacks run
 * ~13× fewer than cones, so a 30-min bucket that holds ~170 cones holds only
 * ~7 sacks (some n=1), producing unstable limits and false out-of-control
 * points. We target ~20 events/subgroup, clamped to a readable bucket count.
 */
function pickBucketMinutes(days: number, count: number): { minutes: number; label: string } {
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
  const totalMinutes = Math.max(1, days) * 24 * 60;
  const TARGET_PER_SUBGROUP = 20;
  const MIN_BUCKETS = 8;
  const MAX_BUCKETS = 72;
  const desiredBuckets = Math.min(MAX_BUCKETS, Math.max(MIN_BUCKETS, Math.round(count / TARGET_PER_SUBGROUP) || MIN_BUCKETS));
  const targetMinutes = totalMinutes / desiredBuckets;
  return NICE.find((b) => b.minutes >= targetMinutes) ?? NICE[NICE.length - 1]!;
}

export async function getSpec(
  pool: ConnectionPool,
  productId: number | null,
  manualUsl: number | null,
  manualLsl: number | null,
  type: SpcType = 'cone',
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
): Promise<SpcData> {
  const table = type === 'cone' ? 'sms.cone_event' : 'sms.sack_event';
  const col = type === 'cone' ? 'weight_g' : 'weight_kg';
  const unit: 'g' | 'kg' = type === 'cone' ? 'g' : 'kg';
  const plaus =
    type === 'cone'
      ? { lo: plausibility.coneLoG, hi: plausibility.coneHiG }
      : { lo: plausibility.sackLoKg, hi: plausibility.sackHiKg };

  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  const where =
    `line_id=@line AND shift_date BETWEEN @from AND @to AND ${col} IS NOT NULL` +
    ` AND ${col} BETWEEN @plausLo AND @plausHi` +
    (shift ? ' AND shift_code=@shift' : '');

  // 1. Overall summary — one pass, no row transfer. Drives the bucket sizing.
  const sumReq = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .input('plausLo', mssql.Float, plaus.lo)
    .input('plausHi', mssql.Float, plaus.hi);
  if (shift) sumReq.input('shift', mssql.VarChar(10), shift);
  const sumRes = await sumReq
    .query<{ n: number; mean: number | null; sd: number | null }>(
      `SELECT COUNT(*) n, AVG(CAST(${col} AS float)) mean, STDEV(CAST(${col} AS float)) sd
       FROM ${table} WHERE ${where}`,
    );
  const summ = sumRes.recordset[0]!;
  const count = summ.n;
  const mean = summ.mean ?? 0;
  const stdevOverall = summ.sd ?? 0;

  // Bucket size depends on the event rate (count), not just the time span —
  // so low-rate sacks get wider buckets and stay statistically stable.
  const { minutes: bucketMinutes, label: bucketLabel } = pickBucketMinutes(days, count);

  const req = (extra?: (r: SqlRequest) => void) => {
    const r = pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('from', mssql.Date, from)
      .input('to', mssql.Date, to)
      .input('bucketMin', mssql.Int, bucketMinutes)
      .input('plausLo', mssql.Float, plaus.lo)
      .input('plausHi', mssql.Float, plaus.hi);
    if (shift) r.input('shift', mssql.VarChar(10), shift);
    extra?.(r);
    return r;
  };

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

  // X̄ limits are per-subgroup (variable n): X̿ ± 3σ_within/√n_i.
  // S limits use the large-sample normal approx σ_within·(1 ± 3/√(2n_i)),
  // valid here since n_i is large (c4 ≈ 1); avoids per-n B3/B4 table lookups.
  const subgroups: Subgroup[] = rawSg.map((g) => {
    const se = g.n > 0 ? stdevWithin / Math.sqrt(g.n) : 0;
    const xUcl = grandMean + 3 * se;
    const xLcl = grandMean - 3 * se;
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
      xViolates: g.mean > xUcl || g.mean < xLcl,
      sViolates,
    };
  });
  const xbarOutOfControl = subgroups.filter((g) => g.xViolates).length;

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
    count,
    mean: round(mean, 2),
    stdevOverall: round(stdevOverall, 3),
    stdevWithin: round(stdevWithin, 3),
    bucketMinutes,
    bucketLabel,
    grandMean: round(grandMean, 2),
    sChartCenter: round(stdevWithin, 3),
    xbarOutOfControl,
    subgroups,
    stations,
    practicalThresholdG,
    distinguishableStationCount,
    flaggedStationCount,
    histogram,
    spec,
    capability: { cp, cpk, pp, ppk },
  };
}
