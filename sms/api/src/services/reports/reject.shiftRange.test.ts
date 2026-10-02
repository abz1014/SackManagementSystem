/**
 * C-003 (D-57): under a shift-bounded range the reject report's trend, p-bar
 * and limits must be computed over the same shift range as the Pareto and the
 * per-day-code table, not over whole production days.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../rejectSpc.js', () => ({ getRejectSpc: vi.fn() }));
vi.mock('../rejects.js', () => ({ getRejectPareto: vi.fn(), getRejectsByDayCode: vi.fn() }));
vi.mock('../generation.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../generation.js')>();
  return { ...real, resolveGenerationScope: vi.fn(), noteOf: vi.fn(() => ({})) };
});

import { getRejectReport } from './reject.js';
import { getRejectSpc } from '../rejectSpc.js';
import { getRejectPareto, getRejectsByDayCode } from '../rejects.js';
import { resolveGenerationScope } from '../generation.js';
import type { ShiftRange } from '../../shiftRange.js';

const RANGE: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' };

beforeEach(() => {
  vi.mocked(resolveGenerationScope).mockResolvedValue({} as never);
  vi.mocked(getRejectPareto).mockResolvedValue({ total: 0, reasons: [], unattributed: null } as never);
  vi.mocked(getRejectsByDayCode).mockResolvedValue({ dayBasis: 'production_day', denominator: 'cones_plus_rejects', rows: [] } as never);
  vi.mocked(getRejectSpc).mockResolvedValue({ buckets: [], pBar: null, spansGenerations: false } as never);
});

describe('getRejectReport — shiftRange reaches the SPC trend', () => {
  it('passes shiftRange to getRejectSpc', async () => {
    const resolved = { from: '2026-09-01', to: '2026-09-02' } as never;
    await getRejectReport({} as ConnectionPool, 1, resolved, {}, RANGE);
    const filters = vi.mocked(getRejectSpc).mock.calls[0]![6] as { shiftRange?: ShiftRange };
    expect(filters.shiftRange).toEqual(RANGE);
  });
});
