import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import type { ReportResponse } from '../../api';

const header = {} as ReportResponse<'calibration'>['header'];

describe('printed executive summary', () => {
  it('calibration: states differences, never a direction to adjust', () => {
    const data = {
      header,
      report: {
        period: { period: 'custom', from: '2026-09-05', to: '2026-09-05' },
        filters: {},
        lineMeanG: 1951.8, targetG: 1960, productLabel: 'P', thresholdG: 8, minDaysHeld: 3,
        stations: [
          { station: 1, n: 10, meanG: 1954, vsLineG: 2.2, vsTargetG: -6, daysHeld: 1, flagged: false, daysFlagged: 0, daysWithData: 1, lastAdjustedUtc: null, adjustmentsInPeriod: 0 },
          { station: 6, n: 10, meanG: 1947, vsLineG: -4.8, vsTargetG: -13, daysHeld: 1, flagged: false, daysFlagged: 0, daysWithData: 1, lastAdjustedUtc: null, adjustmentsInPeriod: 0 },
        ],
        flaggedStationCount: 0, adjustments: [], note: '',
      },
    } as unknown as ReportResponse<'calibration'>;
    const s = summarise('calibration', data);
    const text = s.sentences.join(' ');
    expect(text).toMatch(/4\.8\s*g\s\(station 6\)/);
    expect(text).not.toMatch(/\b(reduce|increase|lower|raise)\b/i);
    expect(s.tiles.find((t) => t.label === 'Flagged for drift')?.value).toBe('0');
    expect(s.weightCaveat).toBe(true);
  });

  it('management summary: withholds headline deltas when the prior period is thinly covered', () => {
    const kpi = (key: string, current: number) => ({
      key, label: key, unit: 'cones', betterWhen: 'higher', definition: '', current, prior: 1,
      delta: { abs: current - 1, pct: 50 }, comparable: true, incomparableReason: null, approval: 'awaiting',
    });
    const data = {
      header,
      report: {
        coverage: {
          current: { daysInPeriod: 34, daysWithData: 34, complete: true, firstDayWithData: null, lastDayWithData: null },
          prior: { daysInPeriod: 34, daysWithData: 1, complete: false, firstDayWithData: null, lastDayWithData: null },
        },
        kpis: [kpi('cones_weighed', 100)],
        verdict: { cones: 100, sacks: 4, sackWeightKg: 190 },
      },
    } as unknown as ReportResponse<'management-summary'>;
    const s = summarise('management-summary', data);
    expect(s.tiles[0]?.note).toContain('1 of 34 days');
    expect(s.sentences.join(' ')).toContain('no change against it is stated');
  });

  it('shift production: grand total pass, weight rejects, efficiency and the lowest shift', () => {
    const f = (pass: number, weightRejects: number, efficiencyPct: number) => ({ pass, weightRejects, total: pass + weightRejects, efficiencyPct });
    const data = {
      header,
      report: {
        summary: [{ shift: 'morning', ...f(900, 10, 98.9) }, { shift: 'evening', ...f(800, 40, 95.24) }, { shift: 'night', ...f(850, 5, 99.42) }],
        grandTotal: f(2550, 55, 97.89),
      },
    } as unknown as ReportResponse<'shift-production'>;
    const s = summarise('shift-production', data);
    const text = s.sentences.join(' ');
    expect(text).toContain('2,550 packages passed and 55 were rejected on weight, an efficiency of 97.89%.');
    expect(text).toMatch(/evening shift had the lowest efficiency, 95\.24%/);
    expect(s.tiles[0]?.value).toBe('2,550');
  });

  it('rejected cones: total rejected and the line weight range', () => {
    const data = {
      header,
      report: { total: 12, weightRange: { line: { minG: 1500.5, maxG: 2300, avgG: 1950, n: 900 }, byWinder: [], plausibility: { loG: 1, hiG: 2 }, excludedImplausible: 0 } },
    } as unknown as ReportResponse<'rejected-cones'>;
    const s = summarise('rejected-cones', data);
    const text = s.sentences.join(' ');
    expect(text).toContain('12 cones were rejected on weight.');
    expect(text).toContain('Line weights ranged from');
  });
});
