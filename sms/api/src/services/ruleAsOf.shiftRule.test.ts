/**
 * Task W1-B (29 Sep 2026): `loadShiftRuleHistory` — the DB-backed half of
 * `sms.shift_rule` versioning, alongside `ruleAsOf.twoVersion.test.ts`'s
 * plausibility/weight coverage. Same fakePool idiom: one
 * `.request().input(...).query(rows)` per call, serving `rows` verbatim, so
 * this proves the loader's own SQL-row -> RuleVersion parsing and its
 * `effective_from` -> plant-ms conversion (`toPlantMs`), not a live database.
 *
 * TWO CLOCKS. `effective_from` is a genuine UTC instant (app-written);
 * `loadShiftRuleHistory` must convert it through `toPlantMs` before it is
 * comparable to a production-convention anchor (`dayStartMs` in
 * shiftRange.ts). This file pins that conversion happens, host-independently
 * (never a hardcoded ISO string derived from an assumed offset — every
 * expectation is built via `toPlantMs` itself, the same function under
 * test).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { DEFAULT_SHIFT_BOUNDARIES } from '@sms/shared';
import { loadShiftRuleHistory } from './ruleAsOf.js';
import { toPlantMs } from './plantClock.js';
import { shiftRangeEdgesUtcAsOf } from '../shiftRange.js';
import type { ShiftRange } from '../shiftRange.js';

/** Minimal fake: one `.request().input(...).query(rows)` per call, serving `rows` verbatim. */
function fakePool(recordset: Record<string, unknown>[]): ConnectionPool {
  const request = () => {
    const req = {
      input: () => req,
      query: async () => ({ recordset }),
    };
    return req;
  };
  return { request } as unknown as ConnectionPool;
}

describe('loadShiftRuleHistory', () => {
  it('parses HH:MM columns and converts effective_from (genuine UTC) onto the production convention via toPlantMs', async () => {
    const rawUtc = '2026-09-03T02:00:00.000Z';
    const rows = [
      { ms: '07:00', es: '15:00', ns: '23:00', night_belongs_to: 'start_day', effective_from: new Date(rawUtc) },
      { ms: '06:00', es: '14:00', ns: '22:00', night_belongs_to: 'start_day', effective_from: new Date('2026-08-01T00:00:00.000Z') },
    ];
    const pool = fakePool(rows);
    const history = await loadShiftRuleHistory(pool, 1);
    expect(history).toHaveLength(2);
    // Newest first, same order the SQL returns (ORDER BY effective_from DESC).
    expect(history[0]!.value.boundaries).toEqual({ morningStart: 7 * 60, eveningStart: 15 * 60, nightStart: 23 * 60 });
    // The row's effective_from is converted, not passed through raw — pinned
    // by comparing against toPlantMs of the same input, never a literal ISO
    // string that assumes a particular host offset.
    expect(history[0]!.effectiveFromMs).toBe(toPlantMs(rawUtc));
    expect(history[0]!.effectiveFromMs).not.toBe(new Date(rawUtc).getTime());
  });

  it('falls back to DEFAULT_SHIFT_BOUNDARIES / start_day for a row that fails the ms<es<ns validity guard, same as live.ts loadShiftRule', async () => {
    const rows = [
      { ms: '14:00', es: '06:00', ns: '22:00', night_belongs_to: null, effective_from: new Date('2026-08-01T00:00:00.000Z') }, // out of order
    ];
    const pool = fakePool(rows);
    const history = await loadShiftRuleHistory(pool, 1);
    expect(history[0]!.value.boundaries).toEqual(DEFAULT_SHIFT_BOUNDARIES);
    expect(history[0]!.value.nightBelongsTo).toBe('start_day');
  });

  it('an empty table falls back to a single lower-bound version, not a crash', async () => {
    const pool = fakePool([]);
    const history = await loadShiftRuleHistory(pool, 1);
    expect(history).toEqual([{ effectiveFromMs: -Infinity, value: { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: 'start_day' } }]);
  });

  it('a null night_belongs_to defaults to start_day; calendar_day is preserved exactly', async () => {
    const rows = [
      { ms: '06:00', es: '14:00', ns: '22:00', night_belongs_to: 'calendar_day', effective_from: new Date('2026-08-01T00:00:00.000Z') },
      { ms: '06:00', es: '14:00', ns: '22:00', night_belongs_to: null, effective_from: new Date('2026-07-01T00:00:00.000Z') },
    ];
    const pool = fakePool(rows);
    const history = await loadShiftRuleHistory(pool, 1);
    expect(history[0]!.value.nightBelongsTo).toBe('calendar_day');
    expect(history[1]!.value.nightBelongsTo).toBe('start_day');
  });

  it('end to end: feeds shiftRangeEdgesUtcAsOf directly, and a version whose genuine-UTC effective_from converts to well after the range anchor is correctly not yet in force', async () => {
    // effective_from is a full week after the range — comfortably later than
    // 2026-09-03's own day-start anchor under any realistic plant UTC
    // offset (the whole point of TWO CLOCKS is that the shift is at most
    // ~14h, never days), so this is a genuine "not yet in force" case, not
    // an artifact of a particular offset.
    const rows = [
      { ms: '07:00', es: '15:00', ns: '23:00', night_belongs_to: 'start_day', effective_from: new Date('2026-09-10T00:00:00.000Z') },
      { ms: '06:00', es: '14:00', ns: '22:00', night_belongs_to: 'start_day', effective_from: new Date('2026-08-01T00:00:00.000Z') },
    ];
    const pool = fakePool(rows);
    const history = await loadShiftRuleHistory(pool, 1);
    const range: ShiftRange = { from: '2026-09-03', fromShift: 'morning', to: '2026-09-03', toShift: 'morning' };
    const { fromMs } = shiftRangeEdgesUtcAsOf(range, history);
    // Sanity check the fixture's own premise before trusting the assertion below.
    const anchor = Date.parse('2026-09-03T00:00:00.000Z');
    expect(history[0]!.effectiveFromMs).toBeGreaterThan(anchor);
    // Still-old (06:00) boundary applies — the new version genuinely isn't in force yet.
    expect(new Date(fromMs).toISOString()).toBe('2026-09-03T06:00:00.000Z');
  });
});
