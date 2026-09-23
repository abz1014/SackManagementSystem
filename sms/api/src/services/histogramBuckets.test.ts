/**
 * HISTOGRAM BUCKET WIDTHS, derived from the readings (weights.ts, 23 Sep 2026).
 *
 * The defect these lock down: both histograms were binned at a hardcoded
 * width, and both were wider than the spread they were drawing.
 *
 *   sacks at 1 kg, epoch 2 (IFL's July generation, 22 Jun - 10 Jul): sd is
 *     0.121 kg, so 5,438 of 5,459 readings — 99.6 % — fell in the single
 *     47 kg bucket. The sack-weight distribution chart was ONE BAR, which is
 *     why no usable sack distribution existed anywhere in the app.
 *   cones at 20 g, epoch 1: sd is 8.86 g, so 107,834 of 142,296 — 75.8 % —
 *     fell in the single 1940 g bucket, three bars in all. The SAME fault,
 *     one order of magnitude less obvious, which is the reason it survived.
 *
 * Both figures were measured against the sidecar before the fix was written,
 * per generation, and NEVER against epoch 13 — the plant simulator's rows,
 * which are 71 % of everything on screen over 21 Aug - 7 Sep and would have
 * made a distribution look fine that IFL's own data does not.
 *
 * After the fix, measured by running the real `getWeights` against the real
 * sidecar on both of IFL's generations (simulator excluded, nothing else in
 * the window): cones 2 g / 75 bars / modal bar 9.5 % on gen 1; sacks 0.02 kg
 * / 47 bars on gen 1 and 0.05 kg / 21 bars on gen 3. The width DIFFERS
 * between the two generations, which is the point — and the reason
 * `bucketSize` must be printed beside every chart.
 */
import { describe, expect, it } from 'vitest';
import { binWidth, niceWidth } from './weights.js';

describe('niceWidth — the 1/2/5 ladder', () => {
  it('snaps to 1, 2 or 5 times a power of ten', () => {
    expect(niceWidth(1.0)).toBe(1);
    expect(niceWidth(1.4)).toBe(1);
    expect(niceWidth(2.214)).toBe(2); // cone gen 1: 8 * 8.856 / 32
    expect(niceWidth(3.4)).toBe(2);
    expect(niceWidth(4.75)).toBe(5); // sack gen 3: 8 * 0.190 / 32, scaled
    expect(niceWidth(8)).toBe(10);
  });

  it('returns a clean decimal for a sub-unit width, not a float artefact', () => {
    // The whole reason the exponent is applied by DIVISION: a bucket start
    // is rendered as an axis label, and 0.020000000000000004 on a chart is
    // a defect a reader can see.
    expect(niceWidth(0.0303)).toBe(0.02);
    expect(String(niceWidth(0.0303))).toBe('0.02');
    expect(niceWidth(0.04753)).toBe(0.05);
    expect(String(niceWidth(0.04753))).toBe('0.05');
  });
});

describe('binWidth — the measured populations', () => {
  it('cones, IFL gen 1 (sd 8.856 g): 2 g, not the old hardcoded 20 g', () => {
    const w = binWidth(8.856, 1744, 2199);
    expect(w).toBe(2);
    // The regression, stated as arithmetic: the old constant was wider than
    // 2 standard deviations, so it could not resolve the distribution at all.
    expect(20 / 8.856).toBeGreaterThan(2);
    expect(w / 8.856).toBeLessThan(0.3);
  });

  it('cones, IFL gen 3 (sd 8.718 g): also 2 g — stable across generations', () => {
    expect(binWidth(8.718, 1589, 2076)).toBe(2);
  });

  it('sacks, IFL gen 1 (sd 0.121 kg): 0.02 kg, not the old hardcoded 1 kg', () => {
    const w = binWidth(0.12121610089311949, 45.1, 49.3);
    expect(w).toBe(0.02);
    // The one-bar fault, as a ratio: the old bucket was over 8 sd wide.
    expect(1 / 0.1212).toBeGreaterThan(8);
  });

  it('sacks, IFL gen 3 (sd 0.190 kg): 0.05 kg — the width tracks the spread', () => {
    expect(binWidth(0.19013748487199283, 45.04, 55.48)).toBe(0.05);
  });

  it('is driven by the SPREAD, never by the range, when both are available', () => {
    // Gen 3's sacks run to 55.48 kg on a body that sits inside one kilogram.
    // A range-driven rule would be dragged out to ~0.5 kg by that single
    // reading and put the whole distribution back into two bars.
    expect(binWidth(0.19, 45.04, 55.48)).toBe(binWidth(0.19, 46.9, 47.6));
  });
});

describe('binWidth — degenerate populations', () => {
  it('falls back to the range when STDEV() is null (n < 2 in SQL Server)', () => {
    expect(binWidth(null, 100, 420)).toBe(niceWidth(320 / 32));
  });

  it('falls back to the range when every reading is identical but bounded', () => {
    expect(binWidth(0, 10, 42)).toBe(1);
  });

  it('returns a positive width, never 0 or NaN, when there is no spread at all', () => {
    // One distinct value genuinely IS one bar; what must not happen is a
    // zero or NaN width reaching SQL as a divisor.
    for (const w of [binWidth(null, null, null), binWidth(0, 47, 47), binWidth(null, 47, 47)]) {
      expect(w).toBeGreaterThan(0);
      expect(Number.isFinite(w)).toBe(true);
    }
  });

  it('never yields a non-finite width from a non-finite input', () => {
    expect(Number.isFinite(binWidth(Number.POSITIVE_INFINITY, null, null))).toBe(true);
    expect(Number.isFinite(binWidth(Number.NaN, null, null))).toBe(true);
  });
});
