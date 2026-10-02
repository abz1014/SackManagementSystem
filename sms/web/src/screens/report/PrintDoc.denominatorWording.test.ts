/**
 * C-132 (D-92): the printed reject rate divides by cones plus only the rejects
 * with no cone record (getUnmatchedRejects), never "cones plus rejects".
 * One wording, reused everywhere.
 */
import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import { W } from '../../lib/words';
import type { ReportResponse } from '../../api';

const wrap = (report: unknown) => ({ report } as unknown as ReportResponse<never>);
const WORDING = 'cones plus rejects with no cone record';

describe('reject-rate denominator wording', () => {
  it('reject report tile note', () => {
    const s = summarise('reject', wrap({ total: 10, pBarPct: 4.59, reasons: [], trend: [] }));
    expect(s.tiles.find((t) => t.label === 'Average reject rate')?.note).toContain('with no cone record');
  });
  it('hangers report tile note', () => {
    const s = summarise('rejected-hangers', wrap({ total: { total: 5, ratePct: 4.59 }, flagging: { lineRatePct: 4.59, canFlag: true, hangersSeen: 3 }, hangers: [] }));
    const tile = s.tiles.find((t) => /reject rate/i.test(t.label));
    expect(tile?.note).toContain('with no cone record');
  });
  it('the on-screen "of ..." phrase', () => {
    expect(W.reports.ofInspected('4.6%')).toBe(`4.6% of ${WORDING}`);
  });
});
