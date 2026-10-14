/** Data-audit fixes (14 Oct 2026): M1 label of the combined figure, M9 singular/plural, M7 per-product wording. */
import { describe, expect, it } from 'vitest';
import { C } from './copy';

describe('M1: the combined failed figure is never labelled bare "Failed inspection"', () => {
  const L = 'Failed inspection or weight check';
  it('Today KPI tile, station tiles, Stations column, station sheet and Wall use the combined label', () => {
    expect(C.checks.failedInspectionOrWeight).toBe(L);
    expect(C.stationUi.failedInspection).toBe(L);
    expect(C.qualityStations.colFailedInspection).toBe(L);
    expect(C.qualityStations.kpiFailedInspection).toBe(L);
    expect(C.wall.kpi.failed).toBe(L);
  });
  it('the Register list that holds both kinds says so', () => {
    expect(C.register.listings.inspectionRejects).toBe('Inspection or weight-check fails');
  });
  it('the inspection-only Rejects tab keeps "Failed inspection"', () => {
    expect(C.qualityRejects.failedInspection).toBe('Failed inspection');
  });
});

describe('M9: singular and plural', () => {
  it('count lines say "1 cone"', () => {
    const R = C.register as unknown as Record<string, (a: string, b: string) => string>;
    for (const k of ['inspectionFails', 'weightFails', 'conesWeighed', 'outsideLimits']) {
      expect(R[k]!('All cones', '1')).not.toMatch(/\b1 cones\b/);
      expect(R[k]!('All cones', '2')).toMatch(/\b2 cones?\b/);
    }
    expect(C.qualityRejects.sheetCount('1', 'Code 2/1')).toMatch(/^1 cone /);
  });
});

describe('M7: no single band when products differ', () => {
  it('has a plain per-product sentence and a per-product tolerance note', () => {
    expect(C.qualityWeight.perProductLimits).toMatch(/own product/);
    expect(C.qualityWeight.kpi.withinDetailPerProduct('5')).toMatch(/own product/i);
  });
});
