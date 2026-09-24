/**
 * Regression test for eventMsOfRaw (runTransform.ts, ~line 429 region).
 *
 * Before this fix: a raw row missing both src_ProductionDate and src_Date
 * (or missing src_Date, for sacks) produced `dt === undefined`, and calling
 * `.getTime()` on it threw an unhandled `TypeError: Cannot read properties
 * of undefined (reading 'getTime')` — no raw_id, no table, indistinguishable
 * from a real code bug. It now throws a plain `Error` naming the row's own
 * raw_id and its source table.
 *
 * Also pins the per-row shift-rule resolution path (RT24-04, ruleHistory.ts)
 * against a genuine 3-version history: `resolveShiftRuleAt` picks the newest
 * version whose `effectiveAtPlantMs` is at or before the reading's own
 * production time (plant wall clock, UTC-labelled) — never today's rule.
 */
import { describe, expect, it } from 'vitest';
import { eventMsOfRaw } from './runTransform.js';
import { resolveShiftRuleAt, type ShiftRuleVersion } from './ruleHistory.js';
import { shiftCodeOf, shiftDateOf, wallClockOf } from './wallClock.js';
import { shiftBoundariesFrom } from '@sms/shared';

describe('eventMsOfRaw — a raw row with no usable event time (RED: was TypeError)', () => {
  it('throws a clear Error naming the raw_id and table when both src_ProductionDate and src_Date are null', () => {
    const raw = { raw_id: 4471, src_ProductionDate: null, src_Date: null };
    expect(() => eventMsOfRaw(raw, true, 'pack1_TP1U2')).toThrow(Error);
    try {
      eventMsOfRaw(raw, true, 'pack1_TP1U2');
      throw new Error('unreachable: eventMsOfRaw did not throw');
    } catch (e) {
      expect(e).not.toBeInstanceOf(TypeError);
      expect(e).toBeInstanceOf(Error);
      const msg = (e as Error).message;
      expect(msg).toContain('4471');
      expect(msg).toContain('pack1_TP1U2');
    }
  });

  it('throws the same way when only src_Date is missing (the sack path, usesProductionDate=false)', () => {
    const raw = { raw_id: 909, src_Date: null };
    expect(() => eventMsOfRaw(raw, false, 'sack1_TP1U2')).toThrow(/909/);
    expect(() => eventMsOfRaw(raw, false, 'sack1_TP1U2')).toThrow(/sack1_TP1U2/);
    try {
      eventMsOfRaw(raw, false, 'sack1_TP1U2');
    } catch (e) {
      expect(e).not.toBeInstanceOf(TypeError);
    }
  });

  it('still resolves normally, unaffected, when src_ProductionDate is present', () => {
    const dt = new Date('2026-09-19T05:45:00.000Z');
    const raw = { raw_id: 1, src_ProductionDate: dt, src_Date: null };
    expect(eventMsOfRaw(raw, true, 'pack1_TP1U2')).toBe(dt.getTime());
  });

  it('falls back to src_Date when src_ProductionDate is null but src_Date is present', () => {
    const dt = new Date('2026-09-14T15:44:00.000Z');
    const raw = { raw_id: 2, src_ProductionDate: null, src_Date: dt };
    expect(eventMsOfRaw(raw, true, 'pack1_TP1U2')).toBe(dt.getTime());
  });
});

describe('per-row shift-rule resolution across a 3-version history (RT24-04 regression)', () => {
  // effective_from values are genuine UTC instants; plant = UTC+5, and
  // production_ts_utc_ms (and eventMsOfRaw's return) is the plant wall clock
  // LABELLED as UTC (TWO CLOCKS — CLAUDE.md / plantClock.ts). ruleHistory.ts's
  // own toPlantMs re-expresses effective_from on that same convention by
  // adding the fixed +300 min plant offset before comparing; we do the same
  // arithmetic here rather than re-deriving it a third way.
  const PLANT_OFFSET_MS = 300 * 60_000;
  const toPlantMs = (iso: string) => new Date(iso).getTime() + PLANT_OFFSET_MS;

  const boundaries0622 = shiftBoundariesFrom('06:00', '14:00', '22:00')!;
  const boundaries0513 = shiftBoundariesFrom('05:30', '13:30', '21:30')!;

  const history: ShiftRuleVersion[] = [
    {
      effectiveAtPlantMs: toPlantMs('2000-01-01T00:00:00.000Z'),
      rule: { boundaries: boundaries0622, nightBelongsTo: 'start_day', mode: 'corrected' },
    },
    {
      effectiveAtPlantMs: toPlantMs('2026-09-14T10:43:19.087Z'),
      rule: { boundaries: boundaries0513, nightBelongsTo: 'start_day', mode: 'corrected' },
    },
    {
      effectiveAtPlantMs: toPlantMs('2026-09-14T10:44:42.218Z'),
      rule: { boundaries: boundaries0622, nightBelongsTo: 'start_day', mode: 'corrected' },
    },
  ];

  it('a reading at plant 2026-09-19 05:45 resolves rule v3 and is stamped night of 2026-09-18', () => {
    const raw = { raw_id: 100, src_ProductionDate: new Date('2026-09-19T05:45:00.000Z'), src_Date: null };
    const productionTsUtcMs = eventMsOfRaw(raw, true, 'pack1_TP1U2');
    const rule = resolveShiftRuleAt(history, productionTsUtcMs);

    // it is rule v3 (06/14/22), not v1 or v2, that was resolved
    expect(rule.boundaries).toEqual(boundaries0622);

    const wc = wallClockOf(new Date(productionTsUtcMs));
    expect(shiftCodeOf(wc, rule.boundaries)).toBe('night');
    const shiftDate = shiftDateOf(wc, rule.nightBelongsTo, rule.boundaries);
    expect(shiftDate.toISOString().slice(0, 10)).toBe('2026-09-18');
  });

  it('a reading at plant 2026-09-14 15:44:00 is evening under whichever rule (v2) applies at that instant', () => {
    const raw = { raw_id: 101, src_ProductionDate: new Date('2026-09-14T15:44:00.000Z'), src_Date: null };
    const productionTsUtcMs = eventMsOfRaw(raw, true, 'pack1_TP1U2');
    const rule = resolveShiftRuleAt(history, productionTsUtcMs);

    // it is rule v2 (05:30/13:30/21:30) in force at this instant, not v3
    expect(rule.boundaries).toEqual(boundaries0513);

    const wc = wallClockOf(new Date(productionTsUtcMs));
    expect(shiftCodeOf(wc, rule.boundaries)).toBe('evening');
    // and it would still read evening under v3's boundaries too — "evening either way"
    expect(shiftCodeOf(wc, boundaries0622)).toBe('evening');
  });
});
