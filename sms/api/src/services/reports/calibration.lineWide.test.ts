/**
 * C-136 part 1 (D-91): a line-wide adjustment (no station) must be listed AND
 * stated as line-wide in the report, not left to be inferred from a null.
 * The per-station count stays the station's own (reports.test.ts pins it);
 * the report note now says line-wide adjustments are outside every station's
 * count, and the line-wide ones stay in `adjustments` with stationId null.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../weightStations.js', () => ({ getWeightStations: vi.fn() }));
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn(async () => ({})) };
});

import { getWeightStations } from '../weightStations.js';
import { getCalibrationReport } from './calibration.js';

function pool(): ConnectionPool {
  return {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => ({
          recordset: sql.includes('FROM sms.calibration_adjustment')
            ? [{ adjustment_id: 10, station_id: null, adjusted_at_utc: new Date('2026-09-04T05:00:00Z'), recorded_at_utc: new Date('2026-09-04T05:01:00Z'), recorded_by: 'eng', reason: 'all', note: null, amount_g: null }]
            : [],
          rowsAffected: [0],
        }),
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('calibration report — line-wide adjustments', () => {
  it('lists the station-less adjustment and states that line-wide adjustments are outside every station count', async () => {
    vi.mocked(getWeightStations).mockResolvedValue({
      from: '2026-09-01', to: '2026-09-07', days: 7, lineMeanG: 1957, targetG: 1960, productId: 21, productLabel: 'x',
      targetEffectiveFromUtc: null, limitsChangedInWindow: 0, productChangesInWindow: 0, thresholdG: 3, minDaysHeld: 3, lineRejectRatePct: 2,
      stations: [{ station: 7, n: 500, meanG: 1958, vsLineG: 1, vsTargetG: -2, targetBasis: 'line_product', daysHeld: 3, flagged: false, rejectRatePct: 2, lastAdjustedUtc: null, days: [] }],
    } as never);
    const d = await getCalibrationReport(pool(), 1, { period: 'custom', from: '2026-09-01', to: '2026-09-07' }, {});
    expect(d.adjustments).toHaveLength(1);
    expect(d.adjustments[0]!.stationId).toBeNull();
    expect(d.stations[0]!.adjustmentsInPeriod).toBe(0);
    expect(d.note).toMatch(/whole line/i);
  });
});
