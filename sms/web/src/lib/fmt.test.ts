import { describe, expect, it } from 'vitest';
import { fmtClockOn, fmtSpan } from './fmt';

describe('fmtClockOn — a reading from another plant day carries its date', () => {
  it('same plant day: time only', () => {
    expect(fmtClockOn('2026-09-25T12:00:00.000Z', '2026-09-25T17:13:00.000Z')).toBe('12:00 PM');
  });
  it('another day: time and date, so an 18-day-old reading never reads as today', () => {
    expect(fmtClockOn('2026-09-07T12:00:28.000Z', '2026-09-25T17:13:00.000Z')).toBe('12:00 PM, 7 Sep');
  });
});

describe('fmtSpan above a day (verification 25 Sep 2026, M16)', () => {
  it('keeps the hours: 1,094,406 s is 12 d 16 h, not "12 days"', () => {
    expect(fmtSpan(1_094_406)).toBe('12 d 16 h');
  });
  it('whole days stay plain', () => {
    expect(fmtSpan(86_400)).toBe('1 day');
    expect(fmtSpan(2 * 86_400)).toBe('2 days');
  });
  it('under a day is unchanged', () => {
    expect(fmtSpan(40_079)).toBe('11 h 8 min');
  });
});
