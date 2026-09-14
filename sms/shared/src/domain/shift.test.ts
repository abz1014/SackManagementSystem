/**
 * Shift boundaries as data (roadmap Phase 1, 14 Sep 2026). Until now the
 * boundaries were one constant read by the worker and the API; they are now
 * a value the newest sms.shift_rule row carries, parsed from 'HH:MM' and
 * validated once here, and every consumer takes them as an argument. These
 * pin the parse, the validator's ordering rule, and that bucketing follows
 * whatever boundaries it is handed rather than the seed.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIFT_BOUNDARIES,
  SHIFT_BOUNDARIES,
  formatShiftTime,
  parseShiftTime,
  shiftBoundariesFrom,
  shiftCodeFromMinutes,
} from './shift.js';

describe('parseShiftTime / formatShiftTime', () => {
  it('parses HH:MM to minutes from midnight and back', () => {
    expect(parseShiftTime('06:00')).toBe(360);
    expect(parseShiftTime('23:59')).toBe(1439);
    expect(parseShiftTime('00:00')).toBe(0);
    expect(parseShiftTime(' 14:00 ')).toBe(840);
    expect(formatShiftTime(450)).toBe('07:30');
    expect(formatShiftTime(0)).toBe('00:00');
  });

  it('returns null, never a number, for anything that is not HH:MM', () => {
    for (const bad of ['24:00', '6:00', '06:60', '0600', '06:00:00', '', 'morning']) {
      expect(parseShiftTime(bad)).toBeNull();
    }
  });
});

describe('shiftBoundariesFrom', () => {
  it('accepts three times in increasing order', () => {
    expect(shiftBoundariesFrom('06:00', '14:00', '22:00')).toEqual(DEFAULT_SHIFT_BOUNDARIES);
    expect(shiftBoundariesFrom('08:00', '16:00', '23:30')).toEqual({ morningStart: 480, eveningStart: 960, nightStart: 1410 });
  });

  it('returns null unless morning < evening < night — a rule with no night is not a rule', () => {
    expect(shiftBoundariesFrom('14:00', '06:00', '22:00')).toBeNull();
    expect(shiftBoundariesFrom('06:00', '06:00', '22:00')).toBeNull();
    expect(shiftBoundariesFrom('06:00', '22:00', '14:00')).toBeNull();
    expect(shiftBoundariesFrom('06:00', 'x', '22:00')).toBeNull();
  });
});

describe('shiftCodeFromMinutes', () => {
  it('buckets on the seed boundaries by default (IFL Q8: 06/14/22)', () => {
    expect(shiftCodeFromMinutes(6 * 60)).toBe('morning');
    expect(shiftCodeFromMinutes(14 * 60 - 1)).toBe('morning');
    expect(shiftCodeFromMinutes(14 * 60)).toBe('evening');
    expect(shiftCodeFromMinutes(22 * 60)).toBe('night');
    expect(shiftCodeFromMinutes(2 * 60)).toBe('night');
  });

  it('follows the boundaries it is handed: 07:30 is morning under 06/14/22 and night under 08/16/23', () => {
    const late = shiftBoundariesFrom('08:00', '16:00', '23:00')!;
    expect(shiftCodeFromMinutes(450, DEFAULT_SHIFT_BOUNDARIES)).toBe('morning');
    expect(shiftCodeFromMinutes(450, late)).toBe('night');
    expect(shiftCodeFromMinutes(16 * 60, late)).toBe('evening');
    expect(shiftCodeFromMinutes(23 * 60, late)).toBe('night');
  });

  it('the deprecated SHIFT_BOUNDARIES alias is the default, so an unconverted reader still gets the seed', () => {
    expect(SHIFT_BOUNDARIES).toBe(DEFAULT_SHIFT_BOUNDARIES);
  });
});
