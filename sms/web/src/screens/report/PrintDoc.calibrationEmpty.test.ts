/**
 * C-056 (D-90): a calibration report for a period with no station-days must
 * not conclude "no calibration action is indicated" — the data cannot support
 * a conclusion either way.
 */
import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import type { ReportResponse } from '../../api';

const wrap = (report: unknown) => ({ report } as unknown as ReportResponse<never>);
const base = { lineMeanG: null, targetG: null, productLabel: null, flaggedStationCount: 0, adjustments: [], minDaysHeld: 3, periodDays: 6, driftRuleCanFire: true };

describe('calibration print — empty period', () => {
  it('zero station rows: says no readings, no assessment possible, never "no action indicated"', () => {
    const text = summarise('calibration', wrap({ ...base, stations: [] })).sentences.join(' ');
    expect(text).not.toMatch(/no calibration action is indicated/);
    expect(text).toMatch(/no readings were recorded in this period, so no assessment is possible/i);
  });
  it('zero station rows and a too-short period: still the no-readings sentence', () => {
    const text = summarise('calibration', wrap({ ...base, stations: [], periodDays: 1, driftRuleCanFire: false })).sentences.join(' ');
    expect(text).toMatch(/no assessment is possible/i);
  });
});
