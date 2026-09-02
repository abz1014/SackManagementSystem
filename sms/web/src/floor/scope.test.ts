import { describe, it, expect } from 'vitest';
import { scopeWindow, parseScope } from './scope';

const anchor = {
  shiftStartUtc: '2026-07-09T22:00:00.000Z',
  shiftDate: '2026-07-09',
  plantNowUtc: '2026-07-10T02:15:00.000Z',
};

describe('scopeWindow', () => {
  it('this shift: from the shift start to the plant clock', () => {
    expect(scopeWindow('shift', anchor)).toEqual({
      tsFrom: '2026-07-09T22:00:00.000Z', tsTo: '2026-07-10T02:15:00.000Z', live: true,
    });
  });
  it('today: the production day in progress, even after midnight', () => {
    const w = scopeWindow('today', anchor);
    expect(w.from).toBe('2026-07-09');
    expect(w.to).toBe('2026-07-09');
    expect(w.live).toBe(true);
  });
  it('yesterday: the production day before, not live', () => {
    const w = scopeWindow('yesterday', anchor);
    expect(w.from).toBe('2026-07-08');
    expect(w.to).toBe('2026-07-08');
    expect(w.live).toBe(false);
  });
  it('a picked past day is closed; the current day is live', () => {
    expect(scopeWindow('day', anchor, '2026-07-01').live).toBe(false);
    expect(scopeWindow('day', anchor, '2026-07-09').live).toBe(true);
    expect(scopeWindow('day', anchor).from).toBe('2026-07-09');
  });
  it('every window is capped at the plant clock', () => {
    for (const k of ['shift', 'today', 'yesterday', 'day'] as const) {
      expect(scopeWindow(k, anchor).tsTo).toBe(anchor.plantNowUtc);
    }
  });
});

describe('parseScope', () => {
  it('unknown or missing falls back to this shift', () => {
    expect(parseScope(undefined)).toBe('shift');
    expect(parseScope('week')).toBe('shift');
    expect(parseScope('today')).toBe('today');
  });
});
