/**
 * C-036 (D-100, 2 Oct 2026): a rule changed inside the period must be disclosed
 * on every report that applies the rule, not only the sack reports and the
 * shift-production report. The five earlier types below carry the same two
 * sentences, from the same two flags, in their printable notes.
 */
import { describe, it, expect } from 'vitest';
import { reportNotesOf } from './notes.js';
import type { ReportType } from './common.js';

const TYPES: ReportType[] = ['daily', 'product', 'station', 'cone-weight', 'management-summary'];
const WINDOW = /plausible-weight-window version/;
const BASIS = /weight-basis version/;

describe('rule-change disclosure on the earlier report types', () => {
  for (const type of TYPES) {
    it(`${type}: a plausibility change in the period is stated`, () => {
      const notes = reportNotesOf(type, { note: 'method', plausibilityRuleChangedInPeriod: true, weightRuleChangedInPeriod: false });
      expect(notes.filter((n) => WINDOW.test(n))).toHaveLength(1);
      expect(notes.some((n) => BASIS.test(n))).toBe(false);
    });

    it(`${type}: a weight-basis change in the period is stated`, () => {
      const notes = reportNotesOf(type, { note: 'method', plausibilityRuleChangedInPeriod: false, weightRuleChangedInPeriod: true });
      expect(notes.filter((n) => BASIS.test(n))).toHaveLength(1);
      expect(notes.some((n) => WINDOW.test(n))).toBe(false);
    });

    it(`${type}: no change, or a payload without the flags, states neither`, () => {
      for (const d of [{ note: 'method', plausibilityRuleChangedInPeriod: false, weightRuleChangedInPeriod: false }, { note: 'method' }]) {
        const notes = reportNotesOf(type, d);
        expect(notes.some((n) => WINDOW.test(n) || BASIS.test(n))).toBe(false);
      }
    });
  }
});
