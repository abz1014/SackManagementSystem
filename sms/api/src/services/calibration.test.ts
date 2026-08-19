import { describe, it, expect } from 'vitest';
import { individualsSigma } from './calibration.js';

describe('individualsSigma (I-MR sigma for a sequence of daily means)', () => {
  it('is 0 for fewer than 2 points — nothing to measure day-to-day yet', () => {
    expect(individualsSigma([])).toBe(0);
    expect(individualsSigma([100])).toBe(0);
  });

  it('is 0 for identical consecutive values (zero moving range)', () => {
    expect(individualsSigma([100, 100, 100])).toBe(0);
  });

  it('matches the hand-computed value for a known small series', () => {
    // moving ranges: |102-100|=2, |98-102|=4, |104-98|=6 -> mean = 4
    // sigma = 4 / 1.128
    const sigma = individualsSigma([100, 102, 98, 104]);
    expect(sigma).toBeCloseTo(4 / 1.128, 6);
  });

  it('does NOT shrink as more points are added at the same day-to-day scale — unlike a sampling-error SE', () => {
    // The whole point of this estimator: it reflects the size of the swings,
    // not the sample count. A longer series with the same swing size should
    // give (approximately) the same sigma, not a smaller one.
    const short = individualsSigma([1950, 1953, 1948, 1951]);
    const longer = individualsSigma([1950, 1953, 1948, 1951, 1954, 1949, 1952, 1950, 1953, 1948]);
    expect(Math.abs(short - longer)).toBeLessThan(1);
  });

  it('is large for a series with big day-to-day swings, small for a steady one', () => {
    const noisy = individualsSigma([1950, 1965, 1940, 1970, 1935]);
    const steady = individualsSigma([1950, 1950.3, 1949.8, 1950.2, 1949.9]);
    expect(noisy).toBeGreaterThan(steady * 10);
  });
});
