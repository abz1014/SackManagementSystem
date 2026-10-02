/** C-138 (D-80): Readings headline names a shift range, never raw ISO dates. */
import { describe, expect, it } from 'vitest';
import { countLine, type CountState } from './Readings';
import { resolvePeriod, type PeriodAnchor } from '../lib/period';

const anchor: PeriodAnchor = {
  shiftDate: '2026-09-07', shiftCode: 'evening', shiftStartUtc: '2026-09-07T14:00:00.000Z',
  plantNowUtc: '2026-09-07T17:00:00.000Z', dataAsOfUtc: '2026-09-07T16:50:00.000Z', firstDay: '2026-06-22',
};
const ok = (n: number): CountState => ({ kind: 'ok', n });

describe('Readings countLine - shift-bounded periods', () => {
  it('a partial multi-shift range names both shifts, not "2026-09-01 to 2026-09-02"', () => {
    const p = resolvePeriod('range', anchor, undefined, {
      from: { date: '2026-09-01', shift: 'evening' }, to: { date: '2026-09-02', shift: 'morning' },
    });
    const s = countLine(p, 'cones', ok(3098), ok(100), false, []);
    expect(s).toContain('1 Sep evening shift – 2 Sep morning shift');
    expect(s).not.toContain('2026-09-01 to 2026-09-02');
  });

  it('a single-shift range names the shift', () => {
    const p = resolvePeriod('range', anchor, undefined, {
      from: { date: '2026-09-02', shift: 'evening' }, to: { date: '2026-09-02', shift: 'evening' },
    });
    const s = countLine(p, 'cones', ok(1080), ok(10), false, []);
    expect(s).toContain('2 Sep, evening shift');
    expect(s).not.toContain('Wednesday');
  });
});
