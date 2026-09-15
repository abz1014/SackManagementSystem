/**
 * Roadmap Phase 8 (15 Sep 2026): the Report screen's pure logic — the
 * filters each type offers (mirroring the server's FILTERS_BY_TYPE), the
 * query a period becomes, and the words a change is printed with.
 */
import { describe, it, expect } from 'vitest';
import { acceptsFilter, digitsFor, filtersFor, fmtDelta, FILTERS_BY_TYPE, pollKey, queryFor, REPORT_MIN_RANK } from './model';
import type { Period } from '../../lib/period';

const shiftPeriod: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsTo: '2026-09-07T09:00:00.000Z', shift: 'morning', live: true, days: 1,
};
const week: Period = { key: 'week', from: '2026-09-01', to: '2026-09-07', tsTo: '2026-09-07T09:00:00.000Z', live: false, days: 7 };

describe('queryFor', () => {
  it('sends the period as custom dates, and "this shift" as the shift filter where the type takes one', () => {
    expect(queryFor('daily', shiftPeriod, {}, null)).toEqual({ period: 'custom', from: '2026-09-07', to: '2026-09-07', at: null, shift: 'morning' });
    // A type that takes no shift never sends the period's.
    expect(queryFor('cone-weight', shiftPeriod, {}, null)).toEqual({ period: 'custom', from: '2026-09-07', to: '2026-09-07', at: null });
  });
  it('an explicit shift wins over the period’s, and station/product go only where accepted', () => {
    expect(queryFor('reject', week, { shift: 'night', station: 7, product: 21 }, '2026-09-07T09:00:00.000Z')).toEqual({
      period: 'custom', from: '2026-09-01', to: '2026-09-07', at: '2026-09-07T09:00:00.000Z', shift: 'night', station: 7, product: 21,
    });
    expect(queryFor('product', week, { shift: 'night', station: 7, product: 21 }, null)).toEqual({
      period: 'custom', from: '2026-09-01', to: '2026-09-07', at: null, shift: 'night', station: 7,
    });
    expect(queryFor('calibration', week, { shift: 'night', station: 7 }, null)).toEqual({
      period: 'custom', from: '2026-09-01', to: '2026-09-07', at: null, station: 7,
    });
  });
});

describe('filtersFor', () => {
  it('drops a chosen filter the new type does not take', () => {
    expect(filtersFor('station', { shift: 'night', station: 7, product: 21 })).toEqual({});
    expect(filtersFor('sack', { shift: 'night', station: 7 })).toEqual({ shift: 'night' });
    expect(filtersFor('reject', { shift: 'night', station: 7, product: 21 })).toEqual({ shift: 'night', station: 7, product: 21 });
  });
});

describe('the filter table and the ranks', () => {
  it('every type has an entry; the management summary is the only rank-3 read', () => {
    for (const t of Object.keys(FILTERS_BY_TYPE)) expect(REPORT_MIN_RANK[t as keyof typeof REPORT_MIN_RANK]).toBeDefined();
    expect(Object.entries(REPORT_MIN_RANK).filter(([, r]) => r === 3).map(([k]) => k)).toEqual(['management-summary']);
    expect(acceptsFilter('reject', 'product')).toBe(true);
    expect(acceptsFilter('daily', 'product')).toBe(false);
  });
  it('the poll key changes with every part of the query', () => {
    const a = pollKey('daily', queryFor('daily', week, {}, null));
    const b = pollKey('daily', queryFor('daily', week, { shift: 'night' }, null));
    expect(a).not.toBe(b);
    expect(pollKey('reject', queryFor('reject', week, {}, null))).not.toBe(a);
  });
});

describe('fmtDelta', () => {
  it('prints the sign, the amount and the share', () => {
    expect(fmtDelta({ abs: 120, pct: 4.2 })).toBe('+120 (+4.2 %)');
    expect(fmtDelta({ abs: -3, pct: -1.04 })).toBe('−3 (−1.0 %)');
    expect(fmtDelta({ abs: 0.5, pct: 2 }, 1)).toBe('+0.5 (+2.0 %)');
  });
  it('a zero change is "0", an unknown one a dash, a prior of zero has no share', () => {
    expect(fmtDelta({ abs: 0, pct: 0 })).toBe('0');
    expect(fmtDelta(null)).toBe('—');
    expect(fmtDelta({ abs: 5, pct: null })).toBe('+5');
  });
  it('decimal places follow the unit', () => {
    expect(digitsFor('%')).toBe(1);
    expect(digitsFor('g')).toBe(1);
    expect(digitsFor('cones')).toBe(0);
  });
});
