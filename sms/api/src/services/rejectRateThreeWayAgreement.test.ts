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
