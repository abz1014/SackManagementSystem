/**
 * Reject control chart (p-chart) — is the reject RATE per bucket within normal
 * variation, or a statistical anomaly? And are anomalies scattered (random)
 * or clustered in time (a burst — a specific event: bad batch, mis-calibration)?
 *
 * This is a p-chart for VARYING sample size: each bucket produces a different
 * number of cones, so each bucket gets its own control limits rather than one
 * flat band — using a pooled/fixed band here would be wrong methodology and
 * would misjudge low-volume hours (e.g. around a stoppage).
 *
 * p̄ = total rejects / total INSPECTED, where inspected = cones + rejects of
 * every type, pooled across the whole range. Two things follow from "of every
 * type", and both are deliberate (finding H1 and its follow-up, Sep 2026):
 * a rejected cone was still an inspected unit, so it belongs in its own
 * denominator; and holding the denominator the same for the quality series
 * and the weight series is what makes them add up to the combined rate the
 * Rejects screen prints above them. A per-type denominator would make each
 * series individually defensible and the pair impossible to reconcile.
 * UCL_i = p̄ + 3·√(p̄(1−p̄)/n_i),  LCL_i = max(0, p̄ − 3·√(p̄(1−p̄)/n_i))
 * A bucket is out-of-control if its rate exceeds its own UCL_i.
 * "Episodes" = runs of 1+ consecutive out-of-control buckets — a run of 2+ is
 * the practical definition of a burst; a lone bucket is an isolated spike.
 *
 * GENERATIONS (SEPT-2026-EPOCH-DECISION §4.4). IFL rebuilt their tables on
 * 2026-08-05; the app DB holds the generation before it and the one after,
 * with a hole between (10 Jul → 5 Aug) and entirely different product
 * attribution on each side. Two consequences, both handled here:
 *   - p̄ is pooled WITHIN a generation, never across the boundary. One band
 *     over both would be a limit that nothing was actually measured against.
 *     With more than one generation in range, `pBar` reports the newest one's
 *     and `generations` carries each.
 *   - "Consecutive" means consecutive in TIME, not adjacent in the array of
 *     buckets that happen to hold data. An out-of-control 10 Jul and an
 *     out-of-control 5 Aug are not one 26-day burst; an episode breaks at any
 *     gap wider than one bucket, and at a generation boundary.
 *
 * The normal approximation behind UCL_i is only valid once n_i·p̄ ≥ 5 (the
 * standard p-chart rule of thumb). Below that it isn't a wider band, it's a
 * DIFFERENT, WRONG DISTRIBUTION — verified on real data: a bucket at the edge
 * of the queried range with n=2 (a partial day where sync coverage starts
 * mid-day) produced UCL=33%, vs ~2.7% for every real full day. One bucket
 * that low-volume then set the y-axis for the entire chart, squashing 20 days
 * of real ~1-2% signal into a sliver — reported as "the chart is broken."
 * Below the threshold we still report the observed rate (it's real) but
 * ucl/lcl/outOfControl are null/false — there is no valid control limit to
 * compare against, not a generous one.
 */
const MIN_EXPECTED_REJECTS_FOR_VALID_LIMITS = 5;
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export type RejectBucketSize = 'hour' | 'day';
export type RejectTypeFilter = 'all' | 'quality' | 'weight';

export interface RejectBucket {
  bucketTs: string;
  /**
   * Source GENERATION the bucket's rows came from (sms.source_epoch
   * .generation_ordinal). Not the epoch id: epochs are per source TABLE, so a
   * September cone carries epoch 9 while a September reject carries 11 — keyed
   * on the epoch id, cones and rejects of the same day could never meet, and
   * every "generation" read as all-cones (p̄ 0) or all-rejects (p̄ 1). The
   * ordinal is what the four tables share for one rebuild, which is why D3
   * kept it. Limits are per generation.
   */
  generation: number;
  /** Cones weighed in the bucket. NOT the rate's denominator — see `inspected`. */
  produced: number;
  /** Cones + rejects of every type: the population `rate` divides by. */
  inspected: number;
  rejects: number;
  rate: number | null;
  ucl: number | null;
  lcl: number | null;
  outOfControl: boolean;
}
export interface RejectEpisode {
  startTs: string;
  endTs: string;
  bucketCount: number;
  totalRejects: number;
  /** Cones only. Do NOT divide by this — see `totalInspected`. */
  totalProduced: number;
  /**
   * Cones + rejects of every type across the episode: the denominator that
   * matches `pBar`. attention.ts states an episode's rate and p̄ in the SAME
   * sentence on the Home screen, so dividing by `totalProduced` there put two
   * different denominators side by side (100 cones + 10 rejects read "10.0%"
   * against a p̄ computed as 9.1%).
   */
  totalInspected: number;
}
/** One source generation's share of the range, with its own p̄. */
export interface RejectGeneration {
  /** generation_ordinal — see RejectBucket.generation. */
  generation: number;
  totalProduced: number;
  totalRejects: number;
  totalInspected: number;
  pBar: number | null;
  firstBucketTs: string;
  lastBucketTs: string;
}
export interface RejectSpcData {
  bucketSize: RejectBucketSize;
  rejectTypeFilter: RejectTypeFilter;
  totalProduced: number;
  totalRejects: number;
  /**
   * Pooled over the range when it lies within ONE source generation. When it
   * spans more than one, this is the NEWEST generation's p̄ — a pooled figure
   * across the 2026-08-05 rebuild would be a limit nothing was measured
   * against — and `generations` carries each generation's own.
   */
  pBar: number | null;
  spansGenerations: boolean;
  generations: RejectGeneration[];
  outOfControlCount: number;
  buckets: RejectBucket[];
  episodes: RejectEpisode[];
}

function round(n: number, dp = 5): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function getRejectSpc(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  bucketSize: RejectBucketSize,
  rejectType: RejectTypeFilter,
): Promise<RejectSpcData> {
  const bucketExprCone =
    bucketSize === 'hour'
      ? 'DATEADD(HOUR, DATEDIFF(HOUR, 0, production_ts_utc), 0)'
      : 'CAST(shift_date AS DATETIME2(3))';

  // Epoch id -> generation ordinal. Cones and rejects live in different source
  // tables and so carry DIFFERENT epoch ids for the same rebuild; the ordinal
  // is the number they share (registered together by `sms epoch:accept --all`).
  const genRes = await pool
    .request()
    .query<{ epoch_id: number; generation_ordinal: number }>(
      `SELECT epoch_id, generation_ordinal FROM sms.source_epoch`,
    );
  const genOf = new Map(genRes.recordset.map((r) => [Number(r.epoch_id), Number(r.generation_ordinal)]));

  const producedRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .query<{ source_epoch: number; bucket_ts: Date; n: number }>(
      `SELECT source_epoch, ${bucketExprCone} AS bucket_ts, COUNT(*) AS n
       FROM sms.cone_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to
       GROUP BY source_epoch, ${bucketExprCone}`,
    );

  // parameterised even though rejectType is already enum-validated upstream —
  // "parameterised queries only, no exceptions" per project rules, no literal
  // string-building even when provably safe today.
  const typeClause = rejectType === 'all' ? '' : 'AND reject_type=@rejType';
  const rejectsReq = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  if (rejectType !== 'all') rejectsReq.input('rejType', mssql.VarChar(10), rejectType);
  const rejectsRes = await rejectsReq.query<{ source_epoch: number; bucket_ts: Date; n: number }>(
    `SELECT source_epoch, ${bucketExprCone} AS bucket_ts, COUNT(*) AS n
     FROM sms.reject_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to ${typeClause}
     GROUP BY source_epoch, ${bucketExprCone}`,
  );

  // Every reject, whatever its type — the DENOMINATOR population. Only needed
  // when a type filter is in play; unfiltered it is the same query as above,
  // so it is not run twice.
  const allRejectsRes =
    rejectType === 'all'
      ? rejectsRes
      : await pool
          .request()
          .input('line', mssql.Int, lineId)
          .input('from', mssql.Date, from)
          .input('to', mssql.Date, to)
          .query<{ source_epoch: number; bucket_ts: Date; n: number }>(
            `SELECT source_epoch, ${bucketExprCone} AS bucket_ts, COUNT(*) AS n
             FROM sms.reject_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to
             GROUP BY source_epoch, ${bucketExprCone}`,
          );

  // Cells are (generation, bucket). Keyed on both: the same bucket instant can
  // never hold two generations (they do not overlap in time), but keying on
  // the generation is what lets p̄ be pooled within one and never across.
  type Cell = { source_epoch?: number; bucket_ts: Date; n: number };
  // An epoch the registry does not know (only a fake pool can produce one)
  // falls back to its own id, so the maths still closes.
  const epochOf = (r: Cell) => genOf.get(Number(r.source_epoch ?? 0)) ?? Number(r.source_epoch ?? 0);
  const key = (e: number, t: number) => `${e}|${t}`;
  const toMap = (rows: Cell[]) => new Map(rows.map((r) => [key(epochOf(r), r.bucket_ts.getTime()), r.n]));
  const producedMap = toMap(producedRes.recordset);
  const rejectsMap = toMap(rejectsRes.recordset);
  const allRejectsMap = toMap(allRejectsRes.recordset);
  const cells = new Map<string, { generation: number; t: number }>();
  for (const r of [...producedRes.recordset, ...allRejectsRes.recordset]) {
    const e = epochOf(r);
    const t = r.bucket_ts.getTime();
    cells.set(key(e, t), { generation: e, t });
  }
  const sortedCells = [...cells.values()].sort((a, b) => a.t - b.t || a.generation - b.generation);

  const totalProduced = [...producedMap.values()].reduce((s, v) => s + v, 0);
  const totalRejects = [...rejectsMap.values()].reduce((s, v) => s + v, 0);
  // p̄ = rejects / (cones + rejects) — a rejected cone was still an inspected
  // unit and belongs in the denominator. Fixed Sep 2026 (finding H1): this
  // used to divide by cones alone, which understated the rate everywhere it
  // fed (this chart, its tooltips, episode detection, the Home attention
  // list) and contradicted Rejects.tsx's own headline formula immediately
  // above it on screen. Real-data magnitude: 5.42% shown vs 5.14% correct on
  // 2026-07-07; 2.208% vs 2.160% over the full 19-day range.
  //
  // Pooled PER GENERATION — see the header. One p̄ per source epoch in range.
  const perGen = new Map<number, { produced: number; rejects: number; allRejects: number; first: number; last: number }>();
  for (const c of sortedCells) {
    const g = perGen.get(c.generation) ?? { produced: 0, rejects: 0, allRejects: 0, first: c.t, last: c.t };
    g.produced += producedMap.get(key(c.generation, c.t)) ?? 0;
    g.rejects += rejectsMap.get(key(c.generation, c.t)) ?? 0;
    g.allRejects += allRejectsMap.get(key(c.generation, c.t)) ?? 0;
    g.first = Math.min(g.first, c.t);
    g.last = Math.max(g.last, c.t);
    perGen.set(c.generation, g);
  }
  const generations: RejectGeneration[] = [...perGen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([generation, g]) => {
      const inspected = g.produced + g.allRejects;
      return {
        generation,
        totalProduced: g.produced,
        totalRejects: g.rejects,
        totalInspected: inspected,
        pBar: inspected > 0 ? round(g.rejects / inspected, 5) : null,
        firstBucketTs: new Date(g.first).toISOString(),
        lastBucketTs: new Date(g.last).toISOString(),
      };
    });
  const pBarOf = new Map<number, number | null>();
  for (const [generation, g] of perGen) {
    const inspected = g.produced + g.allRejects;
    pBarOf.set(generation, inspected > 0 ? g.rejects / inspected : null);
  }
  const spansGenerations = perGen.size > 1;
  // Within one generation this IS the pooled p̄, exactly as before. Across a
  // boundary it is the newest generation's — ordinals advance in time order.
  const newestGen = perGen.size ? Math.max(...perGen.keys()) : null;
  const pBar = newestGen == null ? null : (pBarOf.get(newestGen) ?? null);

  const buckets: RejectBucket[] = sortedCells.map(({ generation, t }) => {
    const k = key(generation, t);
    const produced = producedMap.get(k) ?? 0;
    const rejects = rejectsMap.get(k) ?? 0;
    // Denominator counts rejects of EVERY type, not just the filtered one —
    // see the p̄ note in the file header.
    const inspected = produced + (allRejectsMap.get(k) ?? 0);
    const genPBar = pBarOf.get(generation) ?? null;
    let rate: number | null = null;
    let ucl: number | null = null;
    let lcl: number | null = null;
    let outOfControl = false;
    if (inspected > 0 && genPBar != null) {
      rate = rejects / inspected;
      if (inspected * genPBar >= MIN_EXPECTED_REJECTS_FOR_VALID_LIMITS) {
        const sigma = Math.sqrt((genPBar * (1 - genPBar)) / inspected);
        ucl = genPBar + 3 * sigma;
        lcl = Math.max(0, genPBar - 3 * sigma);
        outOfControl = rate > ucl;
      }
    }
    return {
      bucketTs: new Date(t).toISOString(),
      generation,
      produced,
      inspected,
      rejects,
      rate: rate != null ? round(rate, 5) : null,
      ucl: ucl != null ? round(ucl, 5) : null,
      lcl: lcl != null ? round(lcl, 5) : null,
      outOfControl,
    };
  });

  // episodes: runs of CONSECUTIVE out-of-control buckets. Consecutive in time:
  // buckets exist only where data exists, so array neighbours can be weeks
  // apart across the record's hole. A gap wider than one bucket, or a change
  // of generation, ends the run — otherwise 10 Jul and 5 Aug read as one burst.
  const bucketMs = bucketSize === 'hour' ? 3_600_000 : 86_400_000;
  const contiguous = (a: RejectBucket, b: RejectBucket) =>
    a.generation === b.generation && new Date(b.bucketTs).getTime() - new Date(a.bucketTs).getTime() <= bucketMs;
  const episodes: RejectEpisode[] = [];
  let i = 0;
  while (i < buckets.length) {
    if (!buckets[i]!.outOfControl) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < buckets.length && buckets[j + 1]!.outOfControl && contiguous(buckets[j]!, buckets[j + 1]!)) j++;
    const run = buckets.slice(i, j + 1);
    episodes.push({
      startTs: run[0]!.bucketTs,
      endTs: run[run.length - 1]!.bucketTs,
      bucketCount: run.length,
      totalRejects: run.reduce((s, b) => s + b.rejects, 0),
      totalProduced: run.reduce((s, b) => s + b.produced, 0),
      totalInspected: run.reduce((s, b) => s + b.inspected, 0),
    });
    i = j + 1;
  }

  return {
    bucketSize,
    rejectTypeFilter: rejectType,
    totalProduced,
    totalRejects,
    pBar: pBar != null ? round(pBar, 5) : null,
    spansGenerations,
    generations,
    outOfControlCount: buckets.filter((b) => b.outOfControl).length,
    buckets,
    episodes: episodes.sort((a, b) => b.bucketCount - a.bucketCount || b.totalRejects - a.totalRejects),
  };
}
