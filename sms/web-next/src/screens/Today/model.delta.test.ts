import { describe, expect, it } from 'vitest';
import { changeTime, periodWords, rateDelta } from './model';

const rf = (pct: number | null) => ({ pct }) as unknown as Parameters<typeof rateDelta>[0];

describe('rateDelta wording', () => {
  it('says "points lower" and what it was when the current figure rounds to 0.0', () => {
    const d = rateDelta(rf(0.03), rf(0.14));
    expect(d?.text).toBe('0.1 points lower');
    expect(d?.vs).toBe('(was 0.1 %)');
    expect(d?.direction).toBe('down');
  });
  it('keeps the plain form otherwise', () => {
    const d = rateDelta(rf(14.6), rf(13.5));
    expect(d?.text).toBe('1.1 points');
    expect(d?.vs).toBe('vs 13.5 %');
  });
});

describe('changeTime in a multi-day period', () => {
  it('names the date when the period spans days', () => {
    expect(changeTime('2026-09-07T10:37:00Z', '2026-09-07', '2026-08-05')).toBe('10:37 on 7 Sep');
  });
  it('stays a clock for a single day', () => {
    expect(changeTime('2026-09-07T10:37:00Z', '2026-09-07')).toBe('10:37');
  });
});

describe('periodWords on a shift range', () => {
  it('puts the year after the whole range, not mid-way', () => {
    const p = { key: 'range', from: '2026-09-01', to: '2026-09-02', fromShift: { date: '2026-09-01', shift: 'evening' }, toShift: { date: '2026-09-02', shift: 'morning' } } as unknown as Parameters<typeof periodWords>[0];
    expect(periodWords(p)).toBe('1 Sep evening shift – 2 Sep morning shift, 2026');
  });
});
