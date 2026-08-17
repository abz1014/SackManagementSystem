/**
 * Weight consistency (Q4/Q5). Distribution + stats + outliers for cones and
 * sacks, computed under a chosen basis (as_recorded | gross | net). The basis
 * toggle makes the gross-vs-net swing visible — the reason Q5 matters: a ~70 g
 * tube on a ~1951 g cone is ~3.6% of every yield figure.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export type Basis = 'as_recorded' | 'gross' | 'net';

export interface Bucket { bucket: number; count: number; }
export interface Outlier { weight: number; shiftDate: string | null; sourceRowId: number | null; }

export interface WeightStats {
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  stdev: number | null;
  unit: 'g' | 'kg';
  bucketSize: number;
  histogram: Bucket[];
  outliers: Outlier[];
}

export interface WeightsData {
  basis: Basis;
  cone: WeightStats & { nominalSetpointG: number; giveawayPerConeG: number | null; giveawayTotalKg: number | null };
  sack: WeightStats;
  note: string;
}

const NOMINAL_CONE_SETPOINT_G = 1950; // most materials 1950–1960; nominal until Q1/Q5

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
  // --- cones (grams, outlier < 1500) / sacks (kg, outlier < 40) ---
  const CONE_OUT = 1500;
  const CONE_BUCKET = 20;
  const SACK_OUT = 40;
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
    r.input('coneOut', mssql.Int, CONE_OUT);
    r.input('coneBucket', mssql.Int, CONE_BUCKET);
    r.input('sackOut', mssql.Int, SACK_OUT);
    r.input('sackBucket', mssql.Int, SACK_BUCKET);
    return r;
  };

  const coneStat = await bind(pool.request()).query<{ n: number; avg: number; mn: number; mx: number; sd: number }>(
    `SELECT COUNT(*) n, AVG(weight_g - @coneAdj) avg, MIN(weight_g - @coneAdj) mn,
            MAX(weight_g - @coneAdj) mx, STDEV(weight_g - @coneAdj) sd
     FROM sms.cone_event WHERE ${dateWhere()} AND weight_g >= @coneOut`,
  );
  const coneHist = await bind(pool.request()).query<{ bucket: number; count: number }>(
    `SELECT FLOOR((weight_g - @coneAdj)/@coneBucket)*@coneBucket bucket, COUNT(*) count
     FROM sms.cone_event WHERE ${dateWhere()} AND weight_g >= @coneOut
     GROUP BY FLOOR((weight_g - @coneAdj)/@coneBucket)*@coneBucket ORDER BY bucket`,
  );
  const coneOut = await bind(pool.request()).query<{ w: number; d: string; id: number }>(
    `SELECT TOP 20 weight_g - @coneAdj w, CONVERT(varchar(10), shift_date, 120) d, source_row_id id
     FROM sms.cone_event WHERE ${dateWhere()} AND (weight_g < @coneOut OR weight_g <= 0) ORDER BY weight_g`,
  );

  const sackStat = await bind(pool.request()).query<{ n: number; avg: number; mn: number; mx: number; sd: number }>(
    `SELECT COUNT(*) n, AVG(weight_kg - @sackAdj) avg, MIN(weight_kg - @sackAdj) mn,
            MAX(weight_kg - @sackAdj) mx, STDEV(weight_kg - @sackAdj) sd
     FROM sms.sack_event WHERE ${dateWhere()} AND weight_kg >= @sackOut`,
  );
  const sackHist = await bind(pool.request()).query<{ bucket: number; count: number }>(
    `SELECT FLOOR((weight_kg - @sackAdj)/@sackBucket)*@sackBucket bucket, COUNT(*) count
     FROM sms.sack_event WHERE ${dateWhere()} AND weight_kg >= @sackOut
     GROUP BY FLOOR((weight_kg - @sackAdj)/@sackBucket)*@sackBucket ORDER BY bucket`,
  );
  const sackOut = await bind(pool.request()).query<{ w: number; d: string; id: number }>(
    `SELECT TOP 20 weight_kg - @sackAdj w, CONVERT(varchar(10), shift_date, 120) d, source_row_id id
     FROM sms.sack_event WHERE ${dateWhere()} AND (weight_kg < @sackOut OR weight_kg <= 0) ORDER BY weight_kg`,
  );

  const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  const cs = coneStat.recordset[0]!;
  const coneAvg = num(cs.avg);
  const giveawayPerConeG = coneAvg == null ? null : Math.round((coneAvg - NOMINAL_CONE_SETPOINT_G) * 10) / 10;
  const giveawayTotalKg = giveawayPerConeG == null ? null : Math.round((giveawayPerConeG * cs.n) / 100) / 10;
  const ss = sackStat.recordset[0]!;

  const mapOut = (rs: { w: number; d: string; id: number }[]): Outlier[] =>
    rs.map((r) => ({ weight: Math.round(Number(r.w) * 100) / 100, shiftDate: r.d, sourceRowId: r.id == null ? null : Number(r.id) }));

  return {
    basis,
    cone: {
      count: cs.n, avg: coneAvg, min: num(cs.mn), max: num(cs.mx), stdev: num(cs.sd),
      unit: 'g', bucketSize: CONE_BUCKET,
      histogram: coneHist.recordset.map((b) => ({ bucket: Number(b.bucket), count: b.count })),
      outliers: mapOut(coneOut.recordset),
      nominalSetpointG: NOMINAL_CONE_SETPOINT_G, giveawayPerConeG, giveawayTotalKg,
    },
    sack: {
      count: ss.n, avg: num(ss.avg), min: num(ss.mn), max: num(ss.mx), stdev: num(ss.sd),
      unit: 'kg', bucketSize: SACK_BUCKET,
      histogram: sackHist.recordset.map((b) => ({ bucket: Number(b.bucket), count: b.count })),
      outliers: mapOut(sackOut.recordset),
    },
    note:
      basis === 'net'
        ? `Net basis: cone tube ${tube} g and sack tare ${tare} kg subtracted. Pending IFL confirmation (Q5).`
        : `Weights shown ${basis}. Toggle to Net to see the tube/tare-adjusted figures (Q4/Q5).`,
  };
}
