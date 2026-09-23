/**
 * RT-021 (23 Sep 2026 red-team audit) — a vendor clock-fault row
 * (`production_ts_utc_ms = 0`, the 1969-12-31 sentinel CLAUDE.md's
 * "Known constraints" section names) sits in the currently-live generation
 * and wins `MAX(production_ts_utc_ms)` whenever a replay/anchor lands before
 * that generation's real data starts. Measured live before this fix:
 * `dataAsOfUtc: "1970-01-01T00:00:00.000Z"`, `behindSeconds` in the tens of
 * millions of seconds, while real rows for that date existed all along.
 *
 * THREE SITES run the same unfloored "newest thing we have" query —
 * `live.ts` (getLive's tip), `health.ts` (acquisitionHealth's tip) and
 * `machinesRunning.ts` (the running-grid anchor) — and none of the three had
 * any lower bound at all, only `<= @now` / `<= @asOf`. This file proves the
 * defect and then the fix, once per site.
 *
 * Each fixture below offers the query TWO candidate rows — the 0 ms sentinel
 * and a real, later reading — at an anchor/asOf instant that sits AFTER the
 * sentinel but BEFORE the real reading. Unfloored, `MAX()` returns the
 * sentinel (0) because it is the only row within the cap. Floored (`AND
 * production_ts_utc_ms > 0`), no row qualifies and the answer is honestly
 * "no reading" (null) — not a 56-year-old lie.
 *
 * The generation probe is answered as empty (UNSCOPED) throughout, exactly
 * as phase4.services.test.ts and generations.live.test.ts already do for a
 * fixture that does not need to exercise epoch scoping — that machinery is
 * covered elsewhere; this file isolates the floor.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getLive } from './live.js';
import { acquisitionHealth } from './health.js';
import { getMachinesRunning } from './machinesRunning.js';

interface Captured {
  sql: string;
  params: Map<string, unknown>;
}

/**
 * A pool that answers the source-generation probe as "nothing tagged" (so
 * every caller resolves to UNSCOPED — no epoch predicate to thread through)
 * and everything else via `answer`, which sees the SQL text and the bound
 * parameters so it can compute what real SQL would return given the
 * predicate the code actually emitted.
 */
function fakePool(
  answer: (sql: string, params: Map<string, unknown>) => unknown[],
): { pool: ConnectionPool; calls: Captured[] } {
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
          if (/AS tbl,\s*source_epoch/.test(sql)) return { recordset: [] };
          calls.push({ sql, params: new Map(params) });
          return { recordset: answer(sql, params) };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const SENTINEL_MS = 0;
const REAL_MS = Date.parse('2026-07-05T09:00:00Z');
// After the sentinel, before the real reading — the replay-lands-early case.
const ASOF_MS = Date.parse('2026-07-05T08:00:00Z');

/**
 * Simulates `MAX(production_ts_utc_ms)` over {SENTINEL_MS, REAL_MS} the way
 * real SQL Server would, GIVEN the predicate the code under test actually
 * wrote: a literal `> 0` floor (if present) and an `<= @<capParam>` cap (if
 * present, read from the bound parameter of that name).
 */
function simulateMax(sql: string, params: Map<string, unknown>, capParamNames: string[]): number | null {
  const hasFloor = /production_ts_utc_ms\s*>\s*0\b/.test(sql);
  let candidates = [SENTINEL_MS, REAL_MS];
  if (hasFloor) candidates = candidates.filter((ms) => ms > 0);
  for (const p of capParamNames) {
    if (new RegExp(`production_ts_utc_ms\\s*<=\\s*@${p}\\b`).test(sql) && params.has(p)) {
      const cap = Number(params.get(p));
      candidates = candidates.filter((ms) => ms <= cap);
    }
  }
  return candidates.length ? Math.max(...candidates) : null;
}

describe('anchor floor (RT-021) — the 1970 sentinel must not win MAX()', () => {
  it('machinesRunning.ts: the anchor at an asOf before the real reading does not fall back to the sentinel', async () => {
    const { pool } = fakePool((sql, params) => {
      if (/SELECT MAX\(production_ts_utc_ms\) AS ms/.test(sql)) {
        const ms = simulateMax(sql, params, ['asOf']);
        return [{ ms: ms == null ? null : String(ms) }];
      }
      if (/FROM sms\.station s/.test(sql)) return [];
      return [];
    });

    const d = await getMachinesRunning(pool, 1, { asOfMs: ASOF_MS });

    // RED before the fix: this was "1970-01-01T00:00:00.000Z" (ms=0).
    expect(d.asOfUtc).not.toBe(new Date(0).toISOString());
    expect(d.asOfUtc).toBeNull();
    expect(d.machines.every((m) => m.quiet)).toBe(true);
  });

  it('live.ts (getLive): the data tip at a replay instant before the real reading does not fall back to the sentinel', async () => {
    const { pool } = fakePool((sql, params) => {
      if (/SELECT MAX\(tip\) AS tip FROM \(/.test(sql)) {
        // Both branches of the UNION (cone_event, reject_event) carry the
        // same floor/cap predicates in live.ts's query, so simulating over
        // the whole query text once is equivalent to simulating each arm.
        const ms = simulateMax(sql, params, ['now']);
        return [{ tip: ms }];
      }
      return [];
    });

    const d = await getLive(pool, 1, 'Line 3', { asOfMs: ASOF_MS });

    // RED before the fix: this was "1970-01-01T00:00:00.000Z".
    expect(d.lines[0]!.dataAsOfUtc).not.toBe(new Date(0).toISOString());
    expect(d.lines[0]!.dataAsOfUtc).toBeNull();
  });

  it('health.ts (acquisitionHealth): the tip query itself carries the same floor as the other two sites', async () => {
    // health.ts's tip query carries no @now/@asOf cap at all (it always
    // wants the newest reading on record), so a fixture-level MAX() cannot
    // distinguish floored from unfloored here the way it can for live.ts and
    // machinesRunning.ts — the sentinel is never the largest candidate
    // without a cap holding the real reading out. What CAN be, and is,
    // proven: the query text carries the identical `> 0` literal floor the
    // other two sites now carry, so a future caller that adds a cap to this
    // query (the natural next step once IFL's live login lands, Q65-70)
    // inherits the same protection rather than reintroducing RT-021 here.
    const { pool, calls } = fakePool((sql, params) => {
      if (/SELECT MAX\(tip\) AS tip FROM \(/.test(sql)) {
        const ms = simulateMax(sql, params, []);
        return [{ tip: ms }];
      }
      return [];
    });

    await acquisitionHealth(pool, 1);

    const tip = calls.find((c) => /SELECT MAX\(tip\) AS tip FROM \(/.test(c.sql));
    expect(tip).toBeTruthy();
    // RED before the fix: no such literal appears anywhere in this query.
    expect(tip!.sql).toMatch(/production_ts_utc_ms\s*>\s*0/);
  });
});
