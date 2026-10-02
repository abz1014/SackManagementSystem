/**
 * C-134 (D-93): the hangers method note must not call a filtered population's
 * rate "the period's own line rate".
 */
import { describe, expect, it } from 'vitest';
import { reportNotesOf } from './notes.js';

const flagging = { canFlag: true, reason: null, lineRatePct: 11.69, hangersJudged: 20, hangersSeen: 20, minInspected: 100, alpha: 0.05 };
const flagOf = (d: unknown) => reportNotesOf('rejected-hangers', d).find((n) => n.startsWith('A hanger “stands out in this period”')) ?? '';

describe('hangers method note under a filter', () => {
  it('station filter: names the station population, not the period line rate', () => {
    const n = flagOf({ flagging, filters: { station: 14 }, total: { total: 899 } });
    expect(n).not.toContain('period’s own line rate');
    expect(n).toContain('station 14 only');
    expect(n).toContain('11.69%');
  });
  it('no filter: unchanged', () => {
    expect(flagOf({ flagging, filters: {}, total: { total: 899 } })).toContain('period’s own line rate of 11.69%');
  });
});
