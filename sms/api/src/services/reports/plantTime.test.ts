/**
 * IFL reports, task W0 (1 Oct 2026), D4: a production timestamp leaves the
 * building as the plant's wall clock, not as an ISO instant with a Z.
 */
import { describe, it, expect } from 'vitest';
import { plantWallClock, parsePlantWallClock } from './plantTime.js';

describe('plantWallClock', () => {
  it('renders the UTC fields of a production-time instant as YYYY-MM-DD HH:mm:ss, no zone marker', () => {
    // 2026-07-03 21:32:41 is the July cone IFL's weight-reject report is acceptance-tested against.
    expect(plantWallClock(Date.UTC(2026, 6, 3, 21, 32, 41))).toBe('2026-07-03 21:32:41');
    expect(plantWallClock(new Date('2026-08-15T18:04:09.000Z'))).toBe('2026-08-15 18:04:09');
    expect(plantWallClock('2026-09-01T07:00:00.000Z')).toBe('2026-09-01 07:00:00');
    expect(plantWallClock('2026-09-01T07:00:00.000Z')).not.toMatch(/[TZ]/);
  });

  it('pads every field and keeps midnight as 00:00:00', () => {
    expect(plantWallClock(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
    expect(plantWallClock(Date.UTC(2026, 8, 7, 0, 0, 0))).toBe('2026-09-07 00:00:00');
  });

  it('never reads the host\'s own zone: the result is the same under any TZ', () => {
    const before = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Asia/Karachi', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        expect(plantWallClock(Date.UTC(2026, 6, 3, 21, 32, 41)), tz).toBe('2026-07-03 21:32:41');
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('renders the zeroed-clock sentinel as the epoch, so the fault is visible rather than hidden', () => {
    expect(plantWallClock(0)).toBe('1970-01-01 00:00:00');
  });

  it('returns an empty string for nothing or an unparseable value, never "Invalid Date" or a throw', () => {
    expect(plantWallClock(null)).toBe('');
    expect(plantWallClock(undefined)).toBe('');
    expect(plantWallClock('not a time')).toBe('');
    expect(plantWallClock(Number.NaN)).toBe('');
  });
});

describe('parsePlantWallClock', () => {
  it('is the inverse of plantWallClock, in UTC, whatever the host zone', () => {
    const ms = Date.UTC(2026, 6, 3, 21, 32, 41);
    expect(parsePlantWallClock('2026-07-03 21:32:41')).toBe(ms);
    expect(parsePlantWallClock(plantWallClock(ms))).toBe(ms);
  });

  it('accepts the T separator, a fraction and a Z, and a missing seconds field', () => {
    expect(parsePlantWallClock('2026-07-03T21:32:41.000Z')).toBe(Date.UTC(2026, 6, 3, 21, 32, 41));
    expect(parsePlantWallClock('2026-07-03 21:32')).toBe(Date.UTC(2026, 6, 3, 21, 32, 0));
  });

  it('is null for anything that is not that shape', () => {
    expect(parsePlantWallClock('')).toBeNull();
    expect(parsePlantWallClock('03-07-2026 21:32')).toBeNull();
    expect(parsePlantWallClock('2026-07-03')).toBeNull();
    expect(parsePlantWallClock('garbage')).toBeNull();
  });
});
