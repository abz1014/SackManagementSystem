/**
 * UX Phase 11 (22 Sep 2026): the station row's median reference line
 * (`Line.tsx`'s `StationRowGrid`/`StationBar`) draws every cell's dashed
 * line at the SAME fraction — the row's own median count over the row's own
 * max count — so fourteen short per-cell segments read as one line across
 * the strip (verified live: `medianTop` identical across all fourteen
 * `.bar-median` elements at a fixed viewport). This file locks down the one
 * pure calculation behind that: `median()`, exported from Line.tsx for
 * exactly this test.
 */
import { describe, expect, it } from 'vitest';
import { median } from './Line';

describe('median (Line.tsx station bar reference line)', () => {
  it('an odd-length set: the exact middle value', () => {
    expect(median([79, 200, 88])).toBe(88);
  });

  it('an even-length set: the average of the two middle values', () => {
    expect(median([79, 82, 88, 200])).toBe(85);
  });

  it('unsorted input is sorted before finding the middle', () => {
    expect(median([200, 79, 88, 82, 240])).toBe(88);
  });

  it('a single value is its own median', () => {
    expect(median([42])).toBe(42);
  });

  it('an empty set is 0, not NaN — the row draws no reference line while counts are still loading', () => {
    expect(median([])).toBe(0);
  });

  it('does not mutate the array it is given', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
