/**
 * C-036 (D-100, 2 Oct 2026): `ruleChangesWithin` reported a change whenever a
 * VERSION row was dated inside the period, even when the row repeated the
 * previous version's values. A report then told the reader "more than one rule
 * applied" when only one did. A change now needs a different VALUE from the
 * version before it.
 */
import { describe, it, expect } from 'vitest';
import { ruleChangesWithin, type RuleVersion } from './ruleAsOf.js';

const T = (iso: string): number => new Date(iso).getTime();
const basis = (basisCode: string) => ({ basis: basisCode, coneTubeWeightG: null as number | null, sackTareKg: null as number | null });

describe('ruleChangesWithin compares values, not version rows', () => {
  it('a version inside the period that repeats the previous values is not a change', () => {
    const history: RuleVersion<ReturnType<typeof basis>>[] = [
      { effectiveFromMs: T('2026-08-19T10:00:00.000Z'), value: basis('as_recorded') },
      { effectiveFromMs: T('2026-08-01T00:00:00.000Z'), value: basis('as_recorded') },
    ];
    expect(ruleChangesWithin(history, T('2026-08-19T00:00:00.000Z'), T('2026-08-20T00:00:00.000Z'))).toBe(false);
  });

  it('a version inside the period with a different value is a change', () => {
    const history: RuleVersion<ReturnType<typeof basis>>[] = [
      { effectiveFromMs: T('2026-08-19T10:00:00.000Z'), value: basis('net') },
      { effectiveFromMs: T('2026-08-01T00:00:00.000Z'), value: basis('as_recorded') },
    ];
    expect(ruleChangesWithin(history, T('2026-08-19T00:00:00.000Z'), T('2026-08-20T00:00:00.000Z'))).toBe(true);
  });

  it('two identical versions then a different one: only the different one counts', () => {
    const history: RuleVersion<{ lo: number; hi: number }>[] = [
      { effectiveFromMs: T('2026-08-19T12:00:00.000Z'), value: { lo: 1500, hi: 2100 } },
      { effectiveFromMs: T('2026-08-19T11:00:00.000Z'), value: { lo: 1900, hi: 2100 } },
      { effectiveFromMs: T('2026-08-19T10:00:00.000Z'), value: { lo: 1900, hi: 2100 } },
      { effectiveFromMs: T('2026-08-01T00:00:00.000Z'), value: { lo: 1500, hi: 2100 } },
    ];
    // the window opens after the 10:00 repeat but 11:00 repeats it too; 12:00 is the real change back
    expect(ruleChangesWithin(history, T('2026-08-19T10:30:00.000Z'), T('2026-08-19T11:30:00.000Z'))).toBe(false);
    expect(ruleChangesWithin(history, T('2026-08-19T10:30:00.000Z'), T('2026-08-19T12:30:00.000Z'))).toBe(true);
  });
});
