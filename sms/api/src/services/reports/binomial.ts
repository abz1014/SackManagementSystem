/**
 * The exact binomial upper tail, in log space — IFL reports task C-R7
 * (1 Oct 2026), for the Rejected Cone Hangers Report's "stands out in this
 * period" flag.
 *
 * P(X >= x | n, p) = sum over k = x..n of C(n,k) p^k (1-p)^(n-k): the chance of
 * seeing x or more rejects among n inspected cones if every cone carried the
 * line's own reject rate p. It is summed term by term from the exact pmf, with
 * no normal or Poisson approximation, because the hangers that matter are
 * exactly the ones with a small n and a small p, where those approximations are
 * wrong in the tail that decides the flag.
 *
 * LOG SPACE, BECAUSE THE TAIL CAN BE SMALLER THAN A DOUBLE HOLDS. Hanger 91's
 * 58 rejects in 471 cones at the September line rate is about 2e-19: fine as a
 * double, but over 2,000 cones the same shape is below 1e-300 and
 * `Math.exp` would hand back an unhelpful 0. The comparison the report makes
 * (tail < alpha / H) is therefore done on the logarithm, and `binomialUpperTail`
 * is only the convenience wrapper for anyone who wants the plain number.
 *
 * The first term is built from ln(n!) (exact summation for small n, the
 * Stirling series from n = 50, error below 1e-15); every later term follows
 * from the previous one by the ratio (n-k)/(k+1) * p/(1-p), so the whole sum
 * costs one pass of n - x steps and stops early once the terms past the mode
 * can no longer move the total.
 */

/** ln(n!) — exact summation below 50, the Stirling series (three correction terms) from there. */
export function logFactorial(n: number): number {
  if (n < 2) return 0;
  if (n < 50) {
    let s = 0;
    for (let i = 2; i <= n; i++) s += Math.log(i);
    return s;
  }
  const inv = 1 / n;
  const inv2 = inv * inv;
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n) + inv / 12 - (inv * inv2) / 360 + (inv * inv2 * inv2) / 1260;
}

/** ln C(n, k). */
export function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** ln(e^a + e^b) without overflow. */
function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const hi = Math.max(a, b);
  return hi + Math.log1p(Math.exp(-Math.abs(a - b)));
}

/** Terms this far (in natural log) below the running total, past the mode, cannot change it at double precision. */
const NEGLIGIBLE = 50;

/**
 * ln P(X >= x) for X ~ Binomial(n, p). `x` and `n` are whole numbers; an
 * invalid input (negative or non-integer n, p outside [0, 1], NaN) throws
 * rather than returning a probability that is quietly wrong.
 *
 *   x <= 0        -> 0        (certain)
 *   x > n         -> -Infinity (impossible)
 *   p = 0         -> -Infinity (for x >= 1)
 *   p = 1         -> 0         (for x <= n)
 */
export function logBinomialUpperTail(x: number, n: number, p: number): number {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(x) || !(p >= 0 && p <= 1)) {
    throw new RangeError(`logBinomialUpperTail needs whole x and n >= 0 and 0 <= p <= 1 (got x=${x}, n=${n}, p=${p})`);
  }
  if (x <= 0) return 0;
  if (x > n) return -Infinity;
  if (p === 0) return -Infinity;
  if (p === 1) return 0;

  const lnP = Math.log(p);
  const lnQ = Math.log1p(-p);
  const ratio = lnP - lnQ;
  const mode = Math.floor((n + 1) * p);

  let logTerm = logChoose(n, x) + x * lnP + (n - x) * lnQ;
  let logSum = logTerm;
  for (let k = x; k < n; k++) {
    logTerm += Math.log((n - k) / (k + 1)) + ratio;
    logSum = logAdd(logSum, logTerm);
    if (k + 1 > mode && logTerm < logSum - NEGLIGIBLE) break;
  }
  // A sum of probabilities cannot exceed one; rounding can nudge it a hair over.
  return Math.min(0, logSum);
}

/** P(X >= x) for X ~ Binomial(n, p): `Math.exp` of the log form, so 0 when the tail is below the double range. */
export function binomialUpperTail(x: number, n: number, p: number): number {
  return Math.exp(logBinomialUpperTail(x, n, p));
}
