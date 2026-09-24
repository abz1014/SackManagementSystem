/**
 * Tests for machinesRunning.ts's per-machine `state`/`lastSeenUtc` (24 Sep
 * 2026, Task #8). Previously every machine carried only `quiet: boolean`;
 * a station that had not reported in a week read identically to one that
 * had simply not reported in the last two hours of an otherwise-busy line.
 *
 * `state` is graded from `lastSeenUtc` — the newest reading EVER at that
 * station in this generation, not just inside the 2 h window — relative to
 * the SAME anchor (`asOfMs`) the rest of this file already uses, never
 * `Date.now()` (CLAUDE.md's 18-minute acquisition-lag rule, restated in this
 * file's own header).
 *
 * Uses the shared two-generation-capable fake pool
 * (`testkit/generations.ts`) with `ONE_REAL_GENERATION` so
 * `resolveLiveScope`'s own `resolveGenerationScope` call is answered
 * transparently and consumes no positional response slot — the same idiom
 * `weightStations.test.ts` already uses for a DB-backed sibling service.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';
import { invalidateLiveConfigCache } from './live.js';
import { getMachinesRunning } from './machinesRunning.js';

function fakePool(...responses: unknown[][]): ConnectionPool {
  return fakePositionalPool(ONE_REAL_GENERATION, responses).pool;
}

afterEach(() => {
  // resolveLiveScope caches per line_id across calls; without this, a later
  // test's scope query would never actually run, which happens to be
  // harmless here (same spec every time) but is not a dependency to lean on.
  invalidateLiveConfigCache();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ANCHOR = Date.UTC(2026, 8, 7, 12, 0, 0); // 2026-09-07T12:00:00Z

const ROSTER = [
  { station_id: 1, name: 'Station 1', machine_name: 'M1', is_active: true },
  { station_id: 2, name: 'Station 2', machine_name: 'M2', is_active: true },
  { station_id: 3, name: 'Station 3', machine_name: 'M3', is_active: true },
  { station_id: 4, name: 'Station 4', machine_name: 'M4', is_active: true },
];

describe('getMachinesRunning — per-machine state', () => {
  it('grades four stations running / quiet / stale / silent from lastSeenUtc, anchored on the newest reading (never Date.now())', async () => {
    const lastSeen = [
      { st: 1, ms: ANCHOR - 1 * HOUR }, // inside the 2 h window
      { st: 2, ms: ANCHOR - 5 * HOUR }, // outside 2 h, inside 24 h
      { st: 3, ms: ANCHOR - 3 * DAY }, // outside 24 h, inside 7 days
      { st: 4, ms: ANCHOR - 10 * DAY }, // outside 7 days
    ];
    // Only station 1 falls inside the 2 h window, so only it appears in the
    // window query's recordset — the other three stay `quiet: true` and are
    // graded purely from `lastSeenUtc`.
    const windowRows = [
      {
        st: 1, material_id: null, product_name: null,
        cones: 3, on_material: 3, newest_ms: ANCHOR - 1 * HOUR, since_ms: ANCHOR - 1 * HOUR,
        since_is_window_start: 1,
      },
    ];
    const pool = fakePool(
      [{ ms: ANCHOR }], // 1. anchor
      ROSTER, // 2. roster
      lastSeen, // 2b. lastSeenUtc per station
      windowRows, // 3. per-station window query
    );

    const data = await getMachinesRunning(pool, 1, {});
    const byStation = new Map(data.machines.map((m) => [m.station, m]));

    expect(byStation.get(1)?.state).toBe('running');
    expect(byStation.get(2)?.state).toBe('quiet');
    expect(byStation.get(3)?.state).toBe('stale');
    expect(byStation.get(4)?.state).toBe('silent');

    expect(byStation.get(1)?.lastSeenUtc).toBe(new Date(ANCHOR - 1 * HOUR).toISOString());
    expect(byStation.get(4)?.lastSeenUtc).toBe(new Date(ANCHOR - 10 * DAY).toISOString());
  });

  it('a station never seen at all (no lastSeenUtc row) reads silent, not a crash on a null date', async () => {
    const pool = fakePool(
      [{ ms: ANCHOR }],
      [{ station_id: 9, name: 'Station 9', machine_name: null, is_active: true }],
      [], // no lastSeen row for station 9 at all
      [], // never in the window either
    );

    const data = await getMachinesRunning(pool, 1, {});
    const m = data.machines.find((x) => x.station === 9);
    expect(m?.state).toBe('silent');
    expect(m?.lastSeenUtc).toBeNull();
  });

  it('whole-line exception: when the line itself is quiet (no reading at all, asOfMs null), every machine reports quiet — never silent — even if individually not seen in a long time', async () => {
    const pool = fakePool(
      [{ ms: null }], // 1. anchor — nothing in this generation at all
      ROSTER, // 2. roster
      // lastSeen would in reality also be empty when the anchor is null (same
      // table, same scope), but even a stray non-null row must not defeat the
      // whole-line exception — the line's own state always wins.
      [{ st: 3, ms: ANCHOR - 30 * DAY }],
      // No window query is issued once asOfMs is null — the function returns
      // before it, so no fourth response is consumed.
    );

    const data = await getMachinesRunning(pool, 1, {});
    expect(data.asOfUtc).toBeNull();
    expect(data.machines.length).toBe(ROSTER.length);
    for (const m of data.machines) expect(m.state).toBe('quiet');
  });
});
