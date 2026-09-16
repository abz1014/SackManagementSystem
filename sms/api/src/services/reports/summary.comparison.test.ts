/**
 * UX Phase 5 Brief 1, unit U5 (16 Sep 2026) — a period-over-period comparison
 * may not be an artefact of coverage.
 *
 * summary.ts compares the current period with the prior period of EQUAL
 * LENGTH (common.ts's priorPeriod — CALENDAR days). The record has a real
 * hole (10 Jul – 5 Aug 2026: IFL rebuilt its source tables and has not yet
 * sent the month in between), so a prior period landing in that hole can
 * hold a handful of days of data against a fully-covered current period.
 * Until this fix, `figuresFor` only nulled a period's figures when it was
 * TOTALLY empty (summary.ts's old `empty` check) — a prior holding 9 of 34
 * days still produced a normal-looking delta, e.g. "cones weighed down 73%",
 * which is entirely explained by the missing days and says nothing about
 * production.
 *
 * This file drives getManagementSummary end to end (mocking only the
 * services it composes, same idiom as reports.test.ts) with a synthetic
 * 34-day period whose prior lands in the coverage hole, and pins:
 *  - a COUNT-shaped KPI (cones_weighed) is marked incomparable;
 *  - a RATE KPI (inspection_reject_rate_pct) — coverage-independent by
 *    construction — stays comparable;
 *  - with equal coverage on both sides, every KPI is comparable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../report.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../report.js')>();
  return { ...actual, getReport: vi.fn() };
});
vi.mock('../register.js', () => ({ listEvents: vi.fn() }));
vi.mock('../production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('../weights.js', () => ({ getWeights: vi.fn() }));
vi.mock('../weightStations.js', () => ({ getWeightStations: vi.fn() }));
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});

import { getReport, type ReportData } from '../report.js';
import { listEvents } from '../register.js';
import { getProduction } from '../production.js';
import { getWeights } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { loadProductCatalogue } from '../productLimits.js';
import { getManagementSummary } from './summary.js';

/** A 34-day September window — the September generation's own length — so the
 *  prior period (also 34 days, ending the day before) lands entirely inside
 *  the real 10 Jul – 5 Aug hole. */
const CURRENT = { period: 'custom' as const, from: '2026-08-05', to: '2026-09-07' };

const reportLine = (cones: number) => ({
  group: 'total', cones, rejectedCones: Math.round(cones * 0.02), rejectRatePct: 1.96, conesInRangePct: 99.5,
  sacks: Math.round(cones / 25), sackWeightKg: Math.round((cones / 25) * 47), avgSackKg: 47, conesPerSack: 25,
});

/** `daysWithData` is the only coverage figure this file exercises; the rest of `ReportData` is filled with harmless defaults. */
function fakeReport(daysWithData: number, daysInPeriod: number, cones: number): ReportData {
  const empty = daysWithData === 0;
  return {
    period: CURRENT,
    shift: null,
    coverage: { daysInPeriod, daysWithData, firstDayWithData: empty ? null : '2026-08-05', lastDayWithData: empty ? null : '2026-09-07', complete: daysWithData === daysInPeriod },
    totals: reportLine(empty ? 0 : cones),
    byShift: [],
    byDay: [],
    downtime: empty ? null : { stoppageCount: 4, stoppedSeconds: 1200, thresholdSeconds: 120 },
    readings: empty ? null : { states: { within: 900, low: 10, high: 5, rejected: 3, unknown: 82 }, implausible: 4 },
    shiftCheck: empty ? null : { compared: cones, mismatched: 23, mismatchPct: 2.3, topHour: 13 },
  };
}

const fakeWeights = (avg = 1957.1) => ({
  basis: 'as_recorded' as const,
  cone: { count: 996, implausible: 4, avg, min: 1802, max: 2050, stdev: 12.3, unit: 'g' as const, bucketSize: 20, histogram: [], outliers: [] },
  sack: { count: 40, implausible: 1, avg: 47, min: 45, max: 49, stdev: 0.8, unit: 'kg' as const, bucketSize: 1, histogram: [], outliers: [] },
  note: '',
});

const fakeStations = () => ({
  from: CURRENT.from, to: CURRENT.to, days: 34, lineMeanG: 1957.1, targetG: 1960, productId: 21, productLabel: '205-IL0-SD',
  targetEffectiveFromUtc: '2026-08-20T00:00:00.000Z', limitsChangedInWindow: 0, productChangesInWindow: 0,
  thresholdG: 3, minDaysHeld: 3, lineRejectRatePct: 2.16, stations: [],
});

beforeEach(() => {
  vi.mocked(getReport).mockReset();
  vi.mocked(listEvents).mockReset().mockResolvedValue({ rows: [], total: 17, page: 1, pageSize: 1 });
  vi.mocked(getProduction).mockReset().mockResolvedValue({ groupBy: 'product', rows: [], unattributed: null, states: null, implausible: null } as never);
  vi.mocked(getWeights).mockReset().mockResolvedValue(fakeWeights() as never);
  vi.mocked(getWeightStations).mockReset().mockResolvedValue(fakeStations() as never);
  vi.mocked(loadProductCatalogue).mockReset().mockResolvedValue({ product: () => null } as never);
});

describe('management summary — a comparison may not be an artefact of coverage (U5)', () => {
  it('a prior with 9 of 34 days makes cones_weighed incomparable, while the rate KPI stays comparable', async () => {
    vi.mocked(getReport).mockImplementation(async (_p, _l, resolved) =>
      resolved.from === CURRENT.from
        ? fakeReport(34, 34, 8000) // current: fully covered
        : fakeReport(9, 34, 2000), // prior: lands in the 10 Jul – 5 Aug hole
    );
    const d = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT, {});

    const cones = d.kpis.find((k) => k.key === 'cones_weighed')!;
    expect(cones.comparable).toBe(false);
    expect(cones.incomparableReason).not.toBeNull();
    expect(cones.incomparableReason).toMatch(/9 of 34/);
    expect(cones.incomparableReason).toMatch(/34 of 34/);

    // Every other COUNT-shaped KPI (unit cones/sacks/kg/seconds/stops/readings) is incomparable too.
    for (const key of ['sacks_weighed', 'sack_weight_kg', 'time_lost_seconds', 'stoppages', 'implausible_readings', 'rejects_at_inspection', 'cones_rejected_by_scale']) {
      const k = d.kpis.find((x) => x.key === key)!;
      expect(k.comparable, key).toBe(false);
    }

    // Rate and mean KPIs are coverage-independent and stay comparable.
    const rate = d.kpis.find((k) => k.key === 'inspection_reject_rate_pct')!;
    expect(rate.comparable).toBe(true);
    expect(rate.incomparableReason).toBeNull();
    const mean = d.kpis.find((k) => k.key === 'mean_cone_weight_g')!;
    expect(mean.comparable).toBe(true);

    // Defect fix (16 Sep 2026): these two are MEANS/RATIOS whose unit happens
    // to match a count KPI's unit ('kg' like sack_weight_kg, 'cones' like
    // cones_weighed) — they must not be swept into the count-shaped group by
    // unit alone. A coverage gap does not make the average sack lighter or
    // change how many cones go in a sack.
    const avgSack = d.kpis.find((k) => k.key === 'avg_sack_kg')!;
    expect(avgSack.comparable).toBe(true);
    expect(avgSack.incomparableReason).toBeNull();
    const conesPerSack = d.kpis.find((k) => k.key === 'cones_per_sack')!;
    expect(conesPerSack.comparable).toBe(true);
    expect(conesPerSack.incomparableReason).toBeNull();

    // days_with_data IS the coverage figure — always comparable, never suppressed.
    expect(d.kpis.find((k) => k.key === 'days_with_data')!.comparable).toBe(true);
  });

  it('equal coverage on both sides leaves every KPI comparable', async () => {
    vi.mocked(getReport).mockImplementation(async (_p, _l, resolved) =>
      resolved.from === CURRENT.from ? fakeReport(34, 34, 8000) : fakeReport(33, 34, 7800),
    );
    const d = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT, {});
    // 34 vs 33 of 34 days: a 1-day gap, 1/34 ≈ 2.9% — well under the 20% line.
    for (const k of d.kpis) {
      expect(k.comparable, k.key).toBe(true);
      expect(k.incomparableReason, k.key).toBeNull();
    }
  });

  it('a coverage gap right at the boundary: just past 20% of the period is incomparable, just under is not', async () => {
    // 34-day period: 20% of 34 ≈ 6.8 days. A 7-day gap (27 of 34) is just
    // over the line; a 6-day gap (28 of 34) is just under it.
    vi.mocked(getReport).mockImplementation(async (_p, _l, resolved) =>
      resolved.from === CURRENT.from ? fakeReport(34, 34, 8000) : fakeReport(27, 34, 6000),
    );
    const overLine = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT, {});
    expect(overLine.kpis.find((k) => k.key === 'cones_weighed')!.comparable).toBe(false);

    vi.mocked(getReport).mockImplementation(async (_p, _l, resolved) =>
      resolved.from === CURRENT.from ? fakeReport(34, 34, 8000) : fakeReport(28, 34, 6200),
    );
    const underLine = await getManagementSummary({} as unknown as ConnectionPool, 1, CURRENT, {});
    expect(underLine.kpis.find((k) => k.key === 'cones_weighed')!.comparable).toBe(true);
  });
});
