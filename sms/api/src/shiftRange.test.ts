import { describe, it, expect } from 'vitest';
import { shiftBoundariesFrom, DEFAULT_SHIFT_BOUNDARIES } from '@sms/shared';
import {
  shiftOrd,
  shiftRangeQuery,
  parseShiftRange,
  shiftRangeClause,
  shiftRangeEdgesUtc,
  type ShiftRange,
  type ShiftRangeSqlRequest,
} from './shiftRange.js';

// ----------------------------------------------------------------- shiftOrd

describe('shiftOrd', () => {
  it('maps morning/evening/night to 1/2/3', () => {
    expect(shiftOrd('morning')).toBe(1);
    expect(shiftOrd('evening')).toBe(2);
    expect(shiftOrd('night')).toBe(3);
  });
});

// ------------------------------------------------------------- the validator

describe('shiftRangeQuery (zod)', () => {
  it('accepts plain from/to with no shift fields at all', () => {
    const r = shiftRangeQuery.safeParse({ from: '2026-09-02', to: '2026-09-03' });
    expect(r.success).toBe(true);
  });

  it('accepts no fields at all', () => {
    expect(shiftRangeQuery.safeParse({}).success).toBe(true);
  });

  it('accepts a full, well-ordered shift range', () => {
    const r = shiftRangeQuery.safeParse({
      from: '2026-09-02',
      fromShift: 'morning',
      to: '2026-09-03',
      toShift: 'night',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a same-day, same-shift range (a single shift)', () => {
    const r = shiftRangeQuery.safeParse({
      from: '2026-09-02',
      fromShift: 'evening',
      to: '2026-09-02',
      toShift: 'evening',
    });
    expect(r.success).toBe(true);
  });

  it('rejects fromShift given without toShift', () => {
    const r = shiftRangeQuery.safeParse({ from: '2026-09-02', to: '2026-09-03', fromShift: 'morning' });
    expect(r.success).toBe(false);
  });

  it('rejects toShift given without fromShift', () => {
    const r = shiftRangeQuery.safeParse({ from: '2026-09-02', to: '2026-09-03', toShift: 'night' });
    expect(r.success).toBe(false);
  });

  it('rejects fromShift/toShift given without from', () => {
    const r = shiftRangeQuery.safeParse({ to: '2026-09-03', fromShift: 'morning', toShift: 'night' });
    expect(r.success).toBe(false);
  });

  it('rejects fromShift/toShift given without to', () => {
    const r = shiftRangeQuery.safeParse({ from: '2026-09-02', fromShift: 'morning', toShift: 'night' });
    expect(r.success).toBe(false);
  });

  it('rejects a start later than the end (date order)', () => {
    const r = shiftRangeQuery.safeParse({
      from: '2026-09-05',
      fromShift: 'morning',
      to: '2026-09-02',
      toShift: 'night',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a start later than the end on the same day (shift order)', () => {
    const r = shiftRangeQuery.safeParse({
      from: '2026-09-02',
      fromShift: 'night',
      to: '2026-09-02',
      toShift: 'morning',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a bad shift enum value', () => {
    const r = shiftRangeQuery.safeParse({
      from: '2026-09-02',
      fromShift: 'afternoon',
      to: '2026-09-03',
      toShift: 'night',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an impossible calendar date the same way isoDate does elsewhere', () => {
    const r = shiftRangeQuery.safeParse({
      from: '2026-02-30',
      fromShift: 'morning',
      to: '2026-09-03',
      toShift: 'night',
    });
    expect(r.success).toBe(false);
  });
});

describe('parseShiftRange', () => {
  it('returns undefined when no shift fields are given', () => {
    expect(parseShiftRange({ from: '2026-09-02', to: '2026-09-03' })).toBeUndefined();
    expect(parseShiftRange({})).toBeUndefined();
  });

  it('returns the resolved ShiftRange for a valid pair', () => {
    const result = parseShiftRange({
      from: '2026-09-02',
      fromShift: 'morning',
      to: '2026-09-03',
      toShift: 'night',
    });
    expect(result).toEqual<ShiftRange>({
      from: '2026-09-02',
      fromShift: 'morning',
      to: '2026-09-03',
      toShift: 'night',
    });
  });

  it('allows a same-shift range', () => {
    const result = parseShiftRange({
      from: '2026-09-02',
      fromShift: 'evening',
      to: '2026-09-02',
      toShift: 'evening',
    });
    expect(result).toEqual<ShiftRange>({
      from: '2026-09-02',
      fromShift: 'evening',
      to: '2026-09-02',
      toShift: 'evening',
    });
  });

  it('errors when only one half of the pair is given', () => {
    const result = parseShiftRange({ from: '2026-09-02', to: '2026-09-03', fromShift: 'morning' });
    expect(result).toHaveProperty('error');
  });

  it('errors when from/to are missing', () => {
    const result = parseShiftRange({ fromShift: 'morning', toShift: 'night' });
    expect(result).toHaveProperty('error');
  });

  it('errors when the start is after the end', () => {
    const result = parseShiftRange({
      from: '2026-09-05',
      fromShift: 'morning',
      to: '2026-09-02',
      toShift: 'night',
    });
    expect(result).toHaveProperty('error');
  });

  it('errors on a bad enum value', () => {
    const result = parseShiftRange({
      from: '2026-09-02',
      fromShift: 'nope',
      to: '2026-09-03',
      toShift: 'night',
    });
    expect(result).toHaveProperty('error');
  });

  it('errors on an impossible calendar date', () => {
    const result = parseShiftRange({
      from: '2026-02-30',
      fromShift: 'morning',
      to: '2026-09-03',
      toShift: 'night',
    });
    expect(result).toHaveProperty('error');
  });
});

// ----------------------------------------------------------------- the clause

function stubRequest(): ShiftRangeSqlRequest & { calls: [string, unknown, unknown][] } {
  const calls: [string, unknown, unknown][] = [];
  return {
    calls,
    input(name: string, type: unknown, value: unknown) {
      calls.push([name, type, value]);
      return this;
    },
  };
}

describe('shiftRangeClause', () => {
  const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

  it('returns the expected parameterised clause text', () => {
    const req = stubRequest();
    const clause = shiftRangeClause(range, { date: 'shift_date', code: 'shift_code' }, req);
    expect(clause).toBe(
      "(shift_date > @srFrom OR (shift_date = @srFrom AND (CASE shift_code WHEN 'morning' THEN 1 WHEN 'evening' THEN 2 WHEN 'night' THEN 3 ELSE 0 END) >= @srFromOrd))" +
        " AND (shift_date < @srTo OR (shift_date = @srTo AND (CASE shift_code WHEN 'morning' THEN 1 WHEN 'evening' THEN 2 WHEN 'night' THEN 3 ELSE 0 END) <= @srToOrd))",
    );
  });

  it('binds from/to and their shift ordinals on the request', () => {
    const req = stubRequest();
    shiftRangeClause(range, { date: 'shift_date', code: 'shift_code' }, req);
    const byName = Object.fromEntries(req.calls.map(([n, , v]) => [n, v]));
    expect(byName.srFrom).toBe('2026-09-02');
    expect(byName.srFromOrd).toBe(1); // morning
    expect(byName.srTo).toBe('2026-09-03');
    expect(byName.srToOrd).toBe(3); // night
  });

  it('accepts a dotted alias (table-qualified column)', () => {
    const req = stubRequest();
    const clause = shiftRangeClause(range, { date: 'ce.shift_date', code: 'ce.shift_code' }, req);
    expect(clause).toContain('ce.shift_date');
    expect(clause).toContain('ce.shift_code');
  });

  it('refuses an unsafe identifier rather than interpolate it', () => {
    const req = stubRequest();
    expect(() => shiftRangeClause(range, { date: 'shift_date; DROP TABLE x--', code: 'shift_code' }, req)).toThrow();
  });

  it('refuses an unsafe code identifier too', () => {
    const req = stubRequest();
    expect(() => shiftRangeClause(range, { date: 'shift_date', code: '1=1)--' }, req)).toThrow();
  });
});

// ------------------------------------------------------------------- edges

describe('shiftRangeEdgesUtc', () => {
  it('gives the morning start as the from-edge and matches DEFAULT boundaries', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-02', toShift: 'morning' };
    const { fromMs } = shiftRangeEdgesUtc(range);
    expect(new Date(fromMs).toISOString()).toBe('2026-09-02T06:00:00.000Z');
  });

  it('gives the evening end (= night start) as the to-edge for an evening shift', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' };
    const { fromMs, toMs } = shiftRangeEdgesUtc(range);
    expect(new Date(fromMs).toISOString()).toBe('2026-09-02T14:00:00.000Z');
    expect(new Date(toMs).toISOString()).toBe('2026-09-02T22:00:00.000Z');
  });

  it('a night shift crosses midnight: starts at 22:00 and ends at 06:00 the NEXT day', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'night', to: '2026-09-02', toShift: 'night' };
    const { fromMs, toMs } = shiftRangeEdgesUtc(range);
    expect(new Date(fromMs).toISOString()).toBe('2026-09-02T22:00:00.000Z');
    expect(new Date(toMs).toISOString()).toBe('2026-09-03T06:00:00.000Z');
  });

  it('a full morning-to-night range spans from the first day 06:00 to the second day+1 06:00', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };
    const { fromMs, toMs } = shiftRangeEdgesUtc(range);
    expect(new Date(fromMs).toISOString()).toBe('2026-09-02T06:00:00.000Z');
    expect(new Date(toMs).toISOString()).toBe('2026-09-04T06:00:00.000Z');
  });

  it('defaults to DEFAULT_SHIFT_BOUNDARIES when no rule is passed', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-02', toShift: 'morning' };
    const withDefault = shiftRangeEdgesUtc(range);
    const withExplicit = shiftRangeEdgesUtc(range, DEFAULT_SHIFT_BOUNDARIES);
    expect(withDefault).toEqual(withExplicit);
  });

  it('a shift-rule regime change: edges differ on each side of the change, using the boundaries in force', () => {
    // The line's shift rule BEFORE some change: the plant default, 06/14/22.
    const oldRule = DEFAULT_SHIFT_BOUNDARIES;
    // AFTER a Setup change: boundaries moved an hour later, 07/15/23 — still
    // built with the same validated helper the admin route uses
    // (shiftBoundariesFrom), so this exercises the real regime shape rather
    // than a hand-built object.
    const newRule = shiftBoundariesFrom('07:00', '15:00', '23:00')!;
    expect(newRule).not.toBeNull();

    // A reading the day BEFORE the rule changed: judged under the old regime.
    const beforeChange: ShiftRange = { from: '2026-09-01', fromShift: 'morning', to: '2026-09-01', toShift: 'morning' };
    const beforeEdges = shiftRangeEdgesUtc(beforeChange, oldRule);
    expect(new Date(beforeEdges.fromMs).toISOString()).toBe('2026-09-01T06:00:00.000Z');

    // The same shift NAME the day the new rule is in force: judged under the
    // new regime — the caller resolves which `rule` applies per side, this
    // function just applies whichever `ShiftBoundaries` it is given.
    const afterChange: ShiftRange = { from: '2026-09-05', fromShift: 'morning', to: '2026-09-05', toShift: 'morning' };
    const afterEdges = shiftRangeEdgesUtc(afterChange, newRule);
    expect(new Date(afterEdges.fromMs).toISOString()).toBe('2026-09-05T07:00:00.000Z');

    // Same shift name, different regime → genuinely different instants.
    expect(afterEdges.fromMs - Date.parse('2026-09-05T00:00:00.000Z')).not.toBe(
      beforeEdges.fromMs - Date.parse('2026-09-01T00:00:00.000Z'),
    );
  });
});
