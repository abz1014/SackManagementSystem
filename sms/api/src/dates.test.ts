/**
 * Unit tests for `isoDate` (dates.ts) — the shared calendar-date schema.
 * A plain regex matches `2026-02-30` (right shape, impossible date); these
 * tests pin that isoDate refuses it while accepting every real date,
 * including the one genuine edge case (a leap day).
 */
import { describe, it, expect } from 'vitest';
import { isoDate, isoTimestamp } from './dates.js';

describe('isoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isoDate.safeParse('2026-09-24').success).toBe(true);
  });

  it('accepts a leap-year 29 Feb', () => {
    expect(isoDate.safeParse('2024-02-29').success).toBe(true);
  });

  it('rejects a non-leap-year 29 Feb', () => {
    const r = isoDate.safeParse('2025-02-29');
    expect(r.success).toBe(false);
  });

  it('rejects 30 Feb outright', () => {
    const r = isoDate.safeParse('2026-02-30');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe('not a real calendar date');
  });

  it('rejects month 13', () => {
    expect(isoDate.safeParse('2026-13-01').success).toBe(false);
  });

  it('rejects day 00 and month 00', () => {
    expect(isoDate.safeParse('2026-00-10').success).toBe(false);
    expect(isoDate.safeParse('2026-05-00').success).toBe(false);
  });

  it('rejects day 32', () => {
    expect(isoDate.safeParse('2026-01-32').success).toBe(false);
  });

  it('rejects the wrong shape before ever reaching the calendar check', () => {
    expect(isoDate.safeParse('2026-9-24').success).toBe(false);
    expect(isoDate.safeParse('09/24/2026').success).toBe(false);
    expect(isoDate.safeParse('not-a-date').success).toBe(false);
    expect(isoDate.safeParse('').success).toBe(false);
  });

  it('accepts every day of a full ordinary year and a full leap year', () => {
    for (const year of [2025, 2024]) {
      for (let m = 1; m <= 12; m++) {
        const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const s = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          expect(isoDate.safeParse(s).success, s).toBe(true);
        }
      }
    }
  });
});

describe('isoTimestamp (RT-016)', () => {
  it('accepts a real timestamp without milliseconds', () => {
    expect(isoTimestamp.safeParse('2026-09-24T10:30:00Z').success).toBe(true);
  });

  it('accepts a real timestamp with milliseconds', () => {
    expect(isoTimestamp.safeParse('2026-09-24T10:30:00.123Z').success).toBe(true);
  });

  it('accepts 1- and 2-digit millisecond forms', () => {
    expect(isoTimestamp.safeParse('2026-09-24T10:30:00.1Z').success).toBe(true);
    expect(isoTimestamp.safeParse('2026-09-24T10:30:00.12Z').success).toBe(true);
  });

  it('accepts a leap-year 29 Feb timestamp', () => {
    expect(isoTimestamp.safeParse('2024-02-29T00:00:00Z').success).toBe(true);
  });

  it('rejects month 13', () => {
    const r = isoTimestamp.safeParse('2026-13-01T10:00:00Z');
    expect(r.success).toBe(false);
  });

  it('rejects day 31 in a 30-day month', () => {
    const r = isoTimestamp.safeParse('2026-04-31T10:00:00Z');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe('That date or time does not exist.');
  });

  it('rejects 30 Feb outright', () => {
    expect(isoTimestamp.safeParse('2026-02-30T10:00:00Z').success).toBe(false);
  });

  it('rejects a non-leap-year 29 Feb', () => {
    expect(isoTimestamp.safeParse('2025-02-29T10:00:00Z').success).toBe(false);
  });

  it('rejects hour 24', () => {
    expect(isoTimestamp.safeParse('2026-09-24T24:00:00Z').success).toBe(false);
  });

  it('rejects minute 60', () => {
    expect(isoTimestamp.safeParse('2026-09-24T10:60:00Z').success).toBe(false);
  });

  it('rejects second 60', () => {
    expect(isoTimestamp.safeParse('2026-09-24T10:30:60Z').success).toBe(false);
  });

  it('rejects the wrong shape before ever reaching the calendar check', () => {
    expect(isoTimestamp.safeParse('2026-09-24').success).toBe(false);
    expect(isoTimestamp.safeParse('2026-09-24 10:30:00').success).toBe(false);
    expect(isoTimestamp.safeParse('not-a-timestamp').success).toBe(false);
    expect(isoTimestamp.safeParse('').success).toBe(false);
  });

  it('accepts every hour boundary of a full day', () => {
    for (let h = 0; h < 24; h++) {
      const s = `2026-09-24T${String(h).padStart(2, '0')}:00:00Z`;
      expect(isoTimestamp.safeParse(s).success, s).toBe(true);
    }
  });
});
