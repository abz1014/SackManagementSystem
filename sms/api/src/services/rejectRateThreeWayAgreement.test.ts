/**
 * THE THREE-WAY GUARD (23 Sep 2026).
 *
 * One rule — "a reject that matches an existing cone_event row on
 * (production_ts_utc_ms, hanger_num) is the SAME physical cone and must not
 * be added to the denominator a second time" — has now been fixed three
 * separate times, in three separate files, because three separate code paths
 * had each re-derived it:
 *
 *   1. rejectSpc.ts   (the Rejects screen's p-chart)          — 4f68945
 *   2. report.ts      (management summary / daily / product /  — ede05e9
 *                      sack reports, via production.ts)
 *   3. weightStations.ts (the Weight screen's per-station and  — this pass
 *                      line reject rate)
 *
 * Between fixes 2 and 3 the application printed 4.590% on Rejects and the
 * management summary and 4.393% on Weight for the same September period.
 * `reportRejectRateAgreement.test.ts` pins 1 against 2; this file pins all
 * THREE against one another, so a fourth re-derivation cannot ship quietly.
 *
 * The dataset deliberately contains rejects that DO and do NOT match a cone
 * row: a dataset where every reject is unmatched cannot tell the correct
 * formula from the old one, because they agree in that special case.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const ms = (iso: string) => new Date(iso).getTime();
const DAY = '2026-09-10';

interface Row {
  line_id: number;
  shift_date: string;
  shift_code: 'morning';
  production_ts_utc_ms: number;
  source_epoch: number;
  source_station: number | null;
  material_id: number | null;
  hanger_num: number;
  in_range?: boolean;
}

// 20 cones, all at station 1. 8 rejects: 5 share a (production_ts_utc_ms,
// hanger_num) with an existing cone (already counted once in `cones`); 3 do
// not. Correct denominator: 20 + 3 = 23, NOT 20 + 8 = 28.
const CONES: Row[] = Array.from({ length: 20 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: ms('2026-09-10T06:00:00Z') + i * 60_000,
  source_epoch: 9, source_station: 1, material_id: 21, in_range: true, hanger_num: i + 1,
}));
const MATCHED_REJECTS: Row[] = CONES.slice(0, 5).map((c) => ({ ...c, source_epoch: 11 }));
const UNMATCHED_REJECTS: Row[] = Array.from({ length: 3 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: ms('2026-09-10T09:00:00Z') + i * 60_000,
  source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 900 + i,
}));
const REJECTS: Row[] = [...MATCHED_REJECTS, ...UNMATCHED_REJECTS];
const REGISTRY = [{ epoch_id: 9, generation_ordinal: 5 }, { epoch_id: 11, generation_ordinal: 5 }];

/** Expected on every path: 8 / (20 + 3). */
const CORRECT = 8 / 23;
/** What the pre-fix denominator (cones + EVERY reject) produced: 8 / 28. */
const OLD_BUGGY = 8 / 28;

// The DB-backed dependencies getWeightStations pulls in that are NOT about
// reject rates. Same partial-mock idiom as weightStations.test.ts.
vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({ days: 1, stations: [{ station: 1, n: 20, grandMean: 1950, days: [] }] }),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', () => ({
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
vi.mock('./productAt.js', () => ({
  loadProductTimeline: async () => ({ entries: [], at: () => null, isEmpty: true }),
  limitsOf: () => null,
}));
vi.mock('./productLimits.js', () => ({
  loadProductCatalogue: async () => ({
    product: () => null, versionAt: () => null, limitsAt: () => null,
    latest: () => null, productIds: () => [], versionsAscending: () => [], isEmpty: true,
  }),
  limitsFromVersion: () => null,
}));

const { getProduction } = await import('./production.js');
const { toReportLine } = await import('./report.js');
const { getRejectSpc } = await import('./rejectSpc.js');
const { getWeightStations } = await import('./weightStations.js');

/**
 * One in-memory dataset served to every query all three services issue. The
 * point of routing on the SQL text rather than on call order is that each
 * service keeps its own real query — nothing about the denominator is
 * reimplemented here except the NOT EXISTS match itself, which is applied
 * uniformly to any query that asks for it.
 */
function evaluate(sql: string, p: Map<string, unknown>): Record<string, unknown>[] {
  if (sql.includes('FROM sms.source_epoch')) return REGISTRY;
  if (sql.includes('FROM sms.weight_rule') || sql.includes('FROM sms.sack_event')) return [];

  const inRange = (r: Row) =>
    (!sql.includes('@line') || r.line_id === p.get('line')) &&
    (!sql.includes('@from') || r.shift_date >= String(p.get('from'))) &&
    (!sql.includes('@to') || r.shift_date <= String(p.get('to')));
  const matched = (r: Row) =>
    CONES.some((c) => c.production_ts_utc_ms === r.production_ts_utc_ms && c.hanger_num === r.hanger_num);

  // weightStations.ts rejectRatesByStation, query 1: per-station cones and
  // rejects, one row per station.
  if (sql.includes('FULL OUTER JOIN')) {
    return [{ st: 1, cones: CONES.filter(inRange).length, rejects: REJECTS.filter(inRange).length }];
  }
  // ...query 2: the line totals, counted without the station filter.
  if (sql.includes('AS cones')) {
    return [{ cones: CONES.filter(inRange).length, rejects: REJECTS.filter(inRange).length }];
  }
  // weightStations.ts stationMaterialCounts.
  if (sql.includes('material_id mat')) {
    return [{ st: 1, mat: 21, n: CONES.filter(inRange).length }];
  }

  const table = sql.includes('FROM sms.reject_event') ? REJECTS : sql.includes('FROM sms.cone_event') ? CONES : null;
  if (!table) throw new Error(`unexpected query: ${sql}`);
  let rows = table.filter(inRange);
  if (sql.includes('NOT EXISTS') && sql.includes('sms.cone_event')) rows = rows.filter((r) => !matched(r));

  // rejectSpc.ts's bucketed form.
  if (sql.includes('AS bucket_ts')) {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.source_epoch}|${r.shift_date}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].map(([k, rs]) => {
      const [epoch, day] = k.split('|');
      return { source_epoch: Number(epoch), bucket_ts: new Date(`${day}T00:00:00.000Z`), n: rs.length };
    });
  }
  // getUnmatchedRejects grouped by station (weightStations.ts) vs its
  // ungrouped 'total' (production.ts) — every row here is station 1.
  if (sql.includes('source_station')) return [{ grp: '1', n: rows.length }];
  return [{ grp: 'total', n: rows.length, inr: rows.filter((r) => r.in_range).length }];
}

function datasetPool(): ConnectionPool {
  return {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => ({ recordset: evaluate(sql, inputs) }),
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('every reject rate in the application agrees on the same period', () => {
  it('Rejects (rejectSpc), the reports (report.ts) and Weight (weightStations) print one number', async () => {
    const prod = await getProduction(datasetPool(), 1, { from: DAY, to: DAY, groupBy: 'none' });
    const reportPct = toReportLine(prod.rows[0]!).rejectRatePct;
    const spc = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'all');
    const weight = await getWeightStations(datasetPool(), 1, DAY, DAY);

    // Sanity: the raw counts this whole test rests on.
    expect(prod.rows[0]!.cones).toBe(20);
    expect(prod.rows[0]!.rejectedCones).toBe(8);
    expect(prod.rows[0]!.unmatchedRejects).toBe(3);

    // All three, to the two decimals the screens actually print.
    const pct = Math.round(CORRECT * 10000) / 100;
    expect(reportPct).toBe(pct);
    expect(Math.round((spc.pBar ?? 0) * 10000) / 100).toBe(pct);
    expect(weight.lineRejectRatePct).toBe(pct);

    // And the per-station rate on the same screen, which is where the Weight
    // copy of the defect actually lived.
    expect(weight.stations.find((s) => s.station === 1)!.rejectRatePct).toBe(pct);

    // None of them may be the old cones + every reject figure.
    const oldPct = Math.round(OLD_BUGGY * 10000) / 100;
    expect(pct).not.toBe(oldPct);
    for (const v of [reportPct, weight.lineRejectRatePct, weight.stations[0]!.rejectRatePct]) {
      expect(v).not.toBe(oldPct);
    }
  });
});

/**
 * THE TWO-GENERATION CASE (WS-A1, 23 Sep 2026 review) — added because the
 * section above is a valid regression guard for the DENOMINATOR arithmetic
 * but, with only one source generation in its fixture, cannot fail for the
 * reason this file exists: a future worker unscoping any ONE of the three
 * paths would leave it green, because "pooled" and "scoped" are the same
 * number when there is nothing else to pool. That is exactly the failure
 * shape this audit found four other times (see this file's own review
 * thread) — a guard that could not catch what it was named for.
 *
 * A second, independent generation (the plant simulator's own, on this dev
 * copy) is added SIDE BY SIDE with the first. Its own rejects are all
 * matched to its own cones, deliberately, so this fixture does NOT exercise
 * production.ts's own `unmatchedFilters` (getUnmatchedRejects call inside
 * getProduction, line ~442) — that call carries no `scope` at all, a real
 * gap in a file this workstream does not own (production.ts belongs to
 * WS-P). With the simulator generation fully self-matched, whether that one
 * unscoped NOT EXISTS check is confined to one generation or run over both
 * makes no numeric difference here (0 either way), so this fixture proves
 * the POOLING defect (cones/rejects counted across two physical generations)
 * cleanly, without also asserting on a different file's separate gap.
 */
const REAL_TWO_GEN_CONES: Row[] = Array.from({ length: 20 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: ms('2026-09-10T06:00:00Z') + i * 60_000,
  source_epoch: 9, source_station: 1, material_id: 21, in_range: true, hanger_num: i + 1,
}));
const REAL_TWO_GEN_MATCHED_REJECTS: Row[] = REAL_TWO_GEN_CONES.slice(0, 5).map((c) => ({ ...c, source_epoch: 11 }));
const REAL_TWO_GEN_UNMATCHED_REJECTS: Row[] = Array.from({ length: 3 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: ms('2026-09-10T09:00:00Z') + i * 60_000,
  source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 900 + i,
}));
const REAL_TWO_GEN_REJECTS: Row[] = [...REAL_TWO_GEN_MATCHED_REJECTS, ...REAL_TWO_GEN_UNMATCHED_REJECTS];

// The simulator's own generation: a much larger, much cleaner population
// (low reject rate, fully self-matched) — the shape that DILUTES a pooled
// rate rather than merely shifting it, matching what the live dev copy
// actually shows over 21 Aug - 7 Sep.
const SIM_BASE = ms('2026-09-10T14:00:00Z'); // same production day, different clock — no accidental (ts, hanger) collision with the real rows above
const SIM_CONES: Row[] = Array.from({ length: 1000 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: SIM_BASE + i * 60_000, source_epoch: 13, source_station: 1, material_id: 21, in_range: true, hanger_num: i + 1,
}));
// All 10 simulator rejects match a simulator cone — see this section's file
// header for why that specific choice keeps production.ts's own unscoped
// unmatched-rejects addend from contaminating this fixture's assertions.
const SIM_REJECTS: Row[] = SIM_CONES.slice(0, 10).map((c) => ({ ...c, source_epoch: 14 }));

const TWO_GEN_CONES: Row[] = [...REAL_TWO_GEN_CONES, ...SIM_CONES];
const TWO_GEN_REJECTS: Row[] = [...REAL_TWO_GEN_REJECTS, ...SIM_REJECTS];
// ORDINALS DELIBERATELY CHOSEN SO THE REAL GENERATION IS ALSO THE NEWEST ONE
// PRESENT (6 > 5) — NOT an accident, and NOT what the live dev sidecar
// actually has (there, the simulator's overlapping generation is ordinal 4,
// NEWER than the real September generation's ordinal 3). Found while wiring
// this fixture up: `resolveGenerationScope` (generation.ts, used by
// weightStations.ts and production.ts) prefers a REAL generation "even when
// the simulator is the newer generation" (its own file header) — but
// `getRejectSpc` (rejectSpc.ts:320, `newestGen = Math.max(...perGen.keys())`)
// picks the NEWEST ORDINAL headline pBar with NO real-vs-simulator
// preference at all. Those are two DIFFERENT selection policies. On the live
// dev sidecar today, for the 21 Aug - 7 Sep window, they resolve to two
// DIFFERENT generations — rejectSpc.ts's own newest-ordinal rule currently
// picks the SIMULATOR's pBar as the Rejects screen's headline, while this
// fix (and production.ts's) picks the REAL generation. That is a genuine,
// separate, currently-live three-way disagreement, and it is NOT the
// pooling defect this workstream (WS-A1) fixes and NOT a file this
// workstream owns (rejectSpc.ts is a parallel worker's). Ordinals here are
// set real-newest so THIS test proves what WS-A1 is actually responsible
// for — that weightStations.ts and production.ts agree once both are
// generation-scoped, and that a revert of EITHER one's scoping is caught —
// without also asserting on rejectSpc.ts's separate policy question, which
// is reported to the coordinator as its own finding rather than fixed or
// hidden here.
const TWO_GEN_REGISTRY = [
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 6, provenance: 'ifl_copy', label: 'September copy' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 6, provenance: 'ifl_copy', label: 'September copy' },
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 5, provenance: 'simulator', label: 'simulator' },
  { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 5, provenance: 'simulator', label: 'simulator' },
];
/** resolveGenerationScope prefers a REAL generation over a simulator one regardless of recency (generation.ts). */
const TWO_GEN_CORRECT = 8 / 23; // the real generation's own truth — identical arithmetic to the single-generation case above
/** What pooling both generations (the pre-fix / unscoped shape) prints: 18 rejects / (1020 cones + 3 real-unmatched). */
const TWO_GEN_POOLED = 18 / 1023;

/**
 * Same routing idiom as `evaluate` above, extended to answer
 * `resolveGenerationScope`'s own two queries (the present-rows UNION ALL
 * probe, marked by its `AS tbl` column alias — unique to that query, unlike
 * `AS bucket_ts` or `AS grp` elsewhere in this file — and the WHERE-bound
 * `sms.source_epoch` read) and to apply an epoch predicate ONLY when the SQL
 * text actually binds one, exactly as `weightStations.generations.test.ts`
 * does: an unscoped query (a reverted fix) is exercised honestly rather than
 * assumed to filter.
 */
function evaluateTwoGen(sql: string, p: Map<string, unknown>): Record<string, unknown>[] {
  // resolveGenerationScope's present-rows probe MUST be recognised before
  // any other branch below — it is a UNION ALL whose combined text also
  // contains "FROM sms.sack_event", which would otherwise hit the
  // empty-recordset branch two lines down and starve the scope resolver.
  if (sql.includes('AS tbl')) {
    const rows: Record<string, unknown>[] = [];
    const byEpoch = (table: Row[], tbl: string) => {
      const m = new Map<number, number>();
      for (const r of table) m.set(r.source_epoch, (m.get(r.source_epoch) ?? 0) + 1);
      for (const [epoch_id, n] of m) rows.push({ tbl, epoch_id, n });
    };
    if (sql.includes('FROM sms.cone_event')) byEpoch(TWO_GEN_CONES, 'cone_event');
    if (sql.includes('FROM sms.reject_event')) byEpoch(TWO_GEN_REJECTS, 'reject_event');
    return rows;
  }
  if (sql.includes('FROM sms.source_epoch')) return TWO_GEN_REGISTRY;
  if (sql.includes('FROM sms.weight_rule') || sql.includes('FROM sms.sack_event')) return [];

  const boundEpochIds = new Set<number>();
  for (const v of p.values()) if (typeof v === 'number' && [9, 11, 13, 14].includes(v)) boundEpochIds.add(v);
  const hasEpochPredicate = /source_epoch\s*(=|IN)/.test(sql);

  const inRange = (r: Row) =>
    (!sql.includes('@line') || r.line_id === p.get('line')) &&
    (!sql.includes('@from') || r.shift_date >= String(p.get('from'))) &&
    (!sql.includes('@to') || r.shift_date <= String(p.get('to'))) &&
    (!hasEpochPredicate || boundEpochIds.has(r.source_epoch));
  const matched = (r: Row) =>
    TWO_GEN_CONES.some(
      (c) =>
        c.production_ts_utc_ms === r.production_ts_utc_ms &&
        c.hanger_num === r.hanger_num &&
        (!hasEpochPredicate || boundEpochIds.has(c.source_epoch)),
    );

  if (sql.includes('FULL OUTER JOIN')) {
    return [{ st: 1, cones: TWO_GEN_CONES.filter(inRange).length, rejects: TWO_GEN_REJECTS.filter(inRange).length }];
  }
  if (sql.includes('AS cones') && sql.includes('AS rejects')) {
    return [{ cones: TWO_GEN_CONES.filter(inRange).length, rejects: TWO_GEN_REJECTS.filter(inRange).length }];
  }
  if (sql.includes('material_id mat')) {
    return [{ st: 1, mat: 21, n: TWO_GEN_CONES.filter(inRange).length }];
  }

  const table = sql.includes('FROM sms.reject_event') ? TWO_GEN_REJECTS : sql.includes('FROM sms.cone_event') ? TWO_GEN_CONES : null;
  if (!table) throw new Error(`unexpected query: ${sql}`);
  let rows = table.filter(inRange);
  if (sql.includes('NOT EXISTS') && sql.includes('sms.cone_event')) rows = rows.filter((r) => !matched(r));

  if (sql.includes('AS bucket_ts')) {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.source_epoch}|${r.shift_date}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].map(([k, rs]) => {
      const [epoch, day] = k.split('|');
      return { source_epoch: Number(epoch), bucket_ts: new Date(`${day}T00:00:00.000Z`), n: rs.length };
    });
  }
  if (sql.includes('source_station')) return [{ grp: '1', n: rows.length }];
  return [{ grp: 'total', n: rows.length, inr: rows.filter((r) => r.in_range).length }];
}

function twoGenPool(): ConnectionPool {
  return {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => ({ recordset: evaluateTwoGen(sql, inputs) }),
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('the three paths still agree when TWO source generations coexist in the window', () => {
  it('Rejects, the reports and Weight all land on the REAL generation alone, never the pooled figure', async () => {
    const prod = await getProduction(twoGenPool(), 1, { from: DAY, to: DAY, groupBy: 'none' });
    const reportPct = toReportLine(prod.rows[0]!).rejectRatePct;
    const spc = await getRejectSpc(twoGenPool(), 1, DAY, DAY, 'day', 'all');
    const weight = await getWeightStations(twoGenPool(), 1, DAY, DAY);

    // Sanity: the real generation's own counts, untouched by the simulator's
    // 1,000 cones sitting in the same window.
    expect(prod.rows[0]!.cones).toBe(20);
    expect(prod.rows[0]!.rejectedCones).toBe(8);
    expect(prod.rows[0]!.unmatchedRejects).toBe(3);

    const pct = Math.round(TWO_GEN_CORRECT * 10000) / 100;
    expect(reportPct).toBe(pct);
    expect(Math.round((spc.pBar ?? 0) * 10000) / 100).toBe(pct);
    expect(weight.lineRejectRatePct).toBe(pct);
    expect(weight.stations.find((s) => s.station === 1)!.rejectRatePct).toBe(pct);

    // None of them may be the pooled figure a scoping regression on ANY of
    // the three paths would print — 18 rejects diluted by the simulator's
    // extra 1,000 cones.
    const pooledPct = Math.round(TWO_GEN_POOLED * 10000) / 100;
    expect(pct).not.toBe(pooledPct);
    for (const v of [reportPct, weight.lineRejectRatePct, weight.stations.find((s) => s.station === 1)!.rejectRatePct]) {
      expect(v).not.toBe(pooledPct);
    }
  });
});
