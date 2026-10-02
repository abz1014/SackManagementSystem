import { describe, expect, it } from 'vitest';
import { parsePeriodParams, resolvePeriod, type PeriodAnchor } from './period';

const anchor: PeriodAnchor = {
  shiftDate: '2026-09-01',
  shiftCode: 'evening',
  shiftStartUtc: '2026-09-01T14:00:00.000Z',
  plantNowUtc: '2026-09-01T16:39:00.000Z',
  dataAsOfUtc: '2026-09-01T16:23:00.000Z',
  firstDay: '2026-06-22',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('resolvePeriod pick with an invalid bound (C-016)', () => {
  it.each([
    ['empty from', { from: '', to: '2026-08-19' }],
    ['empty to', { from: '2026-08-18', to: '' }],
    ['impossible calendar date', { from: '2026-02-31', to: '2026-08-19' }],
  ])('%s never yields an open-ended or NaN window', (_n, picked) => {
    const p = resolvePeriod('pick', anchor, picked);
    expect(p.from).toMatch(DATE);
    expect(p.to).toMatch(DATE);
    expect(Number.isNaN(p.days)).toBe(false);
    expect(p.picked?.from).toMatch(DATE);
    expect(p.picked?.to).toMatch(DATE);
    for (const d of [p.from, p.to]) expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d);
    expect(p.from).not.toBe('2026-02-31');
  });

  it('a valid pick is untouched', () => {
    const p = resolvePeriod('pick', anchor, { from: '2026-08-18', to: '2026-08-19' });
    expect(p).toMatchObject({ from: '2026-08-18', to: '2026-08-19', days: 2 });
  });

  it('the URL form rejects an impossible date like any malformed pick', () => {
    expect(parsePeriodParams(new URLSearchParams('p=pick&from=2026-02-31&to=2026-08-19'))).toEqual({ key: 'shift' });
  });
});
