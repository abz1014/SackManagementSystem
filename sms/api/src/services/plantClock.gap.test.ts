/**
 * The one primitive every "N days in a row" detector now relies on. If this is
 * wrong, weightStations, attention and the calibration Nelson runs are all
 * wrong the same way.
 */
import { describe, expect, it } from 'vitest';
import { consecutiveProductionDays } from './plantClock.js';

describe('consecutiveProductionDays', () => {
  it('is true for the next calendar day and for the same day', () => {
    expect(consecutiveProductionDays('2026-07-10', '2026-07-11')).toBe(true);
    expect(consecutiveProductionDays('2026-07-10', '2026-07-10')).toBe(true);
  });
  it('is false across the record’s hole, and for any gap wider than a day', () => {
    expect(consecutiveProductionDays('2026-07-10', '2026-08-05')).toBe(false);
    expect(consecutiveProductionDays('2026-07-10', '2026-07-12')).toBe(false);
  });
  it('is false when the days are out of order', () => {
    expect(consecutiveProductionDays('2026-07-11', '2026-07-10')).toBe(false);
  });
  it('handles a month boundary', () => {
    expect(consecutiveProductionDays('2026-07-31', '2026-08-01')).toBe(true);
  });
});
