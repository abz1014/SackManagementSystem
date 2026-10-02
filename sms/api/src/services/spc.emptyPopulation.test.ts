/**
 * C-049 / D-88 (2 Oct 2026): a period with no plausible readings came back
 * from `getWeightSpc` as "n 0, mean 0, sdO 0, sdW 0" — zeros standing in for
 * numbers that do not exist. The Weight screen's "Show the working" then
 * printed "Over this period: 0 cones, mean 0 g, standard deviation 0.00 g"
 * under a headline that correctly said nothing was recorded (P13,
 * 2026-07-20..25). At n = 0 there is no mean and no spread; they are null.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeightSpc, type SpecLimits } from './spc.js';

const SPEC: SpecLimits = { usl: null, lsl: null, nominal: null, source: 'none' };
const PLAUS = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

function fakePool(summary: Record<string, unknown>, subgroups: unknown[]): ConnectionPool {
  return {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          if (sql.includes('LEFT JOIN sms.source_epoch')) return { recordset: [] };
          if (sql.includes('STDEV(CAST(') && sql.includes(') excluded')) return { recordset: [summary] };
          if (sql.includes('PERCENTILE_CONT')) return { recordset: [] };
          if (sql.endsWith('ORDER BY b')) return { recordset: subgroups };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('getWeightSpc — an empty period has no mean and no spread', () => {
  it('n = 0: mean, grandMean, both sigmas and the S-chart centre are null, not 0', async () => {
    const data = await getWeightSpc(
      fakePool({ n: 0, mean: null, sd: null, excluded: 0, minTs: null, maxTs: null, occDays: 0 }, []),
      1, 'cone', '2026-07-20', '2026-07-25', SPEC, PLAUS,
    );
    expect(data.count).toBe(0);
    expect(data.mean).toBeNull();
    expect(data.grandMean).toBeNull();
    expect(data.stdevOverall).toBeNull();
    expect(data.stdevWithin).toBeNull();
    expect(data.sChartCenter).toBeNull();
  });

  it('a populated period still reports real numbers', async () => {
    const data = await getWeightSpc(
      fakePool(
        { n: 200, mean: 1975, sd: 8, excluded: 0, minTs: new Date('2026-08-01T00:00:00Z'), maxTs: new Date('2026-08-10T00:00:00Z'), occDays: 10 },
        [{ b: new Date('2026-08-01'), n: 200, mean: 1975, s: 8, minShiftKey: 1, maxShiftKey: 1 }],
      ),
      1, 'cone', '2026-08-01', '2026-08-10', SPEC, PLAUS,
    );
    expect(data.mean).toBe(1975);
    expect(data.stdevOverall).toBe(8);
    expect(data.stdevWithin).toBe(8);
  });
});
