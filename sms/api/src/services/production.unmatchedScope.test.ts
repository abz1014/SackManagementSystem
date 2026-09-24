/**
 * RT24-02 (24 Sep 2026). `getProduction` (production.ts) resolves ONE
 * generation scope for the whole response and threads it through every
 * cone/reject/sack query via `bindFilters` — except the `unmatchedFilters`
 * bag built at ~442-446 for `getUnmatchedRejects`, which carries `from`,
 * `to`, `shift`, `tsTo`, `station`, `product` but NOT `scope`. Per
 * `rejects.ts`'s own `RejectFilters.scope` doc, an omitted `scope` falls
 * back to `UNSCOPED` inside `getUnmatchedRejects` — so the ONE query in this
 * file that is deliberately NOT scoped like every sibling query pools
 * unmatched rejects across source generations, exactly the defect
 * `weightStations.ts`'s WS-A1 fix (23 Sep 2026, `weightStations.generations
 * .test.ts`) closed in that file. The correct pattern, already proven
 * there: pass `scope: resolvedScope` on the filter bag.
 *
 * Two symptoms, both driven by the SAME real+simulator dataset idiom
 * `weightStations.generations.test.ts` and `rejectRateThreeWayAgreement
 * .test.ts` use (a dataset-evaluating fake pool, routed on SQL text):
 *
 *  1. A day that has ZERO rows in the resolved (real) generation, but DOES
 *     have unmatched-simulator-generation rejects, must not appear as a
 *     phantom `byDay` row at all — `getProduction`'s own `row()` merge
 *     creates a group the moment ANY of cones/rejects/unmatchedOf mentions
 *     it (~530-537), so an unscoped `unmatchedOf` reaching into a day the
 *     scoped cone/reject queries never touched manufactures a row with
 *     `cones: 0, rejectedCones: 0, unmatchedRejects: <simulator count>`.
 *  2. On the day that DOES belong to the resolved generation,
 *     `unmatchedRejects` must count only that generation's own unmatched
 *     rejects — not inflated by a cross-generation reject that an unscoped
 *     NOT EXISTS wrongly calls "matched" against a foreign-generation cone
 *     (the `REJECT_CROSS` trap `weightStations.generations.test.ts` uses),
 *     nor by pooling in the simulator's own unmatched count.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('./coneState.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./coneState.js')>()),
}));

const { getProduction } = await import('./production.js');
const { getUnmatchedRejects } = await import('./rejects.js');
const { resolveGenerationScope } = await import('./generation.js');

const ms = (iso: string) => new Date(iso).getTime();
const LINE = 1;
const FROM = '2026-09-10';
const TO = '2026-09-11';

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

// REAL generation, day 2026-09-10.
const REAL_BASE = ms('2026-09-10T06:00:00Z');
const CONES_REAL: Row[] = Array.from({ length: 5 }, (_, i) => ({
  line_id: LINE, shift_date: '2026-09-10', shift_code: 'morning',
  production_ts_utc_ms: REAL_BASE + i * 60_000, source_epoch: 9, source_station: 1, material_id: 21, hanger_num: i + 1,
}));
const REJECTS_REAL_MATCHED: Row[] = CONES_REAL.slice(0, 2).map((c) => ({ ...c, source_epoch: 11 }));
const REJECTS_REAL_UNMATCHED: Row[] = Array.from({ length: 3 }, (_, i) => ({
  line_id: LINE, shift_date: '2026-09-10', shift_code: 'morning',
  production_ts_utc_ms: REAL_BASE + (900 + i) * 60_000, source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 900 + i,
}));
// Cross-generation trap: matches NO real cone (hanger 500 is outside 1..5)
// but shares (ts, hanger) with a SIMULATOR cone on the SAME clock base.
const REJECT_CROSS: Row = {
  line_id: LINE, shift_date: '2026-09-10', shift_code: 'morning',
  production_ts_utc_ms: REAL_BASE + 499 * 60_000, source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 500,
};
const REJECTS_REAL: Row[] = [...REJECTS_REAL_MATCHED, ...REJECTS_REAL_UNMATCHED, REJECT_CROSS];

// SIMULATOR generation, entirely on a DIFFERENT day (2026-09-11) that the
// real generation never touches — the phantom-row probe.
const SIM_BASE = ms('2026-09-10T06:00:00Z'); // same clock as real, for the cross-match
const CONES_SIM: Row[] = Array.from({ length: 500 }, (_, i) => ({
  line_id: LINE, shift_date: '2026-09-11', shift_code: 'morning',
  production_ts_utc_ms: SIM_BASE + i * 60_000, source_epoch: 13, source_station: 1, material_id: 21, hanger_num: i + 1,
}));
const REJECTS_SIM: Row[] = Array.from({ length: 8 }, (_, i) => ({
  line_id: LINE, shift_date: '2026-09-11', shift_code: 'morning',
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

function evaluate(sql: string, p: Map<string, unknown>): Record<string, unknown>[] {
  if (sql.includes('FROM sms.source_epoch')) return REGISTRY;
  if (sql.includes('GROUP BY source_epoch')) {
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
  if (sql.includes('FROM sms.weight_rule')) return [];

  const boundEpochIds = new Set<number>();
  for (const v of p.values()) if (typeof v === 'number' && [9, 11, 13, 14].includes(v)) boundEpochIds.add(v);
  const hasEpochPredicate = /source_epoch\s*(=|IN)/.test(sql);

  const inRange = (r: Row) =>
    (!sql.includes('@line') || r.line_id === p.get('line')) &&
    (!sql.includes('@from') || r.shift_date >= String(p.get('from'))) &&
    (!sql.includes('@to') || r.shift_date <= String(p.get('to'))) &&
    (!hasEpochPredicate || boundEpochIds.has(r.source_epoch));

  const matched = (r: Row) =>
    CONES.some(
      (c) =>
        c.production_ts_utc_ms === r.production_ts_utc_ms &&
        c.hanger_num === r.hanger_num &&
        (!hasEpochPredicate || boundEpochIds.has(c.source_epoch)),
    );

  if (sql.includes('FROM sms.sack_event')) return [];

  const table = sql.includes('FROM sms.reject_event') ? REJECTS : sql.includes('FROM sms.cone_event') ? CONES : null;
  if (!table) throw new Error(`unexpected query: ${sql}`);
  let rows = table.filter(inRange);
  if (sql.includes('NOT EXISTS') && sql.includes('sms.cone_event')) rows = rows.filter((r) => !matched(r));

  // day-grouped aggregate, matching production.ts's groupExpr('day') /
  // unmatchedGroupExpr('day') shapes.
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byDay.get(r.shift_date) ?? [];
    arr.push(r);
    byDay.set(r.shift_date, arr);
  }
  return [...byDay.entries()].map(([grp, rs]) => ({
    grp,
    n: rs.length,
    inr: rs.filter((r) => r.hanger_num % 2 === 0).length, // arbitrary, unused by this test
  }));
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

describe('getProduction across two coexisting source generations (RT24-02)', () => {
  it('RED (this pass\'s fix target): an unscoped unmatched-reject query manufactures a phantom byDay row for the excluded generation', async () => {
    const data = await getProduction(datasetPool(), LINE, { from: FROM, to: TO, groupBy: 'day' });
    // Correctly scoped: only 2026-09-10 (the real generation's own day)
    // should appear. The simulator's day, 2026-09-11, has zero real-
    // generation cones or rejects and must not surface as a row at all.
    const days = data.rows.map((r) => r.group).sort();
    expect(days).toEqual(['2026-09-10']);
  });

  it('counts only the resolved generation\'s own unmatched rejects on the real day (no cross-generation false match, no simulator pooling)', async () => {
    const data = await getProduction(datasetPool(), LINE, { from: FROM, to: TO, groupBy: 'day' });
    const row10 = data.rows.find((r) => r.group === '2026-09-10');
    expect(row10).toBeDefined();
    // 3 genuinely unmatched + REJECT_CROSS, correctly unmatched once scoped
    // (its would-be match is a simulator-generation cone, out of scope).
    expect(row10!.unmatchedRejects).toBe(4);
  });

  it('states the real generation and that the simulator rows were excluded', async () => {
    const data = await getProduction(datasetPool(), LINE, { from: FROM, to: TO, groupBy: 'day' });
    expect(data.generationNote!.generation?.ordinal).toBe(5);
    expect(data.generationNote!.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(data.generationNote!.spansGenerations).toBe(true);
  });

  it('sanity: getUnmatchedRejects itself agrees, scoped vs unscoped, matching the weightStations.generations.test.ts idiom', async () => {
    const scope = await resolveGenerationScope(datasetPool(), LINE, { from: FROM, to: TO });
    expect(scope.generation?.ordinal).toBe(5);

    const scoped = await getUnmatchedRejects(datasetPool(), LINE, { from: FROM, to: TO, scope }, "CONVERT(varchar(10), re.shift_date, 120)");
    expect([...scoped.entries()]).toEqual([['2026-09-10', 4]]);

    const unscoped = await getUnmatchedRejects(datasetPool(), LINE, { from: FROM, to: TO }, "CONVERT(varchar(10), re.shift_date, 120)");
    // Unscoped pools the simulator's day in too, and wrongly matches
    // REJECT_CROSS against the simulator cone — exactly what production.ts's
    // `unmatchedFilters` (missing `scope`) reproduces today.
    const unscopedMap = new Map(unscoped.entries());
    expect(unscopedMap.get('2026-09-11')).toBe(8);
    expect(unscopedMap.get('2026-09-10')).toBe(3);
  });
});
