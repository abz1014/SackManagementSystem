import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import type { ReportResponse, ReportType } from '../../api';

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
    // D1: each cone is counted once, so the total is stated and is pass + rejected on weight.
    expect(text).toContain('2,550 passed and 55 were rejected on weight: 2,605 in total, each cone counted once, an efficiency of 97.89%.');
    expect(text).toMatch(/evening shift had the lowest efficiency, 95\.24%/);
    expect(s.tiles[0]).toMatchObject({ label: 'Pass (not weight-rejected)', value: '2,550' });
    expect(s.tiles[1]).toMatchObject({ label: 'Rejected on weight', value: '55', attn: true });
    expect(s.tiles[2]).toMatchObject({ label: 'Total', value: '2,605' });
  });

  it('shift production: one weight reject reads "1 was", the kg tile carries its basis, the scale bit is stated apart', () => {
    const f = (pass: number, weightRejects: number, efficiencyPct: number, weighedKg: number) => ({ weighed: pass, pass, weightRejects, total: pass + weightRejects, efficiencyPct, weighedKg });
    const data = {
      header,
      report: {
        summary: [{ shift: 'morning', ...f(7922, 1, 99.99, 15000) }],
        grandTotal: f(7922, 1, 99.99, 15000),
        scaleRejectedCones: 49,
        kgBasis: { basis: 'net', label: 'net of tare', implausible: 0 },
      },
    } as unknown as ReportResponse<'shift-production'>;
    const s = summarise('shift-production', data);
    const text = s.sentences.join(' ');
    expect(text).toContain('7,922 cones were weighed. 7,922 passed and 1 was rejected on weight: 7,923 in total, each cone counted once, an efficiency of 99.99%.');
    expect(text).not.toContain('1 were');
    expect(text).toContain('The scale’s own in-range bit marked 49 cones; the weight-reject records hold 1; they are separate records and are not merged.');
    expect(s.tiles.find((t) => t.label === 'Total weight')).toMatchObject({ value: '15,000', unit: 'kg', note: 'net of tare' });
  });

  it('shift production: the pre-D1 sentence (pass and rejects as two separate populations) is gone, and one cone reads singular', () => {
    const f = (pass: number, weightRejects: number, efficiencyPct: number) => ({ weighed: pass, pass, weightRejects, total: pass + weightRejects, efficiencyPct });
    const data = {
      header,
      report: { summary: [], grandTotal: { ...f(0, 1, 0), weighed: 1 } },
    } as unknown as ReportResponse<'shift-production'>;
    const text = summarise('shift-production', data).sentences.join(' ');
    expect(text).toContain('1 cone was weighed. 0 passed and 1 was rejected on weight: 1 in total, each cone counted once, an efficiency of 0.00%.');
    expect(text).not.toMatch(/packages passed and/);
    expect(text).not.toContain('1 were');
  });

  it('shift production: the plural follows the number ("2 were rejected", "1 cone was weighed")', () => {
    const f = (weighed: number, pass: number, weightRejects: number) => ({ weighed, pass, weightRejects, total: pass + weightRejects, efficiencyPct: 50 });
    const two = summarise('shift-production', { header, report: { summary: [], grandTotal: f(4, 2, 2) } } as unknown as ReportResponse<'shift-production'>).sentences.join(' ');
    expect(two).toContain('4 cones were weighed. 2 passed and 2 were rejected on weight: 4 in total');
    const none = summarise('shift-production', { header, report: { summary: [], grandTotal: f(1, 1, 0) } } as unknown as ReportResponse<'shift-production'>).sentences.join(' ');
    expect(none).toContain('1 cone was weighed. 1 passed and 0 were rejected on weight: 1 in total');
  });

  it('shift production: a period with nothing weighed says so instead of printing an empty assessment', () => {
    const f = { weighed: 0, pass: 0, weightRejects: 0, total: 0, efficiencyPct: null, weighedKg: null };
    const s = summarise('shift-production', { header, report: { summary: [], grandTotal: f } } as unknown as ReportResponse<'shift-production'>);
    expect(s.sentences).toEqual(['No cones were weighed in this period.']);
    expect(s.tiles[3]).toMatchObject({ label: 'Efficiency', value: '—' });
  });

  it('shift production: a server that predates the kg figure gets no kg tile and no scale sentence', () => {
    const data = {
      header,
      report: { summary: [], grandTotal: { pass: 10, weightRejects: 0, total: 10, efficiencyPct: 100 } },
    } as unknown as ReportResponse<'shift-production'>;
    const s = summarise('shift-production', data);
    expect(s.tiles.some((t) => t.label === 'Total weight')).toBe(false);
    expect(s.sentences.join(' ')).not.toContain('in-range bit');
  });

  it('rejected cones: total rejected and the line weight range', () => {
    const data = {
      header,
      report: { total: 12, weightRange: { line: { minG: 1500.5, maxG: 2300, avgG: 1950, n: 900 }, byWinder: [], plausibility: { loG: 1, hiG: 2 }, excludedImplausible: 0 } },
    } as unknown as ReportResponse<'rejected-cones'>;
    const s = summarise('rejected-cones', data);
    const text = s.sentences.join(' ');
    expect(text).toContain('12 cones were rejected on weight.');
    // the range is over every weighed cone on the line, and the tiles and the sentence say so
    expect(text).toMatch(/Across all 900 weighed cones on the line, weights ranged from 1500\.5.g to 2300\.0.g\./);
    expect(s.tiles.map((t) => t.label)).toEqual(['Rejected on weight', 'Lightest weighed cone', 'Heaviest weighed cone']);
    expect(s.tiles[1]?.note).toBe('all cones on the line');
    const one = summarise('rejected-cones', { header, report: { total: 1, weightRange: { line: { minG: null, maxG: null, avgG: null, n: 0 }, byWinder: [], plausibility: { loG: 1, hiG: 2 }, excludedImplausible: 0 } } } as unknown as ReportResponse<'rejected-cones'>);
    expect(one.sentences.join(' ')).toBe('1 cone was rejected on weight.');
  });
});
/* ---- IFL's six new reports (1 Oct 2026) ------------------------------- */

const zeroCounts = { sacks: 0, rejected: 0, rejectedPct: null };
const zeroBand = { passed: 0, rejected: 0, noFlag: 0, total: 0 };
const zeroSack = { sacks: 0, kg: 0, avgKg: null, minKg: null, maxKg: null, sdKg: null, rejectedByScale: 0, implausible: 0 };
const zeroHanger = { hanger: null, cones: 0, inspected: 0, qualityRejects: 0, weightRejects: 0, total: 0, ratePct: null, flag: null };
const base = { period: { period: 'custom', from: '2026-09-01', to: '2026-09-01' }, filters: {}, lineId: 1, note: '', pendingIfl: [], generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 } };
const lists = { listTotal: 0, listCap: 5000, excludedClockFault: 0 };

/** A well-formed payload with nothing in it — what a quiet period returns (the server's own scaffold shapes). */
const EMPTY: Record<string, object> = {
  'rejected-sacks': {
    ...base, ...lists, weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 }, byShift: [], byDay: [],
    total: { ...zeroCounts, noFlag: 0 }, rejectedSplit: { implausible: 0, plausible: 0 },
    passedRange: { byProduct: [], all: { sacks: 0, minKg: null, maxKg: null } }, list: [],
  },
  'sps-packing': {
    ...base, weightBasis: 'as_recorded', sps: { number: 1, label: 'SPS 1', confirmed: false }, columns: [], rows: [], totals: [],
    grandTotal: { sacks: 0, kg: 0, avgKg: null }, implausibleSacks: 0,
  },
  'sack-weight-range': {
    ...base, weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 }, bandKg: 0.1, passedRange: null, bands: [],
    spreadByDayShift: [], spreadByShift: [], spreadTotal: { date: null, shift: null, n: 0, minKg: null, maxKg: null, rangeKg: null, avgKg: null, sdKg: null },
    implausibleSacks: 0,
  },
  'sack-weight-summary': {
    ...base, weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 }, rows: [], dayTotals: [], shiftTotals: [], byYarnCount: [], total: zeroSack,
  },
  'rejected-hangers': {
    ...base, ...lists, hangers: [], total: zeroHanger,
    flagging: { canFlag: false, reason: 'too few cones per hanger in this period — choose a longer period', lineRatePct: null, hangersSeen: 0, hangersJudged: 0, minInspected: 100, alpha: 0.05 },
    list: [],
  },
  'rejected-unknown-lifter': {
    ...base, ...lists, lifters: [], total: { lifter: null, cones: 0, inspected: 0, qualityRejects: 0, zeroCodeRejects: 0, weightRejects: 0, total: 0, ratePct: null },
    unknownCount: 0, list: [], zeroedClock: { generation: null, rows: [] },
  },
};
const NEW_TYPES = Object.keys(EMPTY) as ReportType[];
const wrapReport = (report: unknown) => ({ header, report } as unknown as ReportResponse<ReportType>);

describe('IFL report summaries never throw on empty data', () => {
  it.each(NEW_TYPES)('%s: a well-formed empty payload yields tiles and a sentence', (type) => {
    const s = summarise(type, wrapReport(EMPTY[type]));
    expect(s.tiles.length).toBeGreaterThan(0);
    expect(s.sentences.length).toBeGreaterThan(0);
    for (const t of s.tiles) expect(t.value).not.toMatch(/NaN|undefined/);
    expect(s.sentences.join(' ')).not.toMatch(/NaN|undefined/);
  });
  it.each(NEW_TYPES)('%s: a payload with the fields stripped does not throw either', (type) => {
    expect(() => summarise(type, wrapReport({}))).not.toThrow();
  });
});

describe('IFL report summaries state facts, never a tolerance or a verdict', () => {
  it('rejected sacks: rejected share, the implausible split, no-verdict sacks and the pass range', () => {
    const d = {
      ...EMPTY['rejected-sacks'],
      total: { sacks: 5394, rejected: 594, rejectedPct: 11.0, noFlag: 2 },
      rejectedSplit: { implausible: 4, plausible: 590 },
      passedRange: { byProduct: [], all: { sacks: 4800, minKg: 46.98, maxKg: 47.6 } },
    };
    const s = summarise('rejected-sacks', wrapReport(d));
    const text = s.sentences.join(' ');
    expect(text).toContain('The scale rejected 594 of 5,394 sacks (11.00%).');
    expect(text).toContain('Of the 594 rejected, 4 had an implausible weight (0 kg or a fault reading) and 590 a plausible one.');
    expect(text).toContain('2 sacks carried no scale verdict and are not counted as passes.');
    expect(text).toMatch(/from 46\.98.kg to 47\.60.kg; that is the recorded pass range, not a tolerance\./);
    expect(text).not.toMatch(/within tolerance|underweight|overweight/i);
    expect(s.tiles[1]).toMatchObject({ label: 'Rejected by the scale', value: '594', attn: true, note: '11.00% of sacks' });
  });

  it('rejected sacks: the printed share keeps two decimals like the table and the CSV beside it (10.93 is not "10.9")', () => {
    const d = { ...EMPTY['rejected-sacks'], total: { sacks: 5435, rejected: 594, rejectedPct: 10.93, noFlag: 0 }, rejectedSplit: { implausible: 4, plausible: 590 } };
    const s = summarise('rejected-sacks', wrapReport(d));
    expect(s.sentences.join(' ')).toContain('594 of 5,435 sacks (10.93%)');
    expect(s.tiles[1]?.note).toBe('10.93% of sacks');
  });

  it('sps packing: the largest count, the no-product sacks and the unconfirmed SPS', () => {
    const count = (key: string, yarnCount: string | null, sacks: number, kgv: number, sharePct: number) => ({ key, yarnCount, label: yarnCount ?? 'No product on the reading', materialIds: [], sacks, kg: kgv, avgKg: 47, sharePct });
    const d = {
      ...EMPTY['sps-packing'],
      totals: [count('36', '36', 2197, 103000, 40.4), count('18', '18', 2013, 94000, 37), count('none', null, 1, 47, 0)],
      grandTotal: { sacks: 5435, kg: 255000, avgKg: 47 },
    };
    const s = summarise('sps-packing', wrapReport(d));
    const text = s.sentences.join(' ');
    expect(text).toContain('5,435 sacks were packed, 255,000 kg in all, across 2 yarn counts.');
    expect(text).toContain('36 was the largest count, with 2,197 sacks (40.4% of sacks).');
    expect(text).toContain('1 sack carries no product on the reading and so has no yarn count.');
    expect(text).toContain('Packing is stated for SPS 1.');
    expect(s.tiles.find((t) => t.label === 'Largest count')?.value).toBe('36');
  });

  it('sps packing: a count not on record is its own sentence, never described as "no product on the reading"', () => {
    const count = (key: string, yarnCount: string | null, label: string, sacks: number) => ({ key, yarnCount, label, materialIds: [], sacks, kg: sacks * 47, avgKg: 47, sharePct: 10 });
    const d = {
      ...EMPTY['sps-packing'],
      totals: [count('36', '36', '36', 100), count('unknown', null, 'Count not on record', 3), count('none', null, 'No product on the reading', 1)],
      grandTotal: { sacks: 104, kg: 4888, avgKg: 47 },
    };
    const text = summarise('sps-packing', wrapReport(d)).sentences.join(' ');
    expect(text).toContain('across 1 yarn count.');
    expect(text).toContain('1 sack carries no product on the reading and so has no yarn count.');
    expect(text).toContain('3 sacks have a product whose yarn count is not on record.');
    // the unknown column is not the no-product one: its 3 sacks are not described as carrying no product
    expect(text).not.toContain('3 sacks carry no product');
    // and a period with only a count-not-on-record column does not claim the sacks have no product
    const only = summarise('sps-packing', wrapReport({ ...d, totals: [count('unknown', null, 'Count not on record', 3)], grandTotal: { sacks: 3, kg: 141, avgKg: 47 } })).sentences.join(' ');
    expect(only).not.toContain('no product on the reading');
    expect(only).toContain('3 sacks have a product whose yarn count is not on record.');
  });

  it('sack weight range: counts, the recorded pass range and the spread', () => {
    const band = (passed: number, rejected: number) => ({ kind: 'band', label: 'x', fromKg: 47, toKg: 47.1, byShift: { morning: zeroBand, evening: zeroBand, night: zeroBand }, total: { passed, rejected, noFlag: 0, total: passed + rejected }, sharePct: 1 });
    const d = {
      ...EMPTY['sack-weight-range'],
      bandKg: 0.1,
      passedRange: { minKg: 47.0, maxKg: 47.6 },
      bands: [band(3000, 100), band(2000, 335)],
      spreadTotal: { date: null, shift: null, n: 5431, minKg: 40, maxKg: 50, rangeKg: 10, avgKg: 47.3, sdKg: 0.4 },
    };
    const s = summarise('sack-weight-range', wrapReport(d));
    const text = s.sentences.join(' ');
    expect(text).toContain('5,435 sacks were weighed: 5,000 passed and 435 were rejected by the scale.');
    expect(text).toMatch(/from 47\.00.kg to 47\.60.kg; that is the recorded pass range, not a tolerance\./);
    expect(text).toMatch(/averaged 47\.30.kg with a standard deviation of 0\.40.kg, grouped in 0\.1 kg bands\./);
    expect(s.tiles.find((t) => t.label === 'Passed range')).toMatchObject({ value: '47.00–47.60', unit: 'kg' });
  });

  it('sack weight summary: totals, spread over plausible sacks and the excluded count', () => {
    const d = {
      ...EMPTY['sack-weight-summary'],
      total: { sacks: 5435, kg: 257000, avgKg: 47.3, minKg: 40, maxKg: 50, sdKg: 0.4, rejectedByScale: 594, implausible: 4 },
      weightBasis: 'gross',
    };
    const s = summarise('sack-weight-summary', wrapReport(d));
    const text = s.sentences.join(' ');
    expect(text).toContain('5,435 sacks were weighed, 257,000 kg in total, averaging 47.30');
    expect(text).toContain('594 were rejected by the scale.');
    expect(text).toContain('4 sacks with an implausible weight are left out of them.');
    expect(s.tiles[1]).toMatchObject({ value: '257,000', unit: 'kg', note: 'gross' });
  });

  it('the weight basis is printed in words on the three sack summaries, never as the raw code', () => {
    const sps = summarise('sps-packing', wrapReport({ ...EMPTY['sps-packing'], grandTotal: { sacks: 5, kg: 235, avgKg: 47 }, weightBasis: 'as_recorded' }));
    expect(sps.tiles.find((t) => t.label === 'Sack weight')?.note).toBe('as the scale recorded them');
    const net = summarise('sack-weight-summary', wrapReport({ ...EMPTY['sack-weight-summary'], weightBasis: 'net' }));
    expect(net.tiles.find((t) => t.label === 'Sack weight')?.note).toBe('net of the sack tare');
    for (const s of [sps, net]) for (const t of s.tiles) expect(t.note ?? '').not.toMatch(/as_recorded/);
    // a basis the page does not know is printed as it came; an absent one prints no note
    const odd = summarise('sack-weight-summary', wrapReport({ ...EMPTY['sack-weight-summary'], weightBasis: 'mystery' }));
    expect(odd.tiles.find((t) => t.label === 'Sack weight')?.note).toBe('mystery');
    const none = summarise('sack-weight-summary', wrapReport({ ...EMPTY['sack-weight-summary'], weightBasis: undefined }));
    expect(none.tiles.find((t) => t.label === 'Sack weight')?.note).toBeNull();
  });

  it('rejected hangers: flagged hangers stand out in this period, never bad or faulty', () => {
    const row = (hanger: number | null, total: number, flag: 'stands_out' | 'too_few' | null) => ({ hanger, cones: 471, inspected: 471 + total, qualityRejects: total, weightRejects: 0, total, ratePct: 12, flag });
    const d = {
      ...EMPTY['rejected-hangers'],
      hangers: [row(91, 58, 'stands_out'), row(205, 40, 'stands_out'), row(7, 3, null)],
      total: { ...row(null, 101, null), cones: 1000, inspected: 1100, ratePct: 9.2 },
      flagging: { canFlag: true, reason: null, lineRatePct: 3.4, hangersSeen: 299, hangersJudged: 299, minInspected: 100, alpha: 0.05 },
    };
    const s = summarise('rejected-hangers', wrapReport(d));
    const text = s.sentences.join(' ');
    expect(text).toContain('101 cones were rejected, on 3 hangers.');
    expect(text).toContain('Hangers 91, 205 stand out in this period; this describes the period’s counts, not the hanger itself.');
    expect(text).not.toMatch(/\b(bad|faulty|defective|broken)\b/i);
    expect(s.tiles.find((t) => t.label === 'Hangers that stand out')).toMatchObject({ value: '2', attn: true });
  });

  it('rejected hangers: when no hanger can be judged the server’s reason is the sentence', () => {
    const d = {
      ...EMPTY['rejected-hangers'],
      hangers: [{ hanger: 3, cones: 20, inspected: 22, qualityRejects: 2, weightRejects: 0, total: 2, ratePct: 9, flag: 'too_few' }],
      total: { hanger: null, cones: 20, inspected: 22, qualityRejects: 2, weightRejects: 0, total: 2, ratePct: 9, flag: null },
    };
    const s = summarise('rejected-hangers', wrapReport(d));
    expect(s.sentences.join(' ')).toContain('too few cones per hanger in this period — choose a longer period');
  });

  it('rejected unknown lifter: the empty state is the sentence the report promises', () => {
    const s = summarise('rejected-unknown-lifter', wrapReport(EMPTY['rejected-unknown-lifter']));
    expect(s.sentences.join(' ')).toContain('Every rejected cone in this period carries a lifter number.');
  });

  it('rejected unknown lifter: a zero reason code is not "unknown" — it is counted and listed apart, in its own sentence', () => {
    const d = {
      ...EMPTY['rejected-unknown-lifter'],
      lifters: [{ lifter: 1, cones: 10, inspected: 10, qualityRejects: 5, zeroCodeRejects: 5, weightRejects: 0, total: 5, ratePct: 50 }],
      total: { lifter: null, cones: 10, inspected: 10, qualityRejects: 5, zeroCodeRejects: 5, weightRejects: 0, total: 5, ratePct: 50 },
      unknownCount: 0, zeroCodeList: [], zeroCodeTotal: 5,
    };
    const s = summarise('rejected-unknown-lifter', wrapReport(d));
    const text = s.sentences.join(' ');
    // Nothing lacks a lifter or a winder, so the empty-state sentence stands...
    expect(text).toContain('Every rejected cone in this period carries a lifter number.');
    // ...and the five zero-coded rejects are stated apart, never folded into "unknown".
    expect(text).toContain('5 rejected cones carry a zero reason code; they are counted in the table and listed apart, because IFL has not confirmed what a zero code means.');
    expect(text).not.toContain('no lifter, no winder or a zero reason code');
    expect(s.tiles.find((t) => t.label === 'No lifter or winder recorded')).toMatchObject({ value: '0' });
    expect(s.tiles.find((t) => t.label === 'No lifter or winder recorded')?.attn).toBeFalsy();
    expect(s.tiles.find((t) => t.label === 'Reason code zero')).toMatchObject({ value: '5', attn: true });
  });

  it('rejected unknown lifter: one reject with no lifter or winder reads singular, and one zero code too', () => {
    const d = {
      ...EMPTY['rejected-unknown-lifter'],
      total: { lifter: null, cones: 10, inspected: 11, qualityRejects: 2, zeroCodeRejects: 1, weightRejects: 0, total: 2, ratePct: 18 },
      unknownCount: 1, listTotal: 1, zeroCodeTotal: 1,
    };
    const text = summarise('rejected-unknown-lifter', wrapReport(d)).sentences.join(' ');
    expect(text).toContain('1 rejected cone has no lifter number or no winder number recorded.');
    expect(text).toContain('1 rejected cone carries a zero reason code; it is counted in the table and listed apart');
  });

  it('rejected unknown lifter: listed rejects and the zeroed-clock records are counted apart', () => {
    const z = { date: '1969-12-31', shift: 'night', producedAtUtc: '1970-01-01T00:00:00Z', lifter: null, hanger: null, winder: null, rejectType: 'quality', tubeCode: 0, materialCode: 0, weightG: null, why: ['Clock zeroed (1970)'] };
    const d = {
      ...EMPTY['rejected-unknown-lifter'],
      lifters: [{ lifter: 1, cones: 10, inspected: 10, qualityRejects: 0, zeroCodeRejects: 0, weightRejects: 0, total: 0, ratePct: 0 }, { lifter: null, cones: 0, inspected: 3, qualityRejects: 3, zeroCodeRejects: 1, weightRejects: 0, total: 3, ratePct: 100 }],
      total: { lifter: null, cones: 10, inspected: 13, qualityRejects: 3, zeroCodeRejects: 1, weightRejects: 0, total: 3, ratePct: 23 },
      unknownCount: 3, listTotal: 3, list: [], zeroCodeTotal: 1,
      zeroedClock: { generation: 'SEP07', rows: [z, z] },
    };
    const s = summarise('rejected-unknown-lifter', wrapReport(d));
    const text = s.sentences.join(' ');
    expect(text).toContain('3 rejected cones have no lifter number or no winder number recorded.');
    expect(text).toContain('1 rejected cone carries a zero reason code;');
    expect(text).toContain('2 records with a zeroed clock exist in this data batch; no period reaches them.');
    expect(s.tiles.find((t) => t.label === 'No lifter or winder recorded')).toMatchObject({ value: '3', attn: true });
    expect(s.tiles.find((t) => t.label === 'Zeroed-clock records')?.value).toBe('2');
  });
});
