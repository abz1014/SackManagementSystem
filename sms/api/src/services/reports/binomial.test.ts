/**
 * The exact binomial upper tail (binomial.ts). The reference values were
 * computed outside this code with exact big-number arithmetic (Python's
 * `decimal`, 80 digits, summing C(n,k) p^k (1-p)^(n-k) term by term, with p the
 * exact value of the double) — not with the recurrence under test.
 */
import { describe, it, expect } from 'vitest';
import { binomialUpperTail, logBinomialUpperTail, logChoose, logFactorial } from './binomial.js';

/** Relative difference, for values far below 1 where an absolute tolerance would pass anything. */
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe('logFactorial / logChoose', () => {
  it('matches the factorials we can write down', () => {
    expect(logFactorial(0)).toBe(0);
    expect(logFactorial(1)).toBe(0);
    expect(Math.exp(logFactorial(10))).toBeCloseTo(3628800, 4);
    expect(logFactorial(20)).toBeCloseTo(Math.log(2432902008176640000), 12);
  });

  it('the exact and Stirling branches agree across the n = 50 hand-over', () => {
    // ln(50!) = ln(49!) + ln(50): the Stirling value at 50 must land on the exact sum at 49 plus one term.
    expect(logFactorial(50)).toBeCloseTo(logFactorial(49) + Math.log(50), 12);
    expect(logFactorial(51)).toBeCloseTo(logFactorial(50) + Math.log(51), 12);
  });

  it('C(10, 3) = 120 and C(52, 5) = 2,598,960', () => {
    expect(Math.exp(logChoose(10, 3))).toBeCloseTo(120, 9);
    expect(Math.exp(logChoose(52, 5))).toBeCloseTo(2598960, 4);
  });
});

describe('binomialUpperTail — against exact reference values', () => {
  // [x, n, p, P(X >= x), ln P]
  const CASES: [number, number, number, number, number][] = [
    [8, 10, 0.5, 0.0546875, -2.906120114864304],
    [5, 100, 0.01, 0.0034323215877545155, -5.674518399020573],
    [1, 50, 0.001, 0.04879437180296865, -3.0201403046806514],
    [25, 300, 0.05, 0.009348804278158866, -4.672506828548377],
    [12, 200, 0.0285, 0.012845269374161031, -4.354779677510479],
    [130, 5000, 0.02, 0.002070960283679285, -6.179742874116516],
    [1600, 3000, 0.5, 0.00013928198051961686, -8.879010042906868],
    [300, 2000, 0.1, 1.5652064462134365e-12, -27.18300338612301],
    // The shape the report exists for: a hanger with 58 rejects among 471 inspected cones at a 3% line rate.
    [58, 471, 0.03, 2.4482094751234825e-19, -42.8537598359943],
    [100, 2000, 0.01, 6.886295305645728e-38, -85.56870028484435],
    // The other end: x far below the mean, tail almost 1.
    [5, 400, 0.05, 0.9999878982675376, -1.2101805688906635e-05],
    [2, 6000, 0.0005, 0.8009264195801973, -0.22198619683211004],
  ];

  it.each(CASES)('P(X >= %i | n=%i, p=%f) = %e', (x, n, p, want, wantLog) => {
    expect(rel(binomialUpperTail(x, n, p), want)).toBeLessThan(1e-9);
    expect(Math.abs(logBinomialUpperTail(x, n, p) - wantLog)).toBeLessThan(1e-9 * Math.max(1, Math.abs(wantLog)));
  });

  it('the exact value for a small case can be checked by hand: n=10, p=0.5, x=8 is (45 + 10 + 1) / 1024', () => {
    expect(binomialUpperTail(8, 10, 0.5)).toBeCloseTo(56 / 1024, 14);
  });

  it('stays finite in log space where the plain number underflows to 0', () => {
    // n = 5000, p = 0.001, x = 500: about 1e-400, below the smallest double.
    expect(binomialUpperTail(500, 5000, 0.001)).toBe(0);
    const ln = logBinomialUpperTail(500, 5000, 0.001);
    expect(Number.isFinite(ln)).toBe(true);
    expect(ln).toBeLessThan(-745);
  });

  it('is monotone: a bigger count, or a lower rate, never makes the tail larger', () => {
    let prev = 1;
    for (let x = 0; x <= 80; x++) {
      const t = binomialUpperTail(x, 471, 0.03);
      expect(t).toBeLessThanOrEqual(prev + 1e-15);
      prev = t;
    }
    expect(binomialUpperTail(20, 471, 0.02)).toBeLessThan(binomialUpperTail(20, 471, 0.03));
  });

  it('a tail never exceeds one, even where rounding pushes the sum a hair over', () => {
    for (const [x, n, p] of [[1, 1000, 0.5], [3, 600, 0.4], [0, 10, 0.3], [250, 500, 0.5]] as const) {
      expect(logBinomialUpperTail(x, n, p)).toBeLessThanOrEqual(0);
    }
  });
});

describe('edge cases', () => {
  it('x <= 0 is certain, x > n is impossible', () => {
    expect(binomialUpperTail(0, 50, 0.2)).toBe(1);
    expect(binomialUpperTail(-3, 50, 0.2)).toBe(1);
    expect(binomialUpperTail(51, 50, 0.2)).toBe(0);
    expect(logBinomialUpperTail(51, 50, 0.2)).toBe(-Infinity);
  });

  it('p = 0 makes any rejects impossible, p = 1 makes them certain', () => {
    expect(binomialUpperTail(1, 50, 0)).toBe(0);
    expect(binomialUpperTail(0, 50, 0)).toBe(1);
    expect(binomialUpperTail(50, 50, 1)).toBe(1);
    expect(binomialUpperTail(51, 50, 1)).toBe(0);
  });

  it('x = n is p^n', () => {
    expect(binomialUpperTail(5, 5, 0.3)).toBeCloseTo(0.3 ** 5, 14);
  });

  it('n = 0', () => {
    expect(binomialUpperTail(0, 0, 0.5)).toBe(1);
    expect(binomialUpperTail(1, 0, 0.5)).toBe(0);
  });

  it('refuses inputs that are not a probability question rather than answering wrongly', () => {
    expect(() => binomialUpperTail(1.5, 10, 0.5)).toThrow(RangeError);
    expect(() => binomialUpperTail(1, 10.5, 0.5)).toThrow(RangeError);
    expect(() => binomialUpperTail(1, -1, 0.5)).toThrow(RangeError);
    expect(() => binomialUpperTail(1, 10, -0.1)).toThrow(RangeError);
    expect(() => binomialUpperTail(1, 10, 1.1)).toThrow(RangeError);
    expect(() => binomialUpperTail(1, 10, Number.NaN)).toThrow(RangeError);
  });
});
