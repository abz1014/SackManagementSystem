import { describe, expect, it } from 'vitest';
import { R } from './strings';
import { addDays, lastMonthOf, paramsForQuick, quickOf, withShifts } from './periods';

describe('quick periods', () => {
  it('last month is the whole previous calendar month, across a year end and a leap year', () => {
    expect(lastMonthOf('2026-10-13')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(lastMonthOf('2026-01-02')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(lastMonthOf('2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('last 7 days ends on the production day in progress', () => {
    expect(paramsForQuick('week', '2026-09-07', null)).toEqual({ key: 'pick', picked: { from: '2026-09-01', to: '2026-09-07' } });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('whole range needs the record ends and is a plain pick of them', () => {
    expect(paramsForQuick('whole', '2026-09-07', null)).toBeNull();
    const range = { minDate: '2026-08-05', maxDate: '2026-09-07' };
    expect(paramsForQuick('whole', '2026-09-07', range)).toEqual({ key: 'pick', picked: { from: '2026-08-05', to: '2026-09-07' } });
    expect(paramsForQuick('today', '2026-09-07', range)).toEqual({ key: 'today' });
    expect(paramsForQuick('month', '2026-09-07', range)).toEqual({ key: 'month' });
  });

  it('shift choices narrow the ends, and a backwards range is refused', () => {
    expect(withShifts('2026-09-01', '2026-09-03', '', '')).toEqual({ key: 'pick', picked: { from: '2026-09-01', to: '2026-09-03' } });
    expect(withShifts('2026-09-01', '2026-09-03', 'evening', '')).toEqual({
      key: 'range',
      range: { from: { date: '2026-09-01', shift: 'evening' }, to: { date: '2026-09-03', shift: 'night' } },
    });
    expect(withShifts('2026-09-01', '2026-09-01', 'night', 'morning')).toBeNull();
  });

  it('quickOf recognises only what it can prove', () => {
    const range = { minDate: '2026-08-05', maxDate: '2026-09-07' };
    expect(quickOf(null, range)).toBeNull();
    expect(quickOf({ key: 'today' } as never, range)).toBe('today');
    expect(quickOf({ key: 'pick', from: '2026-08-05', to: '2026-09-07' } as never, range)).toBe('whole');
    expect(quickOf({ key: 'pick', from: '2026-08-06', to: '2026-09-07' } as never, range)).toBeNull();
  });
});

describe('Reports strings', () => {
  const collect = (node: unknown, out: string[] = []): string[] => {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'function') out.push((node as (...a: unknown[]) => string)(3, 'Aa').replace(/^the /, 'The '));
    else if (node && typeof node === 'object') Object.values(node).forEach((v) => collect(v, out));
    return out;
  };
  const ACRONYMS = new Set(['IFL', 'PDF', 'CSV', 'GM']);
  it('sentence case, no ellipsis, no all-caps words', () => {
    for (const s of collect(R)) {
      expect(s, s).toMatch(/^[A-Z]/);
      expect(s, s).not.toContain('...');
      expect(s, s).not.toContain('…');
      for (const w of s.match(/[A-Za-z]{2,}/g) ?? []) if (w === w.toUpperCase()) expect(ACRONYMS.has(w), `${w} in ${s}`).toBe(true);
    }
  });
});
