/**
 * RT24-04 (transform side). Pins ruleHistory.ts's per-reading resolution:
 * a rule change partway through a canonical rebuild must give rows on each
 * side of the change their OWN rule, not whichever version happens to be
 * newest when the pass runs.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  loadShiftRuleHistory,
  resolveShiftRuleAt,
  loadPlausibilityRuleHistory,
  resolvePlausibilityAt,
} from './ruleHistory.js';

function rowsPool(rows: Record<string, unknown>[]) {
  const seen = { sql: '' };
  const pool = {
    request() {
      const req = {
        input() {
          return req;
        },
        async query(sql: string) {
          seen.sql = sql;
          return { recordset: rows };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, seen };
}

const fallback = { nightBelongsTo: 'start_day' as const, mode: 'corrected' as const };

describe('loadShiftRuleHistory / resolveShiftRuleAt', () => {
  it('orders ascending by effective_from and picks the version in force at a given reading time', async () => {
    const { pool } = rowsPool([
      { ms: '06:00', es: '14:00', ns: '22:00', nb: 'start_day', mode: 'corrected', ef: new Date('2000-01-01T00:00:00Z') },
      { ms: '05:30', es: '13:30', ns: '21:30', nb: 'start_day', mode: 'corrected', ef: new Date('2026-09-14T10:43:19Z') },
    ]);
    const history = await loadShiftRuleHistory(pool, 1, fallback);
    expect(history).toHaveLength(2);
    expect(history[0]!.effectiveAtPlantMs).toBeLessThan(history[1]!.effectiveAtPlantMs);

    // A reading long before either rule changed (still gets the oldest version, not -Infinity behaviour).
    const early = resolveShiftRuleAt(history, Date.parse('2026-06-22T11:00:00Z'));
    expect(early.boundaries.morningStart).toBe(360); // 06:00

    // A reading after the 14 Sep 2026 change (converted to plant time) gets the NEW rule.
    const plantMs = history[1]!.effectiveAtPlantMs + 60_000; // 1 minute after the new rule took effect, on plant clock
    const late = resolveShiftRuleAt(history, plantMs);
    expect(late.boundaries.morningStart).toBe(330); // 05:30
  });

  it('falls back to the seed rule when the line has no row at all', async () => {
    const { pool } = rowsPool([]);
    const history = await loadShiftRuleHistory(pool, 1, fallback);
    expect(history).toHaveLength(1);
    const rule = resolveShiftRuleAt(history, Date.now());
    expect(rule.boundaries).toEqual({ morningStart: 360, eveningStart: 840, nightStart: 1320 });
  });

  it('throws, naming Setup › Rules, when a version on file has times out of order', async () => {
    const { pool } = rowsPool([
      { ms: '14:00', es: '06:00', ns: '22:00', nb: 'start_day', mode: 'corrected', ef: new Date('2026-01-01T00:00:00Z') },
    ]);
    await expect(loadShiftRuleHistory(pool, 1, fallback)).rejects.toThrow(/Setup › Rules/);
  });
});

describe('loadPlausibilityRuleHistory / resolvePlausibilityAt', () => {
  it('resolves the window in force at a reading\'s own time, not the newest window on file', async () => {
    const { pool } = rowsPool([
      { cl: 1500, ch: 2100, sl: 40, sh: 60, ef: new Date('2000-01-01T00:00:00Z') },
      { cl: 1900, ch: 2100, sl: 40, sh: 60, ef: new Date('2026-08-19T06:19:16Z') },
      { cl: 1500, ch: 2100, sl: 40, sh: 60, ef: new Date('2026-08-19T06:19:39Z') },
    ]);
    const history = await loadPlausibilityRuleHistory(pool, 1);
    expect(history).toHaveLength(3);

    // Just after the narrow 1900g window took effect (before it was reverted 23s later).
    const midMs = history[1]!.effectiveAtPlantMs + 5_000;
    expect(resolvePlausibilityAt(history, midMs).coneLoG).toBe(1900);

    // Well before any rule change.
    expect(resolvePlausibilityAt(history, Date.parse('2026-06-22T11:00:00Z')).coneLoG).toBe(1500);
  });

  it('falls back to DEFAULT_PLAUSIBILITY when the line has no row at all', async () => {
    const { pool } = rowsPool([]);
    const history = await loadPlausibilityRuleHistory(pool, 1);
    expect(resolvePlausibilityAt(history, Date.now())).toEqual({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
  });
});
