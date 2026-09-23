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
 * p̄ = total rejects / total INSPECTED, where inspected = cones + the rejects
 * that are NOT already counted as a cone, pooled across the whole range.
 *
 * CORRECTED 23 Sep 2026 (finding H1's own follow-up defect). H1 (below,
 * unchanged) was right that a rejected cone is still an inspected unit and
 * must be in the denominator; what it got wrong was assuming a reject_event
 * row and a cone_event row are never the same physical cone. Measured
 * directly against the September generation: matching rejectQCS1_TP1U2 to
 * pack1_TP1U2 on (ProductionDate, HangerNum) — the same pair cone_event's own
 * merge key uses — finds a cone_event row for 5,933 of 6,049 quality rejects
 * (98.1 %), 5,925 of those already `in_range = 1` (weighed fine, THEN
 * rejected by QCS downstream). rejectWeight1_TP1U2 matches 41 of 41 the same
 * way. `produced` (cone_event) already counts that cone once; the old
 * `inspected = produced + allRejects` counted it a second time for every
 * reject that has a matching cone — 98%+ of them. Real-data magnitude:
 * 4.393 % shown vs 4.590 % correct on the September generation (6,090 /
 * 138,642 vs 6,090 / 132,668); 2.160 % vs 2.207 % on July. Every reject rate
 * was UNDERSTATED, the opposite direction from what H1 itself fixed.
 *
 * The fix: only a reject with NO matching cone_event row at the same
 * (production_ts_utc_ms, hanger_num) — 116 of 6,049 quality rejects in
 * September, 0 of 41 weight rejects; 14 of 2,900 and 2 of 246 in July — was
 * never counted in `produced`, and it alone is added to the denominator.
 * These are genuinely a different population: scattered roughly 1-9/day
 * across the whole range (not a one-day artefact), consistent with a cone the
 * QCS/weight check caught before it was ever logged as weighed, rather than a
 * bucketing or join-key defect. Re-verify with the same match query before
 * relying on this further — it is measured against the local `_SEP07` dev
 * copy, never against a live read of `DATA_TP1U2`.
 *
 * Holding the denominator the same for the quality series and the weight
 * series is what makes them add up to the combined rate the Rejects screen
 * prints above them (H1's original point, still true): a per-type denominator
 * would make each series individually defensible and the pair impossible to
 * reconcile.
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
 *     With more than one generation in range, `pBar` reports the PREFERRED
 *     one's (see below) and `generations` carries each.
 *   - WHICH generation is preferred, CORRECTED 23 Sep 2026 (WS-GP). Until this
 *     pass, `pBar`/`totalProduced`/`totalRejects` reported the ORDINALLY
 *     NEWEST generation (`Math.max(...perGen.keys())`) with no real-vs-
 *     simulator preference at all — a DIFFERENT policy from
 *     `resolveGenerationScope` (generation.ts), which prefers a REAL
 *     generation over a simulator one regardless of recency. On the live dev
 *     sidecar the simulator's generation (`DATA_TP1U2_SIM`) is ordinally
 *     NEWER than IFL's real September one, so for 21 Aug - 7 Sep this file's
 *     headline `pBar` silently resolved to the simulator's rate while every
 *     other screen fed by `resolveGenerationScope` (Weight, the reports)
 *     resolved to the real one — a genuine three-way disagreement, caught by
 *     `rejectRateThreeWayAgreement.test.ts`'s "ordinally NEWER" case. Fixed
 *     by adopting the SAME real-preferred rule here. At IFL there is no
 *     simulator and their two generations never overlap, so on plant data
 *     this change is a no-op; it only changes the answer on a contaminated
 *     dev sidecar, which is exactly where the old rule was silently wrong.
 *   - RE-EXAMINED 23 Sep 2026 (WS-RG2 independent verification pass). This
 *     file's `simulatorOrdinals`/`isSimulatorRow` block (below) is a LOCAL
 *     COPY of `generation.ts`'s `isSimulator` predicate and
 *     `resolveGenerationScope`'s real-preferred-then-newest-ordinal rule —
 *     the exact shape that produced the WS-GP bug above. It was re-examined
 *     rather than trusted on "it agrees today": `spc.ts` carried the SAME
 *     duplicate until this same pass replaced it with a direct
 *     `resolveGenerationScope` call (its own file header explains why THAT
 *     was safe — one scope, one table, no reshaping needed) — this file's
 *     `perGen` is keyed on ordinal alone, built by bucketing rows this
 *     function already fetched and grouped by generation FOR OTHER REASONS
 *     (the per-bucket partitioning `generation.ts`'s own file header singles
 *     this file out for: "right for a chart whose x-axis can carry two
 *     series"), so swapping in `resolveGenerationScope` would mean a second,
 *     separately-shaped round trip rather than reusing data already in
 *     hand — the same conclusion `spc.ts`'s comment on its own, now-removed,
 *     duplicate reached independently. Additionally, `generation.ts` is
 *     outside this verification pass's file ownership, so even the smaller
 *     step of exporting `isSimulator` for direct reuse was not this pass's
 *     call to make. The copy therefore stays, and
 *     `rejectSpc.generations.test.ts`'s WS-RG2 block calls THIS file's
 *     `getRejectSpc` and `resolveGenerationScope` directly, side by side, on
 *     one fixture an ordinal-only rule would resolve differently on, and
 *     asserts they agree — proven to fail (by deliberately reverting this
 *     block to ordinal-only) before being left in place, so "they agree
 *     today" is a standing, re-run assertion rather than a one-time
 *     observation the way it was before D-17.
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
import { bindConeFilters, bindRejectFilters, type RejectCodeFilter, type RejectFilters } from './rejects.js';

export type RejectBucketSize = 'hour' | 'day';
export type RejectTypeFilter = 'all' | 'quality' | 'weight';

/**
 * The trend's filters beyond the date range (roadmap Phase 5, 14 Sep 2026).
 * The SAME shape rejects.ts binds for the Pareto and the per-day breakdown,
 * so the three cannot select different rejects for one set of controls.
 *
 * `shift` and `tsTo` are what let the Rejects headline count the SAME rejects
 * Line counts through /api/production: Line asked for one shift capped at the
 * plant instant and this service could take neither, so it answered for the
 * whole production day — the same period, two numbers (gap analysis §7).
 *
 * `code` narrows the NUMERATOR only, exactly as `rejectType` does: the
 * denominator is every inspected unit (cones + rejects of every kind) under
 * the other filters, so a code's rate is its share of what was inspected,
 * and the per-code series still add up to the combined rate.
 */
export interface RejectSpcFilters {
  shift?: RejectFilters['shift'];
  tsTo?: string;
  station?: number;
  product?: number;
  code?: RejectCodeFilter;
}

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
  /**
   * Cones + rejects that have NO matching cone_event row (23 Sep 2026 — see
   * the file header): the population `rate` divides by. Most rejects DO
   * match a cone_event row (the same physical cone, weighed then separately
   * rejected) and are already inside `produced`; adding them again would
   * double-count.
   */
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
   * Cones + unmatched rejects across the episode (see RejectBucket.inspected):
   * the denominator that matches `pBar`. attention.ts states an episode's
   * rate and p̄ in the SAME sentence on the Home screen, so dividing by
   * `totalProduced` there put two different denominators side by side (100
   * cones + 10 rejects read "10.0%" against a p̄ computed as 9.1%).
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
  filters: RejectSpcFilters = {},
): Promise<RejectSpcData> {
  // Function, not a constant: the unmatched-rejects query below needs the
  // same expression qualified with the `re.` alias (it joins against
  // sms.cone_event under NOT EXISTS, so the unqualified column names the
  // other queries use here would be ambiguous or bind to the wrong table).
  const bucketExprCone = (alias = '') =>
    bucketSize === 'hour'
      ? `DATEADD(HOUR, DATEDIFF(HOUR, 0, ${alias}production_ts_utc), 0)`
      : `CAST(${alias}shift_date AS DATETIME2(3))`;
  // One filter object for all three queries below. The code filter narrows
  // the numerator only (see RejectSpcFilters); rejectType is folded in as a
  // second numerator-only predicate rather than a separate clause so both
  // are bound the same way through rejects.ts.
  const base: RejectFilters = {
    from, to, shift: filters.shift, tsTo: filters.tsTo, station: filters.station, product: filters.product,
  };
  const numerator: RejectFilters = { ...base, code: filters.code };
  const numeratorIsNarrowed = rejectType !== 'all' || filters.code != null;

  // Epoch id -> generation ordinal. Cones and rejects live in different source
  // tables and so carry DIFFERENT epoch ids for the same rebuild; the ordinal
  // is the number they share (registered together by `sms epoch:accept --all`).
  const genRes = await pool
    .request()
    .query<{ epoch_id: number; generation_ordinal: number; source_db: string | null; provenance: string | null }>(
      `SELECT epoch_id, generation_ordinal, source_db, provenance FROM sms.source_epoch`,
    );
  const genOf = new Map(genRes.recordset.map((r) => [Number(r.epoch_id), Number(r.generation_ordinal)]));
  // Which ORDINALS are simulator generations — same predicate `generation.ts`
  // (`resolveGenerationScope`) and `spc.ts` each carry their own copy of: a
  // generation is simulator when EITHER its recorded provenance says so OR
  // its source_db ends in `_SIM` (the source_db test is the one actually
  // guaranteed to hold — see generation.ts's file header, "IS READ FROM
  // source_db, NOT FROM provenance"). An ordinal's epoch rows are always
  // registered together (`sms epoch:accept --all`), so any one of them
  // deciding "simulator" is enough to mark the whole ordinal.
  const isSimulatorRow = (r: { provenance: string | null; source_db: string | null }) =>
    r.provenance === 'simulator' || /_SIM$/i.test(r.source_db ?? '');
  const simulatorOrdinals = new Set<number>();
  for (const r of genRes.recordset) {
    if (r.generation_ordinal != null && isSimulatorRow(r)) simulatorOrdinals.add(Number(r.generation_ordinal));
  }

  const producedReq = pool.request();
  const producedWhere = bindConeFilters(producedReq, lineId, base);
  const producedRes = await producedReq.query<{ source_epoch: number; bucket_ts: Date; n: number }>(
    `SELECT source_epoch, ${bucketExprCone()} AS bucket_ts, COUNT(*) AS n
       FROM sms.cone_event WHERE ${producedWhere}
      GROUP BY source_epoch, ${bucketExprCone()}`,
  );

  // parameterised even though rejectType is already enum-validated upstream —
  // "parameterised queries only, no exceptions" per project rules, no literal
  // string-building even when provably safe today.
  const typeClause = rejectType === 'all' ? '' : 'AND reject_type=@rejType';
  const rejectsReq = pool.request();
  const rejectsWhere = bindRejectFilters(rejectsReq, lineId, numerator);
  if (rejectType !== 'all') rejectsReq.input('rejType', mssql.VarChar(10), rejectType);
  const rejectsRes = await rejectsReq.query<{ source_epoch: number; bucket_ts: Date; n: number }>(
    `SELECT source_epoch, ${bucketExprCone()} AS bucket_ts, COUNT(*) AS n
       FROM sms.reject_event WHERE ${rejectsWhere} ${typeClause}
      GROUP BY source_epoch, ${bucketExprCone()}`,
  );

  // Every reject, whatever its type or code — used ONLY to decide which
  // buckets exist (see `cells` below): a bucket with a reject but zero cones
  // must still appear. Only needed when the numerator is narrowed; otherwise
  // it is the same query as above, so it is not run twice. This is NOT the
  // denominator population any more — see `unmatchedRes`.
  let allRejectsRes = rejectsRes;
  if (numeratorIsNarrowed) {
    const allReq = pool.request();
    const allWhere = bindRejectFilters(allReq, lineId, base, '', false);
    allRejectsRes = await allReq.query<{ source_epoch: number; bucket_ts: Date; n: number }>(
      `SELECT source_epoch, ${bucketExprCone()} AS bucket_ts, COUNT(*) AS n
         FROM sms.reject_event WHERE ${allWhere}
        GROUP BY source_epoch, ${bucketExprCone()}`,
    );
  }

  // The DENOMINATOR addend (23 Sep 2026 — see file header): rejects of any
  // type or code, under the base filters, that have NO matching cone_event
  // row at the same (production_ts_utc_ms, hanger_num) — cone_event's own
  // merge key (transform.ts `coneKey`). Always run, never narrowed by
  // rejectType/code: the denominator is every inspected unit that `produced`
  // does not already count, regardless of which reject series the numerator
  // asks about. ISNULL on hanger_num matches the ISNULL(...,-999) convention
  // bindRejectFilters already uses for the code predicate, though hanger_num
  // is NOT NULL on every row observed so far.
  const unmatchedReq = pool.request();
  const unmatchedWhere = bindRejectFilters(unmatchedReq, lineId, base, 're.', false);
  const unmatchedRes = await unmatchedReq.query<{ source_epoch: number; bucket_ts: Date; n: number }>(
    `SELECT re.source_epoch, ${bucketExprCone('re.')} AS bucket_ts, COUNT(*) AS n
       FROM sms.reject_event re
      WHERE ${unmatchedWhere}
        AND NOT EXISTS (
          SELECT 1 FROM sms.cone_event ce
           WHERE ce.line_id = re.line_id
             AND ce.production_ts_utc_ms = re.production_ts_utc_ms
             AND ISNULL(ce.hanger_num, -1) = ISNULL(re.hanger_num, -1)
        )
      GROUP BY re.source_epoch, ${bucketExprCone('re.')}`,
  );

  // Cells are (generation, bucket). Keyed on both: the same bucket instant can
  // never hold two generations (they do not overlap in time), but keying on
  // the generation is what lets p̄ be pooled within one and never across.
  type Cell = { source_epoch?: number; bucket_ts: Date; n: number };
  // An epoch the registry does not know (only a fake pool can produce one)
  // falls back to its own id, so the maths still closes.
  const epochOf = (r: Cell) => genOf.get(Number(r.source_epoch ?? 0)) ?? Number(r.source_epoch ?? 0);
  const key = (e: number, t: number) => `${e}|${t}`;
  // SUMMED per (generation, bucket), never `new Map(rows.map(...))`: the two
  // reject tables carry DIFFERENT epoch ids for the same generation (quality
  // 11, weight 12 → one ordinal), so with rejectType 'all', and in the
  // all-rejects denominator under any type filter, a bucket receives one row
  // per epoch. Until 14 Sep 2026 (roadmap Phase 5) the second row silently
  // overwrote the first: the combined trend undercounted, and every
  // type-filtered rate divided by cones + ONE type's rejects instead of both.
  const toMap = (rows: Cell[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(epochOf(r), r.bucket_ts.getTime());
      m.set(k, (m.get(k) ?? 0) + Number(r.n));
    }
    return m;
  };
  const producedMap = toMap(producedRes.recordset);
  const rejectsMap = toMap(rejectsRes.recordset);
  // Cell existence only (which buckets to render) — NOT the denominator, see
  // `unmatchedMap` below.
  const allRejectsMap = toMap(allRejectsRes.recordset);
  // The denominator addend: rejects with no matching cone_event row.
  const unmatchedMap = toMap(unmatchedRes.recordset);
  const cells = new Map<string, { generation: number; t: number }>();
  for (const r of [...producedRes.recordset, ...allRejectsRes.recordset]) {
    const e = epochOf(r);
    const t = r.bucket_ts.getTime();
    cells.set(key(e, t), { generation: e, t });
  }
  const sortedCells = [...cells.values()].sort((a, b) => a.t - b.t || a.generation - b.generation);

  // p̄ = rejects / (cones + unmatched rejects) — see the file header (23 Sep
  // 2026 correction of finding H1). A rejected cone IS still an inspected
  // unit, but 98%+ of rejects are already counted in `produced` because the
  // reject_event row and the cone_event row are the same physical cone,
  // logged twice. Only a reject with no matching cone_event row was never
  // counted and belongs in the denominator.
  //
  // Pooled PER GENERATION — see the header. One p̄ per source epoch in range.
  const perGen = new Map<number, { produced: number; rejects: number; unmatched: number; first: number; last: number }>();
  for (const c of sortedCells) {
    const g = perGen.get(c.generation) ?? { produced: 0, rejects: 0, unmatched: 0, first: c.t, last: c.t };
    g.produced += producedMap.get(key(c.generation, c.t)) ?? 0;
    g.rejects += rejectsMap.get(key(c.generation, c.t)) ?? 0;
    g.unmatched += unmatchedMap.get(key(c.generation, c.t)) ?? 0;
    g.first = Math.min(g.first, c.t);
    g.last = Math.max(g.last, c.t);
    perGen.set(c.generation, g);
  }
  const generations: RejectGeneration[] = [...perGen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([generation, g]) => {
      const inspected = g.produced + g.unmatched;
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
    const inspected = g.produced + g.unmatched;
    pBarOf.set(generation, inspected > 0 ? g.rejects / inspected : null);
  }
  const spansGenerations = perGen.size > 1;
  // Within one generation this IS the pooled p̄, exactly as before. Across a
  // boundary it is the PREFERRED generation's — see the file header's 23 Sep
  // 2026 correction. Prefer a REAL generation over a simulator one
  // regardless of recency (matches `resolveGenerationScope`, generation.ts);
  // only when EVERY present generation is a simulator one do we fall back to
  // picking among them, same as generation.ts's own fallback. `perGen` is
  // keyed on ordinal alone, so `presentOrdinals` cannot contain a duplicate —
  // no tie-break is needed (unlike generation.ts/spc.ts, which key on
  // (source_db, ordinal) and so can see two distinct generations share one
  // ordinal number).
  const presentOrdinals = [...perGen.keys()];
  const realOrdinals = presentOrdinals.filter((o) => !simulatorOrdinals.has(o));
  const preferredOrdinals = realOrdinals.length > 0 ? realOrdinals : presentOrdinals;
  const newestGen = preferredOrdinals.length ? Math.max(...preferredOrdinals) : null;
  const pBar = newestGen == null ? null : (pBarOf.get(newestGen) ?? null);
  // RT-002/RT-029 (23 Sep 2026 red-team audit): `totalProduced`/
  // `totalRejects` used to be summed over EVERY generation's rows
  // (`producedMap`/`rejectsMap` pooled), while `pBar` right above was
  // already correctly scoped to `newestGen` alone — the same generation's
  // own `pBar` figure and `totalRejects/totalProduced` disagreeing on what
  // range they cover. `attention.ts` divides `totalRejects` by
  // `totalInspected` in the SAME sentence as `pBar` (its own file header),
  // so a pooled numerator beside a single-generation p̄ silently mismatched.
  // Now the same figure `pBar` itself is: the newest generation's alone.
  // `generations[]` (below) still carries every generation's own totals
  // un-pooled, for a caller that wants the full breakdown.
  const newestGenTotals = newestGen == null ? null : perGen.get(newestGen);
  const totalProduced = newestGenTotals?.produced ?? 0;
  const totalRejects = newestGenTotals?.rejects ?? 0;

  const buckets: RejectBucket[] = sortedCells.map(({ generation, t }) => {
    const k = key(generation, t);
    const produced = producedMap.get(k) ?? 0;
    const rejects = rejectsMap.get(k) ?? 0;
    // Denominator counts only UNMATCHED rejects (of every type, not just the
    // filtered one) — see the p̄ note in the file header.
    const inspected = produced + (unmatchedMap.get(k) ?? 0);
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
        // `lcl` is kept and returned (rendered as the chart's lower band,
        // reports/reject.ts lclPct / report/shared.tsx qLcl) even though
        // `outOfControl` never fires on it — decided, not overlooked (23 Sep
        // 2026 brief item 3). A rate BELOW lcl is a genuine "unusually good
        // day" signal worth showing on the chart. But `outOfControl` also
        // drives episodes/attention.ts's Home attention list, whose job is to
        // flag something that needs a floor response; an unusually LOW reject
        // rate needs no one's attention, so it stays one-sided rather than
        // firing an "episode" for good days. Two different meanings under one
        // flag would be the wrong fix; this keeps one flag with one meaning
        // and still draws the second number on the chart.
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
