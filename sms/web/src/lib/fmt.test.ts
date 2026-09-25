import { describe, expect, it } from 'vitest';
import { fmtClockOn } from './fmt';

describe('fmtClockOn — a reading from another plant day carries its date', () => {
  it('same plant day: time only', () => {
    expect(fmtClockOn('2026-09-25T12:00:00.000Z', '2026-09-25T17:13:00.000Z')).toBe('12:00 PM');
  });
  it('another day: time and date, so an 18-day-old reading never reads as today', () => {
    expect(fmtClockOn('2026-09-07T12:00:28.000Z', '2026-09-25T17:13:00.000Z')).toBe('12:00 PM, 7 Sep');
  });
});
