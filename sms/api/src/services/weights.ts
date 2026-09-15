/**
 * Weight consistency (Q4/Q5). Distribution + stats + outliers for cones and
 * sacks, computed under a chosen basis (as_recorded | gross | net). The basis
 * toggle makes the gross-vs-net swing visible — the reason Q5 matters: a ~70 g
 * tube on a ~1951 g cone is ~3.6% of every yield figure.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { getPlausibilityRule } from './admin.js';
import { plausibleWhere } from './coneState.js';

export type Basis = 'as_recorded' | 'gross' | 'net';

export interface Bucket { bucket: number; count: number; }
/**
 * `eventId` is the canonical PK (cone_event_id / sack_event_id), which is what
 * the register's permalink takes. It was source_row_id until the 2026-08-05
 * source rebuild made that number name two rows (register.ts, IDENTITY).
 */
export interface Outlier { weight: number; shiftDate: string | null; eventId: number | null; }

export interface WeightStats {
  count: number;
  /**
   * Readings the population rule excluded as implausible (roadmap Phase 4,
   * 14 Sep 2026) — the same figure spc.ts and the reconciliation report.
   * `outliers` below lists a sample of them deliberately.
   */
  implausible: number;
  avg: number | null;
  /**
   * The median of the same population as `avg` (roadmap Phase 9 item 1,
   * 15 Sep 2026). Printed beside the mean because the two disagree exactly
   * when the distribution is skewed â€” a tail of heavy cones pulls the mean
   * up while the typical cone sits where the median says.
   */
  median: number | null;
  min: number | null;
  max: number | null;
  stdev: number | null;
  unit: 'g' | 'kg';
  bucketSize: number;
  histogram: Bucket[];
  outliers: Outlier[];
}

/** Where the nominal the giveaway is measured against actually came from. */
export type NominalSource = 'current_product' | 'fallback';

export interface WeightsData {
  basis: Basis;
  cone: WeightStats & {
    nominalSetpointG: number;
    nominalSource: NominalSource;
    nominalLabel: string | null;
    /** Non-empty = the giveaway figure is NOT safe to quote. */
    provisionalReasons: string[];
    giveawayPerConeG: number | null;
    giveawayTotalKg: number | null;
  };
  sack: WeightStats;
  note: string;
}

/**
 * Last-resort nominal, used only when no product has been selected.
 *
 * This was previously the ONLY reference in the code, hardcoded, and it drives
 * the giveaway kg/day and t/year figures — the most quotable numbers in the app.
 * Two things make that dangerous, so both are now reported instead of hidden:
 *
 *  1. The real setpoint is per-product (the product master holds 1950 and 1960
 *     with ±30/40/50 offsets), so a single constant is wrong for some products
 *     by more than the giveaway it is trying to measure.
 *  2. Q4/Q5 (gross vs net) is still unanswered. Note that the basis TOGGLE no
 *     longer moves the giveaway: since the nominal became basis-aware below
 *     (nominalGross - coneAdj), switching to net shifts the measured average and
 *     the target by the same tube weight, so avg - nominal is invariant. It was
 *     not always so — against the old hardcoded 1950 g fallback the toggle did
 *     swing +1.5 to -68.5 g/cone, and that stale figure survived in the
 *     user-facing caveat long after the code stopped producing it.
 *
 *     The live risk is different and still real: if the product setpoint is
 *     stated on the OPPOSITE basis to the recorded weight, the giveaway is out
 *     by the full tube weight. That is what Q4/Q5 has to settle.
 *
 * Historical rows also carry no product attribution (attribution_method='none'),
 * so applying the currently-selected product's setpoint backwards over the range
 * is an approximation — flagged, not silently applied.
 */
const FALLBACK_CONE_SETPOINT_G = 1950;

export async function getWeights(
  pool: ConnectionPool,
  lineId: number,
  basis: Basis,
  from?: string,
  to?: string,
): Promise<WeightsData> {
  // tube/tare from the active weight_rule
  const wr = await pool.request().input('line', mssql.Int, lineId).query<{ tube: number; tare: number }>(
    `SELECT TOP 1 cone_tube_weight_g AS tube, sack_tare_kg AS tare FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  const tube = Number(wr.recordset[0]?.tube ?? 70);
  const tare = Number(wr.recordset[0]?.tare ?? 0.5);
  const coneAdj = basis === 'net' ? tube : 0;
  const sackAdj = basis === 'net' ? tare : 0;

  const dateWhere = (col = 'shift_date') => {
    const w: string[] = ['line_id=@line'];
    if (from) w.push(`${col} >= @from`);
    if (to) w.push(`${col} <= @to`);
    return w.join(' AND ');
  };
  // --- cones (grams) / sacks (kg): the population is the ONE plausibility
  // rule (coneState.ts plausibleWhere — roadmap Phase 4, 14 Sep 2026). Until
  // then this file used the LOWER bound only, so its average kept the
  // ~2200-2354 g scale-fault population spc.ts drops, and "the app's average
  // cone weight" was two different numbers on two screens. Both bounds now,
  // everywhere a statistic is computed. The `outliers` sample is the one
  // deliberate exception: it LISTS the excluded readings, which is the point
  // of it, and says so with includeImplausible.
  const plausibility = await getPlausibilityRule(pool, lineId);
  const conePlaus = { loG: plausibility.coneLoG, hiG: plausibility.coneHiG };
  const sackPlaus = { loG: plausibility.sackLoKg, hiG: plausibility.sackHiKg };
  const CONE_BUCKET = 20;
  const SACK_BUCKET = 1;

  // Every value that varies at runtime is bound, not interpolated. The tare/tube
  // adjustments come from sms.weight_rule (database-sourced, so not user input)
  // and the thresholds are module constants — nothing here was exploitable. But
  // DEPLOY.md hard rule 3 and CLAUDE.md rule 3 both state "parameterised queries
  // only", and a rule with silent exceptions is worse than no rule: the next
  // person to add a filter here copies the surrounding style. Make the claim true.
  const bind = (r: mssql.Request) => {
    r.input('line', mssql.Int, lineId);
    if (from) r.input('from', mssql.Date, from);
    if (to) r.input('to', mssql.Date, to);
    r.input('coneAdj', mssql.Float, coneAdj);
    r.input('sackAdj', mssql.Float, sackAdj);
    r.input('coneBucket', mssql.Int, CONE_BUCKET);
    r.input('sackBucket', mssql.Int, SACK_BUCKET);
    return r;
  };
  /** A request with the cone population predicate bound; returns [request, predicate]. */
  const coneReq = (opts?: { includeImplausible: boolean }): [mssql.Request, string] => {
    const r = bind(pool.request());
    return [r, plausibleWhere(r, 'weight_g', conePlaus, opts)];
  };
  const sackReq = (opts?: { includeImplausible: boolean }): [mssql.Request, string] => {
    const r = bind(pool.request());
    return [r, plausibleWhere(r, 'weight_kg', sackPlaus, opts)];
  };

  const [csReq, csPlaus] = coneReq();
  const coneStat = await csReq.query<{ n: number; avg: number; mn: number; mx: number; sd: number; excluded: number }>(
    `SELECT COUNT(*) n, AVG(weight_g - @coneAdj) avg, MIN(weight_g - @coneAdj) mn,
            MAX(weight_g - @coneAdj) mx, STDEV(weight_g - @coneAdj) sd,
            (SELECT COUNT(*) FROM sms.cone_event WHERE ${dateWhere()} AND weight_g IS NOT NULL AND NOT (${csPlaus})) excluded
     FROM sms.cone_event WHERE ${dateWhere()} AND ${csPlaus}`,
  );
  // The median, from the SAME population predicate as the statistics above.
  // PERCENTILE_CONT is a window function; TOP 1 keeps one row of the constant.
  const [cmReq, cmPlaus] = coneReq();
  const coneMed = await cmReq.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weight_g - @coneAdj) OVER () med
     FROM sms.cone_event WHERE ${dateWhere()} AND ${cmPlaus}`,
  );
  const [chReq, chPlaus] = coneReq();
  const coneHist = await chReq.query<{ bucket: number; count: number }>(
    `SELECT FLOOR((weight_g - @coneAdj)/@coneBucket)*@coneBucket bucket, COUNT(*) count
     FROM sms.cone_event WHERE ${dateWhere()} AND ${chPlaus}
     GROUP BY FLOOR((weight_g - @coneAdj)/@coneBucket)*@coneBucket ORDER BY bucket`,
  );
  // The excluded readings themselves, lightest first — shown, on purpose.
  const [coReq, coAll] = coneReq({ includeImplausible: true });
  const coneOut = await coReq.query<{ w: number; d: string; id: number }>(
    `SELECT TOP 20 weight_g - @coneAdj w, CONVERT(varchar(10), shift_date, 120) d, cone_event_id id
     FROM sms.cone_event WHERE ${dateWhere()} AND ${coAll} AND NOT (weight_g BETWEEN @plausLo AND @plausHi) ORDER BY weight_g`,
  );

  const [ssReq, ssPlaus] = sackReq();
  const sackStat = await ssReq.query<{ n: number; avg: number; mn: number; mx: number; sd: number; excluded: number }>(
    `SELECT COUNT(*) n, AVG(weight_kg - @sackAdj) avg, MIN(weight_kg - @sackAdj) mn,
            MAX(weight_kg - @sackAdj) mx, STDEV(weight_kg - @sackAdj) sd,
            (SELECT COUNT(*) FROM sms.sack_event WHERE ${dateWhere()} AND weight_kg IS NOT NULL AND NOT (${ssPlaus})) excluded
     FROM sms.sack_event WHERE ${dateWhere()} AND ${ssPlaus}`,
  );
  const [smReq, smPlaus] = sackReq();
  const sackMed = await smReq.query<{ med: number | null }>(
    `SELECT TOP 1 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weight_kg - @sackAdj) OVER () med
     FROM sms.sack_event WHERE ${dateWhere()} AND ${smPlaus}`,
  );
  const [shReq, shPlaus] = sackReq();
  const sackHist = await shReq.query<{ bucket: number; count: number }>(
    `SELECT FLOOR((weight_kg - @sackAdj)/@sackBucket)*@sackBucket bucket, COUNT(*) count
     FROM sms.sack_event WHERE ${dateWhere()} AND ${shPlaus}
     GROUP BY FLOOR((weight_kg - @sackAdj)/@sackBucket)*@sackBucket ORDER BY bucket`,
  );
  const [soReq, soAll] = sackReq({ includeImplausible: true });
  const sackOut = await soReq.query<{ w: number; d: string; id: number }>(
    `SELECT TOP 20 weight_kg - @sackAdj w, CONVERT(varchar(10), shift_date, 120) d, sack_event_id id
     FROM sms.sack_event WHERE ${dateWhere()} AND ${soAll} AND NOT (weight_kg BETWEEN @plausLo AND @plausHi) ORDER BY weight_kg`,
  );

  // Nominal comes from the product actually selected for this line, when one is.
  // The net-basis adjustment must be applied to it too, otherwise a net-basis
  // average is compared against a gross setpoint and the whole tube weight shows
  // up as fake "underfill" — which is most of the -68.5 g/cone seen on net.
  const npRes = await pool.request().input('line', mssql.Int, lineId).query<{
    sp: number | null; descr: string | null; lot: string | null; pid: number | null;
  }>(
    `SELECT TOP 1 p.setpoint_weight_g AS sp, p.description AS descr, p.lot_code AS lot, p.product_id AS pid
     FROM sms.product_timeline t
     JOIN sms.product p ON p.product_id = t.product_id
     WHERE t.line_id = @line AND t.superseded = 0 AND p.setpoint_weight_g IS NOT NULL
     ORDER BY t.effective_from DESC, t.timeline_id DESC`,
  );
  const np = npRes.recordset[0];
  const nominalSource: NominalSource = np?.sp != null ? 'current_product' : 'fallback';
  const nominalGross = np?.sp != null ? Number(np.sp) : FALLBACK_CONE_SETPOINT_G;
  const nominalSetpointG = Math.round((nominalGross - coneAdj) * 10) / 10;
  const nominalLabel =
    np?.sp != null ? (np.descr || np.lot || `product ${np.pid}`) : null;

  // Everything that makes the giveaway figure unquotable, stated explicitly so
  // the UI cannot present it as settled and nobody can quote it by accident.
  const provisionalReasons: string[] = [];
  // Fires on EVERY basis. It used to fire only on 'as_recorded', so choosing
  // Gross silently removed the warning while changing nothing at all — picking
  // a basis is not the same as IFL confirming which one is right.
  provisionalReasons.push(
    basis === 'net'
      ? `Weight basis is unconfirmed (Q4/Q5). Net subtracts the ${tube} g tube from both the measured cone and the ${nominalGross} g setpoint, so the giveaway is unchanged; what is unconfirmed is whether the setpoint itself is stated gross or net. If it is stated on the opposite basis to the recorded weight, this figure is out by ${tube} g/cone.`
      : `Weight basis is unconfirmed (Q4/Q5). Recorded weights are treated as gross${basis === 'gross' ? ' — the Gross and As-recorded views are therefore identical until IFL confirms otherwise' : ''}. If the recorded weight is actually net, or the ${nominalGross} g setpoint is stated on the other basis, this figure is out by the ${tube} g tube weight.`,
  );
  if (nominalSource === 'fallback') {
    provisionalReasons.push(
      `No product selected, so giveaway is measured against a fallback ${FALLBACK_CONE_SETPOINT_G} g. Real setpoints are per-product (1950 and 1960 g in the product master).`,
    );
  } else {
    provisionalReasons.push(
      `Measured against the currently-selected product (${nominalLabel}). Historical cones carry no product attribution, so applying today's setpoint across the whole range is an approximation.`,
    );
  }

  const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  const cs = coneStat.recordset[0]!;
  const coneAvg = num(cs.avg);
  const giveawayPerConeG = coneAvg == null ? null : Math.round((coneAvg - nominalSetpointG) * 10) / 10;
  const giveawayTotalKg = giveawayPerConeG == null ? null : Math.round((giveawayPerConeG * cs.n) / 100) / 10;
  const ss = sackStat.recordset[0]!;

  const mapOut = (rs: { w: number; d: string; id: number }[]): Outlier[] =>
    rs.map((r) => ({ weight: Math.round(Number(r.w) * 100) / 100, shiftDate: r.d, eventId: r.id == null ? null : Number(r.id) }));

  return {
    basis,
    cone: {
      count: cs.n, implausible: Number(cs.excluded ?? 0), avg: coneAvg, median: num(coneMed.recordset?.[0]?.med), min: num(cs.mn), max: num(cs.mx), stdev: num(cs.sd),
      unit: 'g', bucketSize: CONE_BUCKET,
      histogram: coneHist.recordset.map((b) => ({ bucket: Number(b.bucket), count: b.count })),
      outliers: mapOut(coneOut.recordset),
      nominalSetpointG, nominalSource, nominalLabel, provisionalReasons,
      giveawayPerConeG, giveawayTotalKg,
    },
    sack: {
      count: ss.n, implausible: Number(ss.excluded ?? 0), avg: num(ss.avg), median: num(sackMed.recordset?.[0]?.med), min: num(ss.mn), max: num(ss.mx), stdev: num(ss.sd),
      unit: 'kg', bucketSize: SACK_BUCKET,
      histogram: sackHist.recordset.map((b) => ({ bucket: Number(b.bucket), count: b.count })),
      outliers: mapOut(sackOut.recordset),
    },
    note:
      basis === 'net'
        ? `Net basis: cone tube ${tube} g and sack tare ${tare} kg subtracted from both the readings and the setpoint.`
        : basis === 'gross'
          ? `Gross basis: readings as the PLC recorded them. Identical to As-recorded until IFL confirms the basis (Q4/Q5).`
          : `Weights as the PLC recorded them.`,
  };
}
