/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): the report header states a
 * shift-bounded period in plain words — "2 Sep morning shift – 3 Sep night
 * shift" — via `describeShiftRangePeriod`, and `buildHeader` sets
 * `periodLabel` from it when a `shiftRange` was given. "Plant time" stays
 * stated once, on `generatedAtPlantUtc`'s own caller, never repeated here.
 */
import { describe, expect, it } from 'vitest';
import { describeShiftRangePeriod } from './header.js';
import type { ShiftRange } from '../../shiftRange.js';

describe('describeShiftRangePeriod', () => {
  it('a multi-day, multi-shift range: "2 Sep morning shift – 3 Sep night shift"', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };
    expect(describeShiftRangePeriod(range)).toBe('2 Sep morning shift – 3 Sep night shift');
  });

  it('a same-day, same-shift range prints as ONE shift, not a redundant range', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' };
    expect(describeShiftRangePeriod(range)).toBe('2 Sep evening shift');
  });

  it('a same-day range spanning two different shifts still prints as a range', () => {
    const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-02', toShift: 'evening' };
    expect(describeShiftRangePeriod(range)).toBe('2 Sep morning shift – 2 Sep evening shift');
  });
});
