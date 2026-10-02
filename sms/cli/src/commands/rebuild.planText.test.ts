/**
 * C-029 (D-66): the printed plan said a re-derived row is stamped under
 * TODAY's rules. Since RT24-04 the shift and plausibility rules are read as
 * of each reading's own production time (ruleHistory.ts), so that sentence is
 * false and could talk an operator out of a rebuild they need.
 */
import { describe, expect, it } from 'vitest';

const { planLines } = await import('./rebuild.js');

const text = planLines(
  'cone_event',
  'srv/sms',
  1,
  'sms_20260914_1530',
  2,
  [{ epochId: 9, sourceTable: 'pack1_TP1U2', sourceDb: 'D', provenance: 'ifl_copy', open: false, label: 'x', canonicalRows: 40, rawRows: 40 }],
  [9],
).join('\n');

describe('sms rebuild — printed plan wording (C-029)', () => {
  it('no longer claims rows are stamped under today\'s rules', () => {
    expect(text).not.toMatch(/TODAY/i);
    expect(text).not.toMatch(/ON FILE NOW/);
  });
  it('states that rules in force at each reading\'s own time are applied', () => {
    expect(text).toMatch(/in force at each reading's own time/);
  });
});
