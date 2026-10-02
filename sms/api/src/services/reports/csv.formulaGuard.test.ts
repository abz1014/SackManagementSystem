import { describe, expect, it } from 'vitest';
import { escapeCell } from './csv.js';

describe('escapeCell — the formula guard applies to text, never to numbers (D-72)', () => {
  it('a negative number stays a number', () => {
    expect(escapeCell(-7.51)).toBe('-7.51');
  });
  it('booleans and dates are never prefixed', () => {
    expect(escapeCell(false)).toBe('false');
    expect(escapeCell(new Date('2026-09-03T11:56:07.000Z'))).toBe('2026-09-03T11:56:07.000Z');
  });
  it('free text starting with a formula character is still guarded', () => {
    expect(escapeCell('-cmd')).toBe("'-cmd");
    expect(escapeCell('=1+1')).toBe("'=1+1");
    expect(escapeCell('+1')).toBe("'+1");
    expect(escapeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCell('\tx')).toBe("'\tx");
  });
});
