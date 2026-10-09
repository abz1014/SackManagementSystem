/**
 * S3 X-3 (Stage 3, 9 Oct 2026). User impact: when the chosen period lies after the newest reading on record, the
 * screens said only "no cones were weighed in this period" and a reader could not tell "the line made nothing" from
 * "the data ends earlier". `periodAfterNewest` is the one certain test for that case: true only when the whole
 * period starts after the newest reading, never on a guess.
 */
import { describe, expect, it } from 'vitest';
import { periodAfterNewest, resolvePeriod, type PeriodAnchor } from './period';

const NEWEST = '2026-09-07T12:00:28.860Z';

const anchor: PeriodAnchor = {
  shiftDate: '2026-10-08', shiftCode: 'morning', shiftStartUtc: '2026-10-08T06:00:00.000Z',
  plantNowUtc: '2026-10-08T10:00:00.000Z', dataAsOfUtc: NEWEST, firstDay: '2026-08-05',
};

describe('periodAfterNewest', () => {
  it('a picked day after the newest reading day is after it', () => {
    expect(periodAfterNewest(resolvePeriod('pick', anchor, { from: '2026-09-08', to: '2026-09-08' }), NEWEST)).toBe(true);
  });

  it('a picked range that ends on the newest reading day is not', () => {
    expect(periodAfterNewest(resolvePeriod('pick', anchor, { from: '2026-09-01', to: '2026-09-07' }), NEWEST)).toBe(false);
  });

  it('this shift on a day after the data ends is after it (the shift starts later than the newest reading)', () => {
    expect(periodAfterNewest(resolvePeriod('shift', anchor), NEWEST)).toBe(true);
  });

  it('a shift range that ends before the newest reading is not', () => {
    const p = resolvePeriod('range', anchor, undefined, { from: { date: '2026-09-05', shift: 'morning' }, to: { date: '2026-09-06', shift: 'night' } });
    expect(periodAfterNewest(p, NEWEST)).toBe(false);
  });

  it('a shift that starts before the newest reading, on the same day, is not (never a false claim)', () => {
    const p = resolvePeriod('range', anchor, undefined, { from: { date: '2026-09-07', shift: 'morning' }, to: { date: '2026-09-07', shift: 'morning' } });
    expect(periodAfterNewest(p, NEWEST)).toBe(false);
  });

  it('a day-grained period on the newest reading calendar day is not (a night shift edge falls back to the old sentence)', () => {
    expect(periodAfterNewest(resolvePeriod('pick', anchor, { from: '2026-09-07', to: '2026-09-07' }), NEWEST)).toBe(false);
  });

  it('no newest reading on record means nothing can be claimed', () => {
    expect(periodAfterNewest(resolvePeriod('shift', anchor), null)).toBe(false);
    expect(periodAfterNewest(resolvePeriod('shift', anchor), undefined)).toBe(false);
  });
});
