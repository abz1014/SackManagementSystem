import { describe, it, expect } from 'vitest';
import { resolvePeriod, daysInRange, toReportLine } from './report.js';

describe('resolvePeriod', () => {
  it('day is the anchor itself', () => {
    expect(resolvePeriod('day', '2026-07-09')).toEqual({ period: 'day', from: '2026-07-09', to: '2026-07-09' });
  });

  it('week runs Monday to Sunday around the anchor', () => {
    // 2026-07-09 is a Thursday
    expect(resolvePeriod('week', '2026-07-09')).toEqual({ period: 'week', from: '2026-07-06', to: '2026-07-12' });
  });

  it('a Sunday anchor belongs to the week that started six days earlier', () => {
    // 2026-07-12 is a Sunday; ISO weeks end on it rather than starting it
    expect(resolvePeriod('week', '2026-07-12')).toEqual({ period: 'week', from: '2026-07-06', to: '2026-07-12' });
  });

  it('a Monday anchor starts its own week', () => {
    expect(resolvePeriod('week', '2026-07-06')).toEqual({ period: 'week', from: '2026-07-06', to: '2026-07-12' });
  });

  it('week may cross a month boundary', () => {
    // 2026-07-01 is a Wednesday, so its week reaches back into June
    expect(resolvePeriod('week', '2026-07-01')).toEqual({ period: 'week', from: '2026-06-29', to: '2026-07-05' });
  });

  it('month is the calendar month, not a trailing 30 days', () => {
    expect(resolvePeriod('month', '2026-07-09')).toEqual({ period: 'month', from: '2026-07-01', to: '2026-07-31' });
  });

  it('month handles a 30-day month and February', () => {
    expect(resolvePeriod('month', '2026-06-15').to).toBe('2026-06-30');
    expect(resolvePeriod('month', '2026-02-10').to).toBe('2026-02-28');
    expect(resolvePeriod('month', '2024-02-10').to).toBe('2024-02-29'); // leap year
  });

  it('quarter is the calendar quarter', () => {
    expect(resolvePeriod('quarter', '2026-07-09')).toEqual({ period: 'quarter', from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod('quarter', '2026-01-01')).toEqual({ period: 'quarter', from: '2026-01-01', to: '2026-03-31' });
    expect(resolvePeriod('quarter', '2026-12-31')).toEqual({ period: 'quarter', from: '2026-10-01', to: '2026-12-31' });
  });

  it('custom passes the given range through', () => {
    expect(resolvePeriod('custom', '2026-07-09', '2026-06-22', '2026-07-10')).toEqual({
      period: 'custom', from: '2026-06-22', to: '2026-07-10',
    });
  });

  it('custom without both ends is refused rather than guessed', () => {
    expect(() => resolvePeriod('custom', '2026-07-09')).toThrow();
    expect(() => resolvePeriod('custom', '2026-07-09', '2026-06-22')).toThrow();
  });
});

describe('daysInRange', () => {
  it('counts both ends', () => {
    expect(daysInRange('2026-07-09', '2026-07-09')).toBe(1);
    expect(daysInRange('2026-07-06', '2026-07-12')).toBe(7);
    expect(daysInRange('2026-07-01', '2026-07-31')).toBe(31);
    expect(daysInRange('2026-07-01', '2026-09-30')).toBe(92);
  });

  it('the supplied copy is 19 days of a 92-day quarter', () => {
    // The exact case the coverage line exists to state out loud.
    expect(daysInRange('2026-06-22', '2026-07-10')).toBe(19);
  });
});

describe('toReportLine', () => {
  it('rejects are a share of everything weighed, good and rejected', () => {
    const l = toReportLine({ group: 'total', cones: 990, rejectedCones: 10, sacks: 40, sackWeightKg: 1880, conesInRangePct: 99.8 });
    expect(l.rejectRatePct).toBe(1); // 10 of 1000 weighed, not 10 of 990 good
    expect(l.avgSackKg).toBe(47);
    expect(l.conesPerSack).toBe(24.8);
  });

  it('a period with no production yields nulls, never a divide by zero', () => {
    const l = toReportLine({ group: 'total', cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null });
    expect(l.rejectRatePct).toBeNull();
    expect(l.avgSackKg).toBeNull();
    expect(l.conesPerSack).toBeNull();
    expect(l.cones).toBe(0);
  });

  it('null sack figures from a station-grouped row count as zero', () => {
    const l = toReportLine({ group: '5', cones: 100, rejectedCones: 0, sacks: null, sackWeightKg: null, conesInRangePct: 100 });
    expect(l.sacks).toBe(0);
    expect(l.sackWeightKg).toBe(0);
    expect(l.avgSackKg).toBeNull();
  });
});
