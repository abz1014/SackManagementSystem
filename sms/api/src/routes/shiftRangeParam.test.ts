/**
 * Chart overhaul wave 2, Task TC (28 Sep 2026). Pure-function coverage for
 * `decodeShiftRangeParam` — the route-layer bridge between the web's encoded
 * `fromShift=2026-09-02.morning` wire form and `shiftRange.ts`'s
 * `ShiftRange` shape. No pool, no HTTP: this is RED-then-GREEN commit 1 for
 * every route group this module wires (see app.shiftRange.routes.test.ts
 * for the HTTP-level pin per group).
 */
import { describe, expect, it } from 'vitest';
import { decodeShiftRangeParam, isShiftRangeError } from './shiftRangeParam.js';

describe('decodeShiftRangeParam', () => {
  it('no fromShift/toShift at all — undefined, existing from/to behaviour unchanged', () => {
    expect(decodeShiftRangeParam({ from: '2026-09-02', to: '2026-09-03' })).toBeUndefined();
    expect(decodeShiftRangeParam({})).toBeUndefined();
  });

  it('a valid same-date pair decodes to a ShiftRange', () => {
    const r = decodeShiftRangeParam({
      from: '2026-09-02',
      to: '2026-09-03',
      fromShift: '2026-09-02.morning',
      toShift: '2026-09-03.night',
    });
    expect(isShiftRangeError(r)).toBe(false);
    expect(r).toEqual({ from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' });
  });

  it('works with no plain from/to at all (route with no separate date fields)', () => {
    const r = decodeShiftRangeParam({ fromShift: '2026-09-02.evening', toShift: '2026-09-02.evening' });
    expect(r).toEqual({ from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' });
  });

  it('only fromShift given — error, they come as a pair', () => {
    const r = decodeShiftRangeParam({ fromShift: '2026-09-02.morning' });
    expect(isShiftRangeError(r)).toBe(true);
  });

  it('only toShift given — error, they come as a pair', () => {
    const r = decodeShiftRangeParam({ toShift: '2026-09-02.morning' });
    expect(isShiftRangeError(r)).toBe(true);
  });

  it('malformed fromShift (no dot, bad shift name, bad date) — error', () => {
    expect(isShiftRangeError(decodeShiftRangeParam({ fromShift: 'not-a-ref', toShift: '2026-09-02.morning' }))).toBe(true);
    expect(isShiftRangeError(decodeShiftRangeParam({ fromShift: '2026-09-02.afternoon', toShift: '2026-09-02.night' }))).toBe(true);
    expect(isShiftRangeError(decodeShiftRangeParam({ fromShift: '2026-13-40.morning', toShift: '2026-09-02.night' }))).toBe(true);
  });

  it('fromShift date disagrees with plain from — error, never silently prefers one side', () => {
    const r = decodeShiftRangeParam({
      from: '2026-09-03',
      to: '2026-09-03',
      fromShift: '2026-09-02.morning',
      toShift: '2026-09-03.night',
    });
    expect(isShiftRangeError(r)).toBe(true);
  });

  it('toShift date disagrees with plain to — error', () => {
    const r = decodeShiftRangeParam({
      from: '2026-09-02',
      to: '2026-09-02',
      fromShift: '2026-09-02.morning',
      toShift: '2026-09-03.night',
    });
    expect(isShiftRangeError(r)).toBe(true);
  });

  it('start sorting after end (same day, night before morning) — error, delegated to parseShiftRange', () => {
    const r = decodeShiftRangeParam({
      from: '2026-09-02',
      to: '2026-09-02',
      fromShift: '2026-09-02.night',
      toShift: '2026-09-02.morning',
    });
    expect(isShiftRangeError(r)).toBe(true);
  });

  it('a same-shift, same-day range is explicitly allowed (parseShiftRange\'s own rule)', () => {
    const r = decodeShiftRangeParam({
      from: '2026-09-02',
      to: '2026-09-02',
      fromShift: '2026-09-02.evening',
      toShift: '2026-09-02.evening',
    });
    expect(r).toEqual({ from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' });
  });
});
