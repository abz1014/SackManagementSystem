import { describe, it, expect } from 'vitest';
import { previousPeriod } from './comparePeriod.js';

describe('previousPeriod', () => {
  it('single day prev', () => {
    expect(previousPeriod({ from: '2026-09-05', to: '2026-09-05' }, 'prev')).toEqual({ from: '2026-09-04', to: '2026-09-04' });
  });
  it('multi-day prev, equal length, across a month boundary', () => {
    expect(previousPeriod({ from: '2026-09-02', to: '2026-09-04' }, 'prev')).toEqual({ from: '2026-08-30', to: '2026-09-01' });
  });
  it('shift range across midnight', () => {
    // 3 shifts (evening, night of the 10th, morning of the 11th) -> the 3 ending just before evening of the 10th.
    const r = previousPeriod({ from: '2026-09-10', to: '2026-09-11', fromShift: 'evening', toShift: 'morning' }, 'prev');
    expect(r).toEqual({ from: '2026-09-09', fromShift: 'evening', to: '2026-09-10', toShift: 'morning' });
  });
  it('shift range across a month boundary', () => {
    const r = previousPeriod({ from: '2026-09-01', to: '2026-09-01', fromShift: 'morning', toShift: 'evening' }, 'prev');
    expect(r).toEqual({ from: '2026-08-31', fromShift: 'evening', to: '2026-08-31', toShift: 'night' });
  });
  it('single shift keeps the shift on the previous day block', () => {
    expect(previousPeriod({ from: '2026-09-05', to: '2026-09-06', shift: 'night' }, 'prev')).toEqual({
      from: '2026-09-03', to: '2026-09-04', shift: 'night',
    });
  });
  it('week subtracts 7 days from every bound', () => {
    expect(previousPeriod({ from: '2026-09-03', to: '2026-09-05', fromShift: 'evening', toShift: 'night' }, 'week')).toEqual({
      from: '2026-08-27', fromShift: 'evening', to: '2026-08-29', toShift: 'night',
    });
    expect(previousPeriod({ from: '2026-03-02', to: '2026-03-02' }, 'week')).toEqual({ from: '2026-02-23', to: '2026-02-23' });
  });
});
