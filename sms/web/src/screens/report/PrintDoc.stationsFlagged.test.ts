/**
 * C-128 (D-77): a management summary over a period shorter than the drift
 * rule's minimum run carries stations_flagged = null; the printed sentence must
 * not turn that into "No station was flagged for drift."
 */
import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import type { ReportResponse } from '../../api';

const wrap = (report: unknown) => ({ report } as unknown as ReportResponse<never>);
const cov = { daysInPeriod: 1, daysWithData: 1, firstDayWithData: '2026-07-03', lastDayWithData: '2026-07-03', complete: true };
const kpi = (key: string, current: number | null) => ({ key, label: key, unit: 'stations', current, prior: null, delta: null, comparable: true, incomparableReason: null });
const summary = (flagged: number | null) => ({
  coverage: { current: cov, prior: cov },
  verdict: { cones: 100, sacks: 5, sackWeightKg: 235 },
  kpis: [kpi('stations_flagged', flagged)],
});

describe('management summary — stations flagged sentence', () => {
  it('a null count (period shorter than the rule) does not print "No station was flagged"', () => {
    const text = summarise('management-summary', wrap(summary(null))).sentences.join(' ');
    expect(text).not.toMatch(/No station was flagged/);
    expect(text).toMatch(/cannot flag any station/);
  });
  it('a measured zero still reads as no station flagged', () => {
    expect(summarise('management-summary', wrap(summary(0))).sentences.join(' ')).toMatch(/No station was flagged for drift\./);
  });
});
