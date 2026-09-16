import { describe, expect, it } from 'vitest';
import { vitalFew, type ParetoRow } from './pareto';

describe('vitalFew', () => {
  it('returns 1 for a single reason at 100%', () => {
    const rows: ParetoRow[] = [{ cumulativePct: 100 }];
    expect(vitalFew(rows)).toBe(1);
  });

  it('returns the smallest k whose cumulativePct reaches the default 80% threshold', () => {
    // 50, 80, 95, 100 — the second row is the first to clear 80.
    const rows: ParetoRow[] = [
      { cumulativePct: 50 },
      { cumulativePct: 80 },
      { cumulativePct: 95 },
      { cumulativePct: 100 },
    ];
    expect(vitalFew(rows)).toBe(2);
  });

  it('picks the first row that reaches the threshold, not the last below it', () => {
    // 40, 79.9, 80.1, 100 — 79.9 is still below 80, 80.1 clears it.
    const rows: ParetoRow[] = [
      { cumulativePct: 40 },
      { cumulativePct: 79.9 },
      { cumulativePct: 80.1 },
      { cumulativePct: 100 },
    ];
    expect(vitalFew(rows)).toBe(3);
  });

  it('respects a non-default threshold', () => {
    const rows: ParetoRow[] = [{ cumulativePct: 30 }, { cumulativePct: 60 }, { cumulativePct: 100 }];
    expect(vitalFew(rows, 60)).toBe(2);
    expect(vitalFew(rows, 95)).toBe(3);
  });

  it('returns 0 for an empty list — there is no vital few among no reasons', () => {
    expect(vitalFew([])).toBe(0);
  });

  it('returns the full length when the cumulative never reaches the threshold', () => {
    // Rounding artefact: the list tops out at 99.9, never actually hitting 100.
    const rows: ParetoRow[] = [{ cumulativePct: 40 }, { cumulativePct: 70 }, { cumulativePct: 99.9 }];
    expect(vitalFew(rows, 100)).toBe(3);
  });

  it('every row counts as vital when the whole list is one reason short of the threshold', () => {
    const rows: ParetoRow[] = [{ cumulativePct: 10 }, { cumulativePct: 20 }, { cumulativePct: 30 }];
    expect(vitalFew(rows, 80)).toBe(3);
  });
});
