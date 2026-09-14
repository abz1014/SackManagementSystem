import { describe, expect, it } from 'vitest';
import { parseShiftTime, shiftOrderProblem } from './shiftTimes';

describe('parseShiftTime', () => {
  it('reads HH:MM as minutes from midnight', () => {
    expect(parseShiftTime('06:00')).toBe(360);
    expect(parseShiftTime('14:00')).toBe(840);
    expect(parseShiftTime('22:30')).toBe(1350);
    expect(parseShiftTime('00:00')).toBe(0);
    expect(parseShiftTime('23:59')).toBe(1439);
  });

  it('tolerates surrounding whitespace, nothing else', () => {
    expect(parseShiftTime(' 06:00 ')).toBe(360);
    expect(parseShiftTime('')).toBeNull();
    expect(parseShiftTime('6:00')).toBeNull();
    expect(parseShiftTime('24:00')).toBeNull();
    expect(parseShiftTime('06:60')).toBeNull();
    // A browser time input can hand back seconds when its step allows them;
    // the rule stores HH:MM and the server parses exactly that.
    expect(parseShiftTime('06:00:00')).toBeNull();
  });
});

describe('shiftOrderProblem', () => {
  it("accepts the plant's 06 / 14 / 22", () => {
    expect(shiftOrderProblem('06:00', '14:00', '22:00')).toBeNull();
  });

  it('refuses starts out of order, including equal ones', () => {
    expect(shiftOrderProblem('14:00', '06:00', '22:00')).toBe('out_of_order');
    expect(shiftOrderProblem('06:00', '22:00', '14:00')).toBe('out_of_order');
    expect(shiftOrderProblem('06:00', '06:00', '22:00')).toBe('out_of_order');
    expect(shiftOrderProblem('06:00', '14:00', '14:00')).toBe('out_of_order');
  });

  it('names a missing or malformed start before judging the order', () => {
    expect(shiftOrderProblem('', '14:00', '22:00')).toBe('malformed');
    expect(shiftOrderProblem('06:00', 'noon', '22:00')).toBe('malformed');
    expect(shiftOrderProblem('06:00', '14:00', '')).toBe('malformed');
  });
});
