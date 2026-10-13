import { describe, expect, it } from 'vitest';
import { zeroBasedDomain } from './domain';

describe('zeroBasedDomain', () => {
  it('starts count axes at exactly 0 (the shared niceDomain padded below zero)', () => {
    for (const vals of [[100, 900, 1500], [0, 3], [5], [12, 20, 31]]) {
      const [lo, hi] = zeroBasedDomain(vals, { pad: 0.05 });
      expect(lo).toBe(0);
      expect(hi).toBeGreaterThanOrEqual(Math.max(...vals));
    }
  });
  it('keeps a real negative range', () => {
    const [lo] = zeroBasedDomain([-4, 10]);
    expect(lo).toBeLessThan(0);
  });
  it('handles no data', () => {
    expect(zeroBasedDomain([])[0]).toBe(0);
  });
});
