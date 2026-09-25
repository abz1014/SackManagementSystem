import { describe, it, expect } from 'vitest';
import { tCritical90, olsSlopeStats, projectDaysToLimit, MIN_PROJECTION_POINTS } from './calibration.js';

describe('tCritical90 (RT-020)', () => {
  it('matches the hard-coded table at df 1, 2, 10, 30', () => {
    expect(tCritical90(1)).toBeCloseTo(6.314, 3);
    expect(tCritical90(2)).toBeCloseTo(2.92, 3);
    expect(tCritical90(10)).toBeCloseTo(1.812, 3);
    expect(tCritical90(30)).toBeCloseTo(1.697, 3);
  });

  it('uses the normal approximation (1.645) above df=30', () => {
    expect(tCritical90(31)).toBeCloseTo(1.645, 3);
    expect(tCritical90(1000)).toBeCloseTo(1.645, 3);
  });
});

describe('olsSlopeStats (RT-020)', () => {
  it('returns null for fewer than 3 points (df < 1)', () => {
    expect(olsSlopeStats([])).toBeNull();
    expect(olsSlopeStats([{ date: '2026-08-01', mean: 1950 }])).toBeNull();
    expect(
      olsSlopeStats([
        { date: '2026-08-01', mean: 1950 },
        { date: '2026-08-02', mean: 1951 },
      ]),
    ).toBeNull();
  });

  it('a perfect line has zero standard error', () => {
    const pts = [
      { date: '2026-08-01', mean: 1950 },
      { date: '2026-08-02', mean: 1951 },
      { date: '2026-08-03', mean: 1952 },
      { date: '2026-08-04', mean: 1953 },
      { date: '2026-08-05', mean: 1954 },
    ];
    const s = olsSlopeStats(pts)!;
    expect(s.slope).toBeCloseTo(1, 6);
    expect(s.se).toBeCloseTo(0, 6);
    expect(s.df).toBe(3);
    expect(s.ciLow).toBeCloseTo(1, 3);
    expect(s.ciHigh).toBeCloseTo(1, 3);
  });

  it('a wider interval for noisier data around the same trend', () => {
    const clean = [
      { date: '2026-08-01', mean: 1950 },
      { date: '2026-08-02', mean: 1951 },
      { date: '2026-08-03', mean: 1952 },
      { date: '2026-08-04', mean: 1953 },
      { date: '2026-08-05', mean: 1954 },
    ];
    const noisy = [
      { date: '2026-08-01', mean: 1948 },
      { date: '2026-08-02', mean: 1954 },
      { date: '2026-08-03', mean: 1949 },
      { date: '2026-08-04', mean: 1957 },
      { date: '2026-08-05', mean: 1951 },
    ];
    const sClean = olsSlopeStats(clean)!;
    const sNoisy = olsSlopeStats(noisy)!;
    expect(sNoisy.ciHigh - sNoisy.ciLow).toBeGreaterThan(sClean.ciHigh - sClean.ciLow);
  });
});

describe('projectDaysToLimit (RT-020 uncertainty)', () => {
  const limits = { loG: 1900, hiG: 2000, targetG: 1950 };

  it('requires MIN_PROJECTION_POINTS (5) daily points; fewer returns null outright', () => {
    expect(MIN_PROJECTION_POINTS).toBe(5);
    const run = [
      { date: '2026-08-01', mean: 1950 },
      { date: '2026-08-02', mean: 1952 },
      { date: '2026-08-03', mean: 1954 },
      { date: '2026-08-04', mean: 1956 },
    ];
    expect(projectDaysToLimit(run, limits)).toBeNull();
  });

  it('a clean, consistent trend over 5+ days is "established" with a days range', () => {
    const run = [
      { date: '2026-08-01', mean: 1950 },
      { date: '2026-08-02', mean: 1952 },
      { date: '2026-08-03', mean: 1954 },
      { date: '2026-08-04', mean: 1956 },
      { date: '2026-08-05', mean: 1958 },
      { date: '2026-08-06', mean: 1960 },
    ];
    const p = projectDaysToLimit(run, limits)!;
    expect(p.status).toBe('established');
    expect(p.daysToLimit).not.toBeNull();
    expect(p.daysLow).not.toBeNull();
    expect(p.daysHigh).not.toBeNull();
    expect(p.daysLow!).toBeLessThanOrEqual(p.daysHigh!);
    expect(p.nPoints).toBe(6);
    expect(p.confidence).toBe(0.9);
  });

  it('a noisy series whose slope CI includes zero is "not_established"', () => {
    const run = [
      { date: '2026-08-01', mean: 1948 },
      { date: '2026-08-02', mean: 1954 },
      { date: '2026-08-03', mean: 1949 },
      { date: '2026-08-04', mean: 1957 },
      { date: '2026-08-05', mean: 1951 },
      { date: '2026-08-06', mean: 1953 },
    ];
    const p = projectDaysToLimit(run, limits)!;
    expect(p.status).toBe('not_established');
    expect(p.daysToLimit).toBeNull();
    expect(p.daysLow).toBeNull();
    expect(p.daysHigh).toBeNull();
    expect(p.reason).toMatch(/confidence interval/i);
  });

  it('already past the limit gives daysToLimit=0 and daysLow=daysHigh=0, established', () => {
    const run = [
      { date: '2026-08-01', mean: 1990 },
      { date: '2026-08-02', mean: 1995 },
      { date: '2026-08-03', mean: 1998 },
      { date: '2026-08-04', mean: 2002 },
      { date: '2026-08-05', mean: 2005 },
    ];
    const p = projectDaysToLimit(run, limits)!;
    expect(p.status).toBe('established');
    expect(p.daysToLimit).toBe(0);
    expect(p.daysLow).toBe(0);
    expect(p.daysHigh).toBe(0);
  });
});
