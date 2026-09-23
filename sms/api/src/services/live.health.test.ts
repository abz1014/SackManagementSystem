/**
 * services/live.ts — the server-side health decision (roadmap rule "the
 * health decision is server-side and measured", live.ts:213-247).
 *
 * classifyHealth is the pure fold from (data tip, sync freshness, ingest lag,
 * replay) to one of 'ok' | 'stale' | 'late' | 'no_data'; when it is anything
 * but 'ok', no screen may assert whether the line is running.
 *
 * getSyncHealth is the DB-backed half: it must report freshness from the
 * OLDEST of the source tables, not the newest — the whole point being that a
 * dead feed must not hide behind three healthy ones (finding this file pins
 * down as a regression) — and a cadence measured as the MEDIAN of recent
 * gaps between successful passes, not a hardcoded number.
 *
 * Both are exercised here; before this file neither had a single test
 * anywhere in the suite.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  classifyHealth,
  getSyncHealth,
  DEFAULT_STALE_AFTER_SECONDS,
  MIN_STALE_AFTER_SECONDS,
  STALE_CADENCE_MULTIPLE,
  MAX_CREDIBLE_LAG_SECONDS,
  type SyncHealth,
  type LiveHealthKind,
} from './live.js';

/* ------------------------------------------------------------- Block 1 -- */
/* classifyHealth is pure: a table of every branch, one case each.         */

describe('classifyHealth — pure state table', () => {
  const VALID_SYNC: SyncHealth = { ageSeconds: 30, oldestTable: 'cone_raw', cadenceSeconds: 60, staleAfterSeconds: 180 };

  interface Case {
    name: string;
    dataAsOfMs: number | null;
    sync: SyncHealth;
    lag: number | null;
    replay: boolean;
    expected: LiveHealthKind;
  }

  const cases: Case[] = [
    {
      name: 'replay=true with data → ok (sync/lag are never consulted during a replay)',
      dataAsOfMs: 1_000, sync: VALID_SYNC, lag: null, replay: true, expected: 'ok',
    },
    {
      name: 'replay=true without data → no_data',
      dataAsOfMs: null, sync: VALID_SYNC, lag: null, replay: true, expected: 'no_data',
    },
    {
      name: 'dataAsOfMs = null outside a replay → no_data',
      dataAsOfMs: null, sync: VALID_SYNC, lag: null, replay: false, expected: 'no_data',
    },
    {
      name: 'sync.ageSeconds = null (no successful pass yet) → stale',
      dataAsOfMs: 1_000, sync: { ...VALID_SYNC, ageSeconds: null }, lag: null, replay: false, expected: 'stale',
    },
    {
      name: 'ageSeconds one second past staleAfterSeconds → stale',
      dataAsOfMs: 1_000, sync: { ...VALID_SYNC, ageSeconds: 181, staleAfterSeconds: 180 }, lag: null, replay: false, expected: 'stale',
    },
    {
      // This case is about the STALENESS boundary only (ageSeconds ===
      // staleAfterSeconds is inclusive of ok), not about the lag. It used to
      // carry lag: null and still expect 'ok', which depended on the null-lag
      // fallthrough the RT-006 case above removes. A plausible, measured lag
      // keeps the boundary assertion honest without weakening it.
      name: 'ageSeconds exactly AT staleAfterSeconds → NOT stale (boundary is inclusive of ok)',
      dataAsOfMs: 1_000, sync: { ...VALID_SYNC, ageSeconds: 180, staleAfterSeconds: 180 }, lag: 1_100, replay: false, expected: 'ok',
    },
    {
      name: 'ingestLagSeconds past MAX_CREDIBLE_LAG_SECONDS → late',
      dataAsOfMs: 1_000, sync: VALID_SYNC, lag: MAX_CREDIBLE_LAG_SECONDS + 1, replay: false, expected: 'late',
    },
    {
      name: 'ingestLagSeconds exactly AT MAX_CREDIBLE_LAG_SECONDS → NOT late (boundary)',
      dataAsOfMs: 1_000, sync: VALID_SYNC, lag: MAX_CREDIBLE_LAG_SECONDS, replay: false, expected: 'ok',
    },
    {
      // RT-006 (23 Sep 2026 red-team audit): this case used to expect 'ok'.
      // A zero-row lag sample — the state produced by `sms epoch:accept`
      // opening a new generation, literally IFL's installation day — made
      // ingestLagSeconds null, classifyHealth fell through to 'ok', and the
      // line then printed "stopped" in alarm styling while the pipeline
      // simply did not yet know the lag. 'ok' must never be reachable with
      // an unmeasured lag; see the 'lag null → lag_unknown' case for the
      // replacement pin.
      name: 'ingestLagSeconds = null (not yet measured) → NOT ok (RT-006)',
      dataAsOfMs: 1_000, sync: VALID_SYNC, lag: null, replay: false, expected: 'lag_unknown',
    },
    {
      name: 'fresh data, healthy sync, plausible lag, no replay → ok',
      dataAsOfMs: 1_000, sync: VALID_SYNC, lag: 1_100, replay: false, expected: 'ok',
    },
  ];

  it.each(cases)('$name', ({ dataAsOfMs, sync, lag, replay, expected }) => {
    expect(classifyHealth(dataAsOfMs, sync, lag, replay)).toBe(expected);
  });
});

/* ------------------------------------------------------------- Block 2 -- */
/* getSyncHealth against a fake pool that answers by SQL shape, the idiom  */
/* used elsewhere in this suite (population.test.ts, calibration.phase9   */
/* .test.ts): pool.request() returns a request object that records every  */
/* bound parameter and dispatches query(sql) to a per-test `answer`       */
/* callback keyed on a substring unique to each of getSyncHealth's two    */
/* queries.                                                               */

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(answer: (sql: string, params: Map<string, unknown>) => unknown[]): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params });
          return { recordset: answer(sql, params) };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

/** True for the "oldest of the four tables" query — `ORDER BY finished ASC`
 *  is the line that makes it pick the STALEST table, not the freshest; the
 *  gaps/cadence query has no such text. */
const isOldestTableQuery = (sql: string) => sql.includes('ORDER BY finished ASC');
/** True for the cadence/gaps query — unique to it via the LAG() window fn. */
const isGapsQuery = (sql: string) => sql.includes('LAG(finished)');

/**
 * Builds the `answer` callback for fakePool, routing each of getSyncHealth's
 * two queries to canned results as if SQL had already done the grouping and
 * ordering `oldestRow` / `gapSecondsList` describe.
 */
function makeAnswer(oldestRow: { target_table: string; ageSeconds: number } | null, gapSecondsList: number[]) {
  return (sql: string): unknown[] => {
    if (isOldestTableQuery(sql)) return oldestRow ? [oldestRow] : [];
    if (isGapsQuery(sql)) return gapSecondsList.map((g) => ({ gapSeconds: g }));
    throw new Error(`live.health.test.ts: unrecognised query shape:\n${sql}`);
  };
}

describe('getSyncHealth — freshness from the oldest table, cadence from the median gap', () => {
  it('THE ONE THAT MATTERS: three tables fresh, one dead for 40 minutes → oldestTable is the dead one and ageSeconds is ITS age, not the fresh ones\'', async () => {
    // If freshness were taken from MAX(finished_at_utc) across all four
    // tables (the bug this rule exists to prevent), the three healthy
    // tables would hide the dead one and the pipeline would read as current.
    const tableAges = [
      { target_table: 'cone_raw', ageSeconds: 30 },
      { target_table: 'sack_raw', ageSeconds: 45 },
      { target_table: 'rejectQcs_raw', ageSeconds: 60 },
      { target_table: 'rejectWeight_raw', ageSeconds: 40 * 60 }, // the dead feed
    ];
    const oldest = tableAges.reduce((a, b) => (b.ageSeconds > a.ageSeconds ? b : a));
    const { pool } = fakePool(makeAnswer(oldest, [58, 60, 62]));

    const health = await getSyncHealth(pool, 7);

    expect(health.oldestTable).toBe('rejectWeight_raw');
    expect(health.ageSeconds).toBe(2400);
  });

  it('cadence is the MEDIAN of recent gaps, not the mean and not the newest gap', async () => {
    // The real query orders "recent" by finished DESC, so the newest gap (an
    // anomalous 500 s pause) would be recordset[0]; a wrong implementation
    // that took that value, or the mean, would not see 30.
    const { pool } = fakePool(makeAnswer({ target_table: 'cone_raw', ageSeconds: 30 }, [500, 10, 20, 30]));

    const health = await getSyncHealth(pool, 1);

    // mean = 140, newest-gap = 500; sorted [10,20,30,500] → median-index (floor(4/2)) = 30.
    expect(health.cadenceSeconds).toBe(30);
    expect(health.cadenceSeconds).not.toBe(500);
    expect(health.cadenceSeconds).not.toBe(140);
  });

  it('no successful passes at all → every measured field is null, staleAfterSeconds falls back to the default', async () => {
    const { pool } = fakePool(makeAnswer(null, []));

    const health = await getSyncHealth(pool, 1);

    expect(health.ageSeconds).toBeNull();
    expect(health.oldestTable).toBeNull();
    expect(health.cadenceSeconds).toBeNull();
    expect(health.staleAfterSeconds).toBe(DEFAULT_STALE_AFTER_SECONDS);
  });

  it('a cadence so tight that cadence * STALE_CADENCE_MULTIPLE undercuts the floor is clamped to MIN_STALE_AFTER_SECONDS', async () => {
    // median gap = 10s; 10 * STALE_CADENCE_MULTIPLE(3) = 30, below the 90s floor.
    const { pool } = fakePool(makeAnswer({ target_table: 'cone_raw', ageSeconds: 5 }, [8, 10, 12]));

    const health = await getSyncHealth(pool, 1);

    expect(health.cadenceSeconds).toBe(10);
    expect(10 * STALE_CADENCE_MULTIPLE).toBeLessThan(MIN_STALE_AFTER_SECONDS);
    expect(health.staleAfterSeconds).toBe(MIN_STALE_AFTER_SECONDS);
  });

  it('filters non-finite, zero and negative gaps out before taking the median', async () => {
    const { pool } = fakePool(makeAnswer(
      { target_table: 'cone_raw', ageSeconds: 30 },
      [NaN, 0, -5, 58, 60, 62],
    ));

    const health = await getSyncHealth(pool, 1);

    // Only 58/60/62 survive; sorted [58,60,62] → median-index (floor(3/2)) = 60.
    expect(health.cadenceSeconds).toBe(60);
  });

  it('binds line_id as a query PARAMETER in both queries, never concatenates it into the SQL text', async () => {
    const LINE_ID = 4321;
    const { pool, calls } = fakePool(makeAnswer({ target_table: 'cone_raw', ageSeconds: 30 }, [60, 61, 59]));

    await getSyncHealth(pool, LINE_ID);

    expect(calls.length).toBe(2);
    for (const c of calls) {
      expect(c.params.get('line')).toBe(LINE_ID);
      expect(c.sql).toContain('@line');
      expect(c.sql).not.toContain(String(LINE_ID));
    }
  });
});
