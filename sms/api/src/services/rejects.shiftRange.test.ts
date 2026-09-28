/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): `bindRejectFilters` ANDs
 * `shiftRangeClause` in when `f.shiftRange` is given, and every existing
 * caller (getRejectPareto, getRejectsByDayCode, getUnmatchedRejects,
 * bindConeFilters — all of which spread `{ ...f }`) inherits it for free.
 * Direct, pool-free test against the exported binder, the way this file's
 * own header documents `bindRejectFilters` as the one place every reject
 * query binds its filters.
 */
import { describe, expect, it } from 'vitest';
import { bindRejectFilters, type RejectFilters } from './rejects.js';
import type { ShiftRange } from '../shiftRange.js';

function fakeReq() {
  const inputs = new Map<string, unknown>();
  const req = {
    input: (name: string, _t: unknown, v: unknown) => {
      inputs.set(name, v);
      return req;
    },
  };
  return { req: req as unknown as import('mssql').Request, inputs };
}

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' };

describe('bindRejectFilters — shiftRange wiring', () => {
  it('with shiftRange: the WHERE carries the shift-range clause and its four params', () => {
    const { req, inputs } = fakeReq();
    const f: RejectFilters = { from: '2026-09-01', to: '2026-09-05', shiftRange: RANGE };
    const where = bindRejectFilters(req, 1, f, 're.');
    expect(where).toContain('@srFrom');
    expect(where).toContain('@srFromOrd');
    expect(where).toContain('@srTo');
    expect(where).toContain('@srToOrd');
    expect(inputs.get('srFrom')).toBe('2026-09-02');
    expect(inputs.get('srFromOrd')).toBe(2); // evening
    expect(inputs.get('srTo')).toBe('2026-09-02');
    expect(inputs.get('srToOrd')).toBe(2);
  });

  it('without shiftRange: no shift-range clause or params — unchanged behaviour', () => {
    const { req, inputs } = fakeReq();
    const f: RejectFilters = { from: '2026-09-01', to: '2026-09-05' };
    const where = bindRejectFilters(req, 1, f, 're.');
    expect(where).not.toContain('@srFrom');
    expect(inputs.has('srFrom')).toBe(false);
  });
});
