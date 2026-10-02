/**
 * IFL's eight named reports (their email of 29 Sep 2026): the registries a
 * type must be in to be offered at all — REPORT_TYPES, the chip groups, the
 * filter table, the ranks, the words — and the pins that keep the existing
 * ten types' order and meaning intact (the new six are appended AFTER
 * 'rejected-cones').
 */
import { describe, expect, it } from 'vitest';
import { REPORT_TYPES } from '../../api';
import type { ReportType } from '../../api';
import { W } from '../../lib/words';
import type { Period } from '../../lib/period';
import { acceptsFilter, EXPORT_MIN_RANK, filtersFor, FILTERS_BY_TYPE, queryFor, REPORT_GROUPS, REPORT_MIN_RANK } from './model';

const NEW_SIX: ReportType[] = ['rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary', 'rejected-hangers', 'rejected-unknown-lifter'];
const week: Period = { key: 'week', from: '2026-09-01', to: '2026-09-07', tsTo: '2026-09-07T09:00:00.000Z', live: false, days: 7 };

describe('REPORT_TYPES', () => {
  it('has eighteen types, the six new ones appended after rejected-cones so earlier pins hold', () => {
    expect(REPORT_TYPES).toHaveLength(18);
    expect(REPORT_TYPES.slice(0, 12)).toEqual([
      'daily', 'shift', 'product', 'station', 'reject', 'cone-weight', 'sack', 'calibration', 'management-summary',
      'machine-product', 'shift-production', 'rejected-cones',
    ]);
    expect(REPORT_TYPES.slice(12)).toEqual(NEW_SIX);
  });
});

describe('REPORT_GROUPS', () => {
  it('places every type in exactly one row', () => {
    const all = [...REPORT_GROUPS.ifl, ...REPORT_GROUPS.analysis];
    expect(all).toHaveLength(REPORT_TYPES.length);
    expect(new Set(all).size).toBe(REPORT_TYPES.length);
    for (const t of REPORT_TYPES) expect(all).toContain(t);
  });
  it('the IFL row is IFL’s own eight in their numbering; the analysis row is the other ten', () => {
    expect(REPORT_GROUPS.ifl).toEqual([
      'shift-production', 'rejected-sacks', 'sps-packing', 'sack-weight-range',
      'sack-weight-summary', 'rejected-cones', 'rejected-hangers', 'rejected-unknown-lifter',
    ]);
    expect(REPORT_GROUPS.analysis).toHaveLength(10);
    expect(REPORT_GROUPS.analysis).toContain('sack');
    expect(REPORT_GROUPS.analysis).not.toContain('shift-production');
  });
  it('the row labels are IFL reports / Analysis', () => {
    expect(W.iflReports.groups).toEqual({ ifl: 'IFL reports', analysis: 'Analysis' });
    expect(W.iflReports.pendingHeading).toBe('Assumed until IFL confirms');
  });
});

describe('the words', () => {
  it('every type has a name and a question; IFL’s own names are used for its eight', () => {
    for (const t of REPORT_TYPES) {
      expect(W.reports.type[t].length).toBeGreaterThan(3);
      expect(W.reports.question[t].length).toBeGreaterThan(10);
    }
    expect(W.reports.type['shift-production']).toBe('Shift-wise CTS Loop Production Report');
    expect(W.reports.type['rejected-cones']).toBe('List of Rejected Cones Against Weight');
    // The existing 'sack' report stays beside the new summary, under its own name.
    expect(W.reports.type.sack).toBe('Sacks');
    expect(new Set(REPORT_TYPES.map((t) => W.reports.type[t])).size).toBe(REPORT_TYPES.length);
  });
  it('no label set says "Textile Plant 4" (D-48): the masthead place comes from the header', () => {
    expect(JSON.stringify(W)).not.toContain('Textile Plant 4');
  });
});

describe('filters and ranks for the new six', () => {
  it('match the server table (common.ts FILTERS_BY_TYPE)', () => {
    expect(FILTERS_BY_TYPE['rejected-sacks']).toEqual(['shift', 'product']);
    expect(FILTERS_BY_TYPE['sps-packing']).toEqual(['shift']);
    expect(FILTERS_BY_TYPE['sack-weight-range']).toEqual(['shift', 'product']);
    expect(FILTERS_BY_TYPE['sack-weight-summary']).toEqual(['shift', 'product']);
    expect(FILTERS_BY_TYPE['rejected-hangers']).toEqual(['shift', 'station', 'product']);
    expect(FILTERS_BY_TYPE['rejected-unknown-lifter']).toEqual(['shift', 'product']);
    // No sack report narrows by station: sack rows carry none.
    for (const t of ['rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary'] as ReportType[]) expect(acceptsFilter(t, 'station')).toBe(false);
  });
  it('every new report is rank 1 to read; export stays rank 3', () => {
    for (const t of NEW_SIX) expect(REPORT_MIN_RANK[t]).toBe(1);
    expect(Object.entries(REPORT_MIN_RANK).filter(([, r]) => r === 3).map(([k]) => k)).toEqual(['management-summary']);
    expect(EXPORT_MIN_RANK).toBe(3);
  });
  it('queryFor sends only the filters a type accepts', () => {
    const all = { shift: 'night' as const, station: 7, product: 21 };
    expect(queryFor('sps-packing', week, all, null)).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-07', at: null, shift: 'night' });
    expect(queryFor('rejected-sacks', week, all, null)).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-07', at: null, shift: 'night', product: 21 });
    expect(queryFor('rejected-hangers', week, all, null)).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-07', at: null, shift: 'night', station: 7, product: 21 });
    expect(filtersFor('rejected-unknown-lifter', all)).toEqual({ shift: 'night', product: 21 });
  });
});

/**
 * Every column of each IFL report's CSV (the frozen contract of 1 Oct 2026,
 * `section` aside) has a plain-words header in W.iflReports, so a screen and
 * a print can head every figure the export carries. The value is the key
 * path of its label, either flat ('date') or under the report's own group.
 */
const CSV_LABELS: Record<string, Record<string, string>> = {
  'shift-production': {
    date: 'date', shift: 'shift', winder: 'winder', weighed: 'shiftProduction.weighed', pass: 'shiftProduction.pass',
    weight_rejects: 'shiftProduction.weightRejects', total: 'shiftProduction.total', efficiency_pct: 'shiftProduction.efficiency', weighed_kg: 'shiftProduction.weighedKg',
  },
  'rejected-cones': {
    date: 'date', shift: 'shift', produced_at_plant_time: 'rejectedConesList.time', winder: 'winder', hanger: 'rejectedConesList.hanger', weight_g: 'weightG',
    product: 'rejectedConesList.product', material_id: 'rejectedConesList.materialId', limits: 'rejectedConesList.limits', target_g: 'rejectedConesList.targetG',
    lo_g: 'rejectedConesList.loG', hi_g: 'rejectedConesList.hiG', outside_by_g: 'rejectedConesList.outsideBy', limits_lower_bound: 'rejectedConesList.lowerBoundMark',
    scope: 'rejectedConesList.scope', n: 'n', min_g: 'minG', max_g: 'maxG', avg_g: 'avgG',
  },
  'rejected-sacks': {
    date: 'rejectedSacks.date', shift: 'rejectedSacks.shift', produced_at_plant_time: 'rejectedSacks.time', sack_num: 'rejectedSacks.sackNo', product: 'rejectedSacks.product',
    material_id: 'rejectedSacks.materialId', yarn_count: 'rejectedSacks.yarnCount', weight_kg: 'rejectedSacks.weightKg', implausible: 'rejectedSacks.implausibleMark',
    sacks: 'rejectedSacks.sacks', rejected: 'rejectedSacks.rejected', rejected_pct: 'rejectedSacks.rejectedPct', no_flag: 'rejectedSacks.noFlag',
    min_kg: 'rejectedSacks.minKg', max_kg: 'rejectedSacks.maxKg',
  },
  'sps-packing': {
    date: 'spsPacking.date', shift: 'spsPacking.shift', sps: 'spsPacking.sps', yarn_count: 'spsPacking.yarnCount', material_ids: 'spsPacking.materialIds',
    sacks: 'spsPacking.sacks', kg: 'spsPacking.kg', avg_kg: 'spsPacking.avgKg', share_pct: 'spsPacking.share',
  },
  'sack-weight-range': {
    date: 'sackWeightRange.date', shift: 'sackWeightRange.shift', band: 'sackWeightRange.band', from_kg: 'sackWeightRange.fromKg', to_kg: 'sackWeightRange.toKg',
    passed: 'sackWeightRange.passed', rejected: 'sackWeightRange.rejected', total: 'sackWeightRange.total', share_pct: 'sackWeightRange.share', n: 'sackWeightRange.n',
    min_kg: 'sackWeightRange.minKg', max_kg: 'sackWeightRange.maxKg', range_kg: 'sackWeightRange.rangeKg', avg_kg: 'sackWeightRange.avgKg', sd_kg: 'sackWeightRange.sdKg',
  },
  'sack-weight-summary': {
    date: 'sackWeightSummary.date', shift: 'sackWeightSummary.shift', yarn_count: 'sackWeightSummary.yarnCount', material_ids: 'sackWeightSummary.materialIds',
    sacks: 'sackWeightSummary.sacks', kg: 'sackWeightSummary.kg', avg_kg: 'sackWeightSummary.avgKg', min_kg: 'sackWeightSummary.minKg', max_kg: 'sackWeightSummary.maxKg',
    sd_kg: 'sackWeightSummary.sdKg', rejected_by_scale: 'sackWeightSummary.rejectedByScale', implausible: 'sackWeightSummary.implausible',
  },
  'rejected-hangers': {
    hanger: 'rejectedHangers.hanger', cones: 'rejectedHangers.cones', inspected: 'rejectedHangers.inspected', quality_rejects: 'rejectedHangers.qualityRejects',
    weight_rejects: 'rejectedHangers.weightRejects', total_rejects: 'rejectedHangers.total', rate_pct: 'rejectedHangers.ratePct', flag: 'rejectedHangers.flag',
    date: 'rejectedHangers.date', produced_at_plant_time: 'rejectedHangers.time', shift: 'rejectedHangers.shift', winder: 'rejectedHangers.winder',
    reject_type: 'rejectedHangers.type', reason: 'rejectedHangers.reason', weight_g: 'rejectedHangers.weightG',
  },
  'rejected-unknown-lifter': {
    lifter: 'rejectedUnknownLifter.lifter', cones: 'rejectedUnknownLifter.cones', inspected: 'rejectedUnknownLifter.inspected', quality_rejects: 'rejectedUnknownLifter.qualityRejects',
    zero_code_rejects: 'rejectedUnknownLifter.zeroCode', weight_rejects: 'rejectedUnknownLifter.weightRejects', total_rejects: 'rejectedUnknownLifter.total',
    rate_pct: 'rejectedUnknownLifter.ratePct', date: 'rejectedUnknownLifter.date', produced_at_plant_time: 'rejectedUnknownLifter.time', shift: 'rejectedUnknownLifter.shift',
    hanger: 'rejectedUnknownLifter.hanger', winder: 'rejectedUnknownLifter.winder', reject_type: 'rejectedUnknownLifter.type', tube_code: 'rejectedUnknownLifter.tubeCode',
    material_code: 'rejectedUnknownLifter.materialCode', weight_g: 'rejectedUnknownLifter.weightG', why: 'rejectedUnknownLifter.why',
  },
};

describe('W.iflReports has a header for every CSV column of every IFL report', () => {
  const pick = (path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], W.iflReports);
  it.each(Object.entries(CSV_LABELS))('%s', (_type, cols) => {
    for (const [col, path] of Object.entries(cols)) {
      const v = pick(path);
      expect(typeof v, `${col} -> ${path}`).toBe('string');
      expect((v as string).length, `${col} -> ${path}`).toBeGreaterThan(0);
    }
  });
  it('every report has an empty-state sentence', () => {
    for (const k of ['shiftProduction', 'rejectedConesList', 'rejectedSacks', 'spsPacking', 'sackWeightRange', 'sackWeightSummary', 'rejectedHangers', 'rejectedUnknownLifter']) {
      expect(typeof pick(`${k}.empty`), k).toBe('string');
    }
    expect(W.iflReports.rejectedUnknownLifter.allHaveLifter).toBe('Every rejected cone in this period carries a lifter number.');
  });
});
