/** C-117 (D-98): cones per sack is a ratio of two counts, so it keeps one decimal; cone totals stay whole numbers. */
import { describe, expect, it } from 'vitest';
import { digitsFor, fmtDelta } from './model';

describe('digitsFor by KPI key', () => {
  it('cones per sack prints one decimal, so 24.2 / 22.7 / +1.5 reconcile', () => {
    expect(digitsFor('cones', 'cones_per_sack')).toBe(1);
    expect(fmtDelta({ abs: 1.5, pct: 6.6 }, digitsFor('cones', 'cones_per_sack')).replace(/\s/g, ' ')).toBe('+1.5 (+6.6 %)');
    expect((24.2).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('24.2');
  });
  it('cone totals stay whole', () => {
    expect(digitsFor('cones', 'cones_weighed')).toBe(0);
    expect(digitsFor('cones')).toBe(0);
  });
});
