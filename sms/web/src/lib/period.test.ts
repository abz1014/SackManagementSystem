import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  parsePeriodParams,
  resolvePeriod,
  tooShortFor,
  trailingWindow,
  writePeriodParams,
  TRAILING_DAYS,
  type PeriodAnchor,
} from './period';

/** Tue 1 Sep 2026, evening shift, 16:39 on the plant clock. */
const anchor: PeriodAnchor = {
  shiftDate: '2026-09-01',
  shiftCode: 'evening',
  shiftStartUtc: '2026-09-01T14:00:00.000Z',
  plantNowUtc: '2026-09-01T16:39:00.000Z',
  dataAsOfUtc: '2026-09-01T16:23:00.000Z',
  firstDay: '2026-06-22',
};

describe('resolvePeriod', () => {
  it('this shift carries the shift code as well as the day, because a night shift spans two dates', () => {
    const p = resolvePeriod('shift', anchor);
    expect(p).toMatchObject({ from: '2026-09-01', to: '2026-09-01', shift: 'evening', live: true, days: 1 });
    expect(p.tsFrom).toBe('2026-09-01T14:00:00.000Z');
  });

  it('today is the production day in progress and carries no shift filter', () => {
    const p = resolvePeriod('today', anchor);
    expect(p).toMatchObject({ from: '2026-09-01', to: '2026-09-01', live: true, days: 1 });
    expect(p.shift).toBeUndefined();
    expect(p.tsFrom).toBeUndefined();
  });

  it('yesterday is the previous production day and is closed', () => {
    expect(resolvePeriod('yesterday', anchor)).toMatchObject({
      from: '2026-08-31', to: '2026-08-31', live: false, days: 1,
    });
  });

  it('this week runs Monday to the day in progress, never past it', () => {
    // 1 Sep 2026 is a Tuesday, so the week began Monday 31 August.
    expect(resolvePeriod('week', anchor)).toMatchObject({
      from: '2026-08-31', to: '2026-09-01', live: true, days: 2,
    });
  });

  it('a week anchored on a Sunday still starts on the Monday before it', () => {
    const sunday = { ...anchor, shiftDate: '2026-09-06' };
    expect(resolvePeriod('week', sunday)).toMatchObject({ from: '2026-08-31', to: '2026-09-06', days: 7 });
  });

  it('a week anchored on a Monday is one day long, not eight', () => {
    const monday = { ...anchor, shiftDate: '2026-08-31' };
    expect(resolvePeriod('week', monday)).toMatchObject({ from: '2026-08-31', to: '2026-08-31', days: 1 });
  });

  it('this month starts on the first and stops at the day in progress', () => {
    expect(resolvePeriod('month', anchor)).toMatchObject({
      from: '2026-09-01', to: '2026-09-01', live: true, days: 1,
    });
    expect(resolvePeriod('month', { ...anchor, shiftDate: '2026-08-19' })).toMatchObject({
      from: '2026-08-01', to: '2026-08-19', days: 19,
    });
  });

  it('a picked range is returned as picked', () => {
    const p = resolvePeriod('pick', anchor, { from: '2026-08-26', to: '2026-08-31' });
    expect(p).toMatchObject({ from: '2026-08-26', to: '2026-08-31', live: false, days: 6 });
    expect(p.picked).toEqual({ from: '2026-08-26', to: '2026-08-31' });
  });

  it('a backwards pick is corrected rather than sent to the API', () => {
    expect(resolvePeriod('pick', anchor, { from: '2026-08-31', to: '2026-08-26' })).toMatchObject({
      from: '2026-08-26', to: '2026-08-31',
    });
  });

  it('a pick reaching into the future is clipped at the production day in progress', () => {
    // The plant cannot have made anything tomorrow, and an uncapped window
    // would report a period with days that can never hold data.
    expect(resolvePeriod('pick', anchor, { from: '2026-08-30', to: '2026-12-31' })).toMatchObject({
      from: '2026-08-30', to: '2026-09-01', live: true,
    });
  });

  it('every period caps its instant bound at the plant clock, so a replay shows only what existed then', () => {
    for (const key of ['shift', 'today', 'yesterday', 'week', 'month'] as const) {
      expect(resolvePeriod(key, anchor).tsTo).toBe('2026-09-01T16:39:00.000Z');
    }
  });
});

describe('trailingWindow — the detectors ignore the period', () => {
  it('reaches back fourteen days from the production day in progress', () => {
    expect(trailingWindow(anchor)).toEqual({ from: '2026-08-19', to: '2026-09-01', requestedDays: TRAILING_DAYS });
  });

  it('never claims a window older than the first day on record', () => {
    const young = { ...anchor, firstDay: '2026-08-28' };
    expect(trailingWindow(young)).toEqual({ from: '2026-08-28', to: '2026-09-01', requestedDays: 5 });
  });

  it('is unaffected by which period is selected — that is the whole point', () => {
    // Station drift on "This shift" must still be judged over fourteen days;
    // a shift is one daily mean and no pattern rule can fire on one point.
    const forShift = trailingWindow(anchor);
    const forMonth = trailingWindow(anchor);
    expect(forShift).toEqual(forMonth);
  });
});

describe('tooShortFor', () => {
  it('flags a one-shift period as too short to judge drift', () => {
    expect(tooShortFor(resolvePeriod('shift', anchor), 9)).toBe(true);
    expect(tooShortFor(resolvePeriod('today', anchor), 9)).toBe(true);
  });

  it('passes a period long enough to measure', () => {
    expect(tooShortFor(resolvePeriod('pick', anchor, { from: '2026-08-19', to: '2026-09-01' }), 9)).toBe(false);
  });
});

describe('daysBetween', () => {
  it('is inclusive of both ends', () => {
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-08-26', '2026-09-01')).toBe(7);
  });

  it('counts across a month boundary and a leap-free February', () => {
    expect(daysBetween('2026-02-25', '2026-03-02')).toBe(6);
  });
});

describe('the period travels in the URL', () => {
  it('round-trips a simple key', () => {
    const sp = new URLSearchParams();
    writePeriodParams(sp, { key: 'week' });
    expect(sp.toString()).toBe('p=week');
    expect(parsePeriodParams(sp)).toEqual({ key: 'week' });
  });

  it('round-trips a picked range', () => {
    const sp = new URLSearchParams();
    writePeriodParams(sp, { key: 'pick', picked: { from: '2026-08-26', to: '2026-09-01' } });
    expect(parsePeriodParams(sp)).toEqual({ key: 'pick', picked: { from: '2026-08-26', to: '2026-09-01' } });
  });

  it('clears a previous pick when the key changes, so stale dates cannot leak', () => {
    const sp = new URLSearchParams('p=pick&from=2026-08-26&to=2026-09-01');
    writePeriodParams(sp, { key: 'today' });
    expect(sp.toString()).toBe('p=today');
  });

  it('falls back to this shift on anything malformed', () => {
    expect(parsePeriodParams(new URLSearchParams(''))).toEqual({ key: 'shift' });
    expect(parsePeriodParams(new URLSearchParams('p=nonsense'))).toEqual({ key: 'shift' });
    expect(parsePeriodParams(new URLSearchParams('p=pick&from=yesterday&to=today'))).toEqual({ key: 'shift' });
    expect(parsePeriodParams(new URLSearchParams('p=pick&from=2026-08-26'))).toEqual({ key: 'shift' });
  });
});
