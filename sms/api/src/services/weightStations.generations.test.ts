/**
 * WS-A1 (23 Sep 2026 red-team remediation) — weightStations.ts's own reject-
 * rate queries (rejectRatesByStation's per-station/totals SQL,
 * stationMaterialCounts) carried NO generation predicate at all, so a window
 * spanning IFL's 2026-08-05 table rebuild — or, on this dev copy, the plant
 * simulator's overlapping DATA_TP1U2_SIM generation — pools two physical
 * generations of a table whose identities both start at 1. This is one
 * defect with two faces: the numerator/denominator queries pool rows from
 * both generations directly, AND `getUnmatchedRejects`'s own cross-check
 * (rejects.ts) used to run with no scope at all, so a reject in generation A
 * could be "matched" (and wrongly excluded from the denominator) by a cone in
 * generation B that happens to share (production_ts_utc_ms, hanger_num).
 *
 * This file drives the REAL `getWeightStations` against a dataset-evaluating
 * fake pool (the `rejectRateThreeWayAgreement.test.ts` idiom: route on SQL
 * text and apply exactly the predicates the SQL text actually binds, so a
 * query that forgets to bind a predicate is caught here rather than assumed
 * away by a canned recordset).
 *
 * THE NUMBERS. One real generation (epoch 9 cones / epoch 11 rejects,
 * ordinal 5, `DATA_TP1U2_SEP07`) and one simulator generation (epoch 13
 * cones / epoch 14 rejects, ordinal 6, `DATA_TP1U2_SIM`) share the window:
 *
 *  REAL (station 1): 20 cones, 9 rejects — 5 matched to a real cone
 *    (already counted once), 3 genuinely unmatched, and 1 (`REJECT_CROSS`)
 *    that matches NO real cone but happens to share (ts, hanger) with a
 *    SIMULATOR cone. The correct denominator is therefore 20 + 4 = 24 and
 *    the correct rate is 9/24 = 37.5%.
 *  SIMULATOR (station 1): 1000 cones, 10 rejects, all unmatched within the
 *    simulator's own generation — a low rate (≈0.99%) diluting any pooled
 *    total.
 *
 * `resolveGenerationScope` prefers a REAL generation over a simulator one
 * regardless of recency (generation.ts), so the correct answer for this
 * window is the REAL generation's own 37.5% — never the pooled figure and
 * never the simulator's.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

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

const { getWeightStations } = await import('./weightStations.js');
const { getUnmatchedRejects } = await import('./rejects.js');
const { resolveGenerationScope } = await import('./generation.js');

const ms = (iso: string) => new Date(iso).getTime();
const DAY = '2026-09-10';
const LINE = 1;

interface Row {
  line_id: number;
  shift_date: string;
  shift_code: 'morning';
  production_ts_utc_ms: number;
  source_epoch: number;
  source_station: number | null;
  material_id: number | null;
  hanger_num: number;
}

const REAL_BASE = ms('2026-09-10T06:00:00Z');
const CONES_REAL: Row[] = Array.from({ length: 20 }, (_, i) => ({
  line_id: LINE, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: REAL_BASE + i * 60_000, source_epoch: 9, source_station: 1, material_id: 21, hanger_num: i + 1,
}));
const REJECTS_REAL_MATCHED: Row[] = CONES_REAL.slice(0, 5).map((c) => ({ ...c, source_epoch: 11 }));
const REJECTS_REAL_UNMATCHED: Row[] = Array.from({ length: 3 }, (_, i) => ({
  line_id: LINE, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: REAL_BASE + (900 + i) * 60_000, source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 900 + i,
}));

const SIM_BASE = ms('2026-09-10T06:00:00Z'); // SAME clock as the real generation — the coincidence the cross-match needs
const CONES_SIM: Row[] = Array.from({ length: 1000 }, (_, i) => ({
  line_id: LINE, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: SIM_BASE + i * 60_000, source_epoch: 13, source_station: 1, material_id: 21, hanger_num: i + 1,
}));
// The cross-generation trap: this REAL reject matches NO real cone (no real
// cone carries hanger 500 — CONES_REAL only runs 1..20), but shares its
// (production_ts_utc_ms, hanger_num) with SIM cone #500 (hanger 500, same
// base clock). Correctly scoped to the real generation it is UNMATCHED; an
// unscoped NOT EXISTS check finds the simulator cone and wrongly calls it
// matched.
const REJECT_CROSS: Row = {
  line_id: LINE, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: SIM_BASE + 499 * 60_000, source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 500,
};
const REJECTS_REAL: Row[] = [...REJECTS_REAL_MATCHED, ...REJECTS_REAL_UNMATCHED, REJECT_CROSS];
const REJECTS_SIM: Row[] = Array.from({ length: 10 }, (_, i) => ({
  line_id: LINE, shift_date: DAY, shift_code: 'morning',
  production_ts_utc_ms: SIM_BASE + (2000 + i) * 60_000, source_epoch: 14, source_station: 1, material_id: 21, hanger_num: 2000 + i,
}));

const CONES = [...CONES_REAL, ...CONES_SIM];
const REJECTS = [...REJECTS_REAL, ...REJECTS_SIM];

const REGISTRY = [
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 5, provenance: 'ifl_copy', label: 'September copy' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 5, provenance: 'ifl_copy', label: 'September copy' },
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 6, provenance: 'ifl_copy', label: 'simulator' },
  { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 6, provenance: 'ifl_copy', label: 'simulator' },
];

/** Correct answer: the REAL generation alone. 9 rejects / (20 cones + 4 truly-unmatched) = 37.5%. */
const CORRECT_PCT = Math.round((10000 * 9) / 24) / 100;
/** What today's fully-unscoped code prints: both generations pooled, and the
 * cross-generation false match removes REJECT_CROSS from `unmatchedOf` too. */
const POOLED_CONES = CONES_REAL.length + CONES_SIM.length; // 1020
const POOLED_REJECTS = REJECTS_REAL.length + REJECTS_SIM.length; // 19
const POOLED_UNMATCHED = REJECTS_REAL_UNMATCHED.length + REJECTS_SIM.length; // 3 + 10 = 13 (REJECT_CROSS wrongly matched)
const POOLED_PCT = Math.round((10000 * POOLED_REJECTS) / (POOLED_CONES + POOLED_UNMATCHED)) / 100;

/**
 * Applies exactly the predicates the SQL text binds — an epoch predicate
 * counts only if bound epoch ids appear in the query, so an unscoped query
 * (today's code, before this pass's fix) is exercised honestly rather than
 * assumed to filter.
 */
function evaluate(sql: string, p: Map<string, unknown>): Record<string, unknown>[] {
  if (sql.includes('FROM sms.source_epoch')) return REGISTRY;
  if (sql.includes('GROUP BY source_epoch')) {
    // resolveGenerationScope's present-rows probe (UNION ALL over the three
    // canonical tables). Only cone_event/reject_event carry rows here.
    const rows: Record<string, unknown>[] = [];
    const byEpoch = (table: Row[], tbl: string) => {
      const m = new Map<number, number>();
      for (const r of table) m.set(r.source_epoch, (m.get(r.source_epoch) ?? 0) + 1);
      for (const [epoch_id, n] of m) rows.push({ tbl, epoch_id, n });
    };
    if (sql.includes('FROM sms.cone_event')) byEpoch(CONES, 'cone_event');
    if (sql.includes('FROM sms.reject_event')) byEpoch(REJECTS, 'reject_event');
    if (sql.includes('FROM sms.sack_event')) rows.push();
    return rows;
  }

  const boundEpochIds = new Set<number>();
  for (const v of p.values()) if (typeof v === 'number' && [9, 11, 13, 14].includes(v)) boundEpochIds.add(v);
  const hasEpochPredicate = /source_epoch\s*(=|IN)/.test(sql);

  const inRange = (r: Row) =>
    (!sql.includes('@line') || r.line_id === p.get('line')) &&
    (!sql.includes('@from') || r.shift_date >= String(p.get('from'))) &&
    (!sql.includes('@to') || r.shift_date <= String(p.get('to'))) &&
    (!hasEpochPredicate || boundEpochIds.has(r.source_epoch));

  const matched = (r: Row) =>
    // The cone side of getUnmatchedRejects's NOT EXISTS is itself scoped
    // separately (rejects.ts's `um`-prefixed epochWhere) — so the candidate
    // cone set here must ALSO obey the epoch predicate actually bound on
    // THIS query, not the reject side's.
    CONES.some(
      (c) =>
        c.production_ts_utc_ms === r.production_ts_utc_ms &&
        c.hanger_num === r.hanger_num &&
        (!hasEpochPredicate || boundEpochIds.has(c.source_epoch)),
    );

  // weightStations.ts rejectRatesByStation, query 1: per-station cones/rejects.
  if (sql.includes('FULL OUTER JOIN')) {
    return [{ st: 1, cones: CONES.filter(inRange).length, rejects: REJECTS.filter(inRange).length }];
  }
  // query 2: the line totals.
  if (sql.includes('AS cones') && sql.includes('AS rejects')) {
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
  if (sql.includes('source_station')) return [{ grp: '1', n: rows.length }];
  return [{ grp: 'total', n: rows.length }];
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

describe('getWeightStations across two coexisting source generations', () => {
  it('RED (this pass\'s fix target): pooling two generations prints the wrong line reject rate', async () => {
    const data = await getWeightStations(datasetPool(), LINE, DAY, DAY);
    // The FIXED code must land on the real generation's own truth.
    expect(data.lineRejectRatePct).toBe(CORRECT_PCT);
    expect(data.stations.find((s) => s.station === 1)!.rejectRatePct).toBe(CORRECT_PCT);
    // And it must NOT be the pooled figure a scoping regression would print.
    expect(data.lineRejectRatePct).not.toBe(POOLED_PCT);
  });

  it('states which generation was used and that the simulator rows were excluded', async () => {
    const data = await getWeightStations(datasetPool(), LINE, DAY, DAY);
    expect(data.generationNote.generation?.ordinal).toBe(5);
    expect(data.generationNote.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(data.generationNote.generation?.simulator).toBe(false);
    expect(data.generationNote.spansGenerations).toBe(true);
    // Every simulator row in the window: 1000 cones + 10 rejects.
    expect(data.generationNote.otherGenerationExcluded).toBe(1010);
  });

  it('getUnmatchedRejects itself no longer lets a cone in another generation match a reject in this one', async () => {
    const scope = await resolveGenerationScope(datasetPool(), LINE, { from: DAY, to: DAY });
    expect(scope.generation?.ordinal).toBe(5); // the real generation, chosen over the simulator

    const scoped = await getUnmatchedRejects(datasetPool(), LINE, { from: DAY, to: DAY, scope });
    // 3 genuinely unmatched + REJECT_CROSS, now correctly counted as
    // unmatched because the simulator cone it collides with is out of scope.
    expect(scoped.get('total')).toBe(4);

    // Unscoped (the pre-fix shape, still reachable directly): REJECT_CROSS is
    // wrongly "matched" against the simulator cone, and the simulator's own
    // 10 unmatched rejects are pooled in too.
    const unscoped = await getUnmatchedRejects(datasetPool(), LINE, { from: DAY, to: DAY });
    expect(unscoped.get('total')).toBe(POOLED_UNMATCHED);
    expect(unscoped.get('total')).not.toBe(4);
  });
});
