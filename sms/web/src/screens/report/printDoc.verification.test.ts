/**
 * Printed-report wording, verification 25 Sep 2026: the sentence must match
 * the count behind it.
 */
import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import { describeMismatchHours } from '../../lib/fmt';
import type { ReportResponse } from '../../api';

const wrap = (report: unknown) => ({ report } as unknown as ReportResponse<never>);

describe('R4 — reject days outside the limits count both sides and say which', () => {
  it('4 above and 6 below of 14 days reads as 10 of 14, split', () => {
    const trend = Array.from({ length: 14 }, (_, i) => ({
      day: `2026-08-${String(24 + i).padStart(2, '0')}`, produced: 3000, inspected: 3000, rejects: 100,
      ratePct: 3, uclPct: 8, lclPct: 5, outOfControl: i < 4, belowLower: i >= 4 && i < 10,
    }));
    const s = summarise('reject', wrap({ total: 3009, pBarPct: 6.71, reasons: [], trend }));
    expect(s.tiles.find((t) => t.label === 'Days outside control limits')).toMatchObject({ value: '10', unit: 'of 14', note: '4 above · 6 below' });
    expect(s.sentences.join(' ')).toMatch(/10 of 14 days fell outside the control limits: 4 above the upper limit .* and 6 below the lower limit/);
  });
});

describe('C8 — a period shorter than the drift rule cannot be read as "no action indicated"', () => {
  const base = { stations: [], lineMeanG: 1951.8, targetG: 1960, productLabel: 'x', flaggedStationCount: 0, adjustments: [], minDaysHeld: 3 };
  it('one day: says the period is too short', () => {
    const s = summarise('calibration', wrap({ ...base, periodDays: 1, driftRuleCanFire: false }));
    const text = s.sentences.join(' ');
    expect(text).toMatch(/covers 1 day; the drift rule needs a run of at least 3 days/);
    expect(text).not.toMatch(/no calibration action is indicated/);
  });
  it('long enough: the old sentence stands', () => {
    const s = summarise('calibration', wrap({ ...base, periodDays: 14, driftRuleCanFire: true }));
    expect(s.sentences.join(' ')).toMatch(/no calibration action is indicated/);
  });
});

describe('X1 — machine-product counts machines that weighed cones, not roster rows', () => {
  it('14 roster rows, 13 weighing', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ station: i + 1, cones: i === 2 ? 0 : 100 }));
    const s = summarise('machine-product', wrap({ rows, products: [1, 2, 3, 4, 5], columns: new Array(18).fill(0), changes: [], conesWithoutStation: 0, machinesWeighing: 13 }));
    expect(s.tiles[0]).toMatchObject({ value: '13' });
    expect(s.sentences[0]).toMatch(/^13 machines ran 5 products across 18 shifts; 1 machine on the roster weighed no cones\./);
  });
});

describe('D11/S7 — "mostly around" only for a majority', () => {
  it('39 of 99 spread before each shift change is listed, not "mostly"', () => {
    const t = describeMismatchHours([{ hour: 21, mismatched: 39 }, { hour: 5, mismatched: 34 }, { hour: 13, mismatched: 26 }], 99, 21)!;
    expect(t).not.toMatch(/mostly/);
    expect(t).toBe('spread across the hours 05:00 (34), 13:00 (26) and 21:00 (39), each the hour before a shift change');
  });
  it('a real majority still says mostly', () => {
    expect(describeMismatchHours([{ hour: 21, mismatched: 60 }, { hour: 5, mismatched: 10 }], 99)).toBe('mostly around 21:00 (60)');
  });
  it('hours outside the top list are acknowledged', () => {
    expect(describeMismatchHours([{ hour: 7, mismatched: 10 }], 30)).toMatch(/the other 20 fall in other hours/);
  });
});
