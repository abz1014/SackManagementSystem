import { describe, expect, it } from 'vitest';
import { driftThresholdG, rejectRiseFinding, stationDriftFindings, MIN_DAYS_HELD } from './attention.js';
import type { CalibrationData, StationDrift, StationDriftDay } from './calibration.js';
import type { RejectSpcData } from './rejectSpc.js';

/* --------------------------------------------------------------- helpers */

const day = (date: string, mean: number, nelson: number[] = []): StationDriftDay =>
  ({ date, n: 600, mean, nelson }) as StationDriftDay;

const station = (id: number, days: StationDriftDay[]): StationDrift => {
  const n = days.reduce((s, d) => s + d.n, 0);
  return {
    station: id,
    n,
    grandMean: n ? days.reduce((s, d) => s + d.n * d.mean, 0) / n : 0,
    stdevWithin: 4,
    sigmaDayToDay: 1.2,
    days,
    flagged: days.some((d) => d.nelson.length > 0),
  };
};

const cal = (stations: StationDrift[]): CalibrationData => ({
  unit: 'g',
  from: '2026-08-19',
  to: '2026-09-01',
  days: 14,
  stations,
  flaggedStationCount: stations.filter((s) => s.flagged).length,
});

/** Six flat days at the line mean — a station nobody should hear about. */
const flat = (id: number, mean: number) =>
  station(id, ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'].map((d) => day(d, mean)));

/** Six days sitting `off` grams away, with the pattern test having fired. */
const drifting = (id: number, base: number, off: number) =>
  station(
    id,
    ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'].map((d, i) =>
      day(d, base + off, i >= 3 ? [3] : []),
    ),
  );

const noAdjustments = new Map<number, number>();

/* ------------------------------------------------------------ threshold */

describe('driftThresholdG', () => {
  it('takes a tenth of the product tolerance when one is recorded', () => {
    // 1,960 ± 40 g is an 80 g band, so 8 g is worth a maintenance look.
    expect(driftThresholdG([1950, 1951, 1952], 80)).toBe(8);
  });

  it('falls back to three tenths of the spread between stations', () => {
    const means = [1945, 1950, 1955];
    expect(driftThresholdG(means, null)).toBeCloseTo(0.3 * Math.sqrt(50 / 3), 2);
  });

  it('does not divide by zero on a single station', () => {
    expect(driftThresholdG([1950], null)).toBe(0);
  });
});

/* --------------------------------------------------------- station drift */

describe('stationDriftFindings', () => {
  it('names a station that has held one side of the line for days, worst first', () => {
    const data = cal([flat(1, 1950), flat(2, 1950), drifting(7, 1950, 12), drifting(4, 1950, -18)]);
    const out = stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: noAdjustments });
    expect(out.map((f) => f.station)).toEqual([4, 7]);
    expect(out[0]).toMatchObject({ kind: 'station_drift', requirement: 5, screen: 'weight', days: 6 });
    expect(out[0]!.deltaG!).toBeLessThan(0);
    expect(out[1]!.deltaG!).toBeGreaterThan(0);
  });

  it('says nothing when every station sits at the line mean', () => {
    expect(stationDriftFindings(cal([flat(1, 1950), flat(2, 1950), flat(3, 1950)]), {
      toleranceWidthG: 80,
      adjustedAtMsByStation: noAdjustments,
    })).toEqual([]);
  });

  it('ignores an offset smaller than the practical threshold, however consistent', () => {
    // 2 g on an 80 g band. Real, measurable, and not worth anyone walking to
    // the machine — which is exactly why the threshold exists.
    const data = cal([flat(1, 1950), flat(2, 1950), drifting(7, 1950, 2)]);
    expect(stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: noAdjustments })).toEqual([]);
  });

  it('ignores a big offset that has not held long enough to be a pattern', () => {
    const brief = station(7, [
      day('2026-08-30', 1950),
      day('2026-08-31', 1950),
      day('2026-09-01', 1975, [3]),
    ]);
    const data = cal([flat(1, 1950), flat(2, 1950), brief]);
    const out = stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: noAdjustments });
    expect(out).toEqual([]);
  });

  it('requires the pattern test to have fired, not just a standing offset', () => {
    // A station that is simply set 12 g high is an offset to correct at leisure;
    // the home screen is for things that CHANGED.
    const offsetOnly = station(
      7,
      ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'].map((d) => day(d, 1962)),
    );
    const data = cal([flat(1, 1950), flat(2, 1950), offsetOnly]);
    expect(stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: noAdjustments })).toEqual([]);
  });

  it('counts only the consecutive most-recent days on the same side', () => {
    const wobbly = station(7, [
      day('2026-08-27', 1930),
      day('2026-08-28', 1930),
      day('2026-08-29', 1990, [3]),
      day('2026-08-30', 1990, [3]),
      day('2026-08-31', 1990, [3]),
      day('2026-09-01', 1990, [3]),
    ]);
    const data = cal([flat(1, 1950), flat(2, 1950), wobbly]);
    const out = stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: noAdjustments });
    expect(out[0]).toMatchObject({ station: 7, days: 4 });
  });

  it('AN ADJUSTMENT RESTARTS THE STATION: days before it are not counted', () => {
    // The engineer critic's point. Correct a scale today and tomorrow's screen
    // must not still say it has been drifting for a week.
    const data = cal([flat(1, 1950), flat(2, 1950), drifting(7, 1950, 12)]);
    const adjusted = new Map([[7, new Date('2026-08-31T00:00:00Z').getTime()]]);
    const out = stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: adjusted });
    // Only 31 Aug and 1 Sep survive, which is fewer than the minimum run.
    expect(out).toEqual([]);
  });

  it('still reports a station that kept drifting after it was adjusted', () => {
    const days = [
      day('2026-08-25', 1950),
      day('2026-08-26', 1950),
      day('2026-08-27', 1966, [3]),
      day('2026-08-28', 1966, [3]),
      day('2026-08-29', 1966, [3]),
      day('2026-08-30', 1966, [3]),
      day('2026-08-31', 1966, [3]),
      day('2026-09-01', 1966, [3]),
    ];
    const data = cal([flat(1, 1950), flat(2, 1950), station(7, days)]);
    const adjusted = new Map([[7, new Date('2026-08-27T00:00:00Z').getTime()]]);
    const out = stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: adjusted });
    expect(out[0]).toMatchObject({ station: 7, days: 6 });
  });

  it('handles a station with no readings at all without dividing by zero', () => {
    const empty = station(9, []);
    const data = cal([flat(1, 1950), flat(2, 1950), empty]);
    expect(() => stationDriftFindings(data, { toleranceWidthG: 80, adjustedAtMsByStation: noAdjustments })).not.toThrow();
  });

  it('exposes its minimum run as a constant so the screen can state the rule', () => {
    expect(MIN_DAYS_HELD).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------ reject rise */

const spc = (over: Partial<RejectSpcData>): RejectSpcData => ({
  bucketSize: 'day',
  rejectTypeFilter: 'quality',
  totalProduced: 100_000,
  totalRejects: 2_000,
  pBar: 0.02,
  spansGenerations: false,
  generations: [],
  outOfControlCount: 0,
  buckets: [
    { bucketTs: '2026-08-30T00:00:00.000Z', generation: 3, produced: 7000, inspected: 7140, rejects: 140, rate: 0.02, ucl: 0.025, lcl: 0.015, outOfControl: false },
    { bucketTs: '2026-08-31T00:00:00.000Z', generation: 3, produced: 7000, inspected: 7210, rejects: 210, rate: 0.03, ucl: 0.025, lcl: 0.015, outOfControl: true },
    { bucketTs: '2026-09-01T00:00:00.000Z', generation: 3, produced: 7000, inspected: 7217, rejects: 217, rate: 0.031, ucl: 0.025, lcl: 0.015, outOfControl: true },
  ],
  episodes: [],
  ...over,
});

describe('rejectRiseFinding', () => {
  it('reports an episode that is still going', () => {
    const data = spc({
      episodes: [
        { startTs: '2026-08-31T00:00:00.000Z', endTs: '2026-09-01T00:00:00.000Z', bucketCount: 2, totalRejects: 427, totalProduced: 14_000, totalInspected: 14_427 },
      ],
    });
    expect(rejectRiseFinding(data, 'quality')).toMatchObject({
      kind: 'reject_rise',
      requirement: 4,
      screen: 'rejects',
      rejectKind: 'quality',
      sinceUtc: '2026-08-31T00:00:00.000Z',
      // 427 / 14,427 inspected = 2.96%. Was 427 / 14,000 cones = 3.05% —
      // a different denominator from usualPct (= pBar) printed in the
      // same sentence. Both now divide by cones + rejects.
      ratePct: 3,
      usualPct: 2,
    });
  });

  it('IGNORES AN EPISODE THAT ALREADY ENDED — history belongs on the Rejects screen', () => {
    const data = spc({
      episodes: [
        { startTs: '2026-08-20T00:00:00.000Z', endTs: '2026-08-22T00:00:00.000Z', bucketCount: 3, totalRejects: 500, totalProduced: 14_000, totalInspected: 14_500 },
      ],
    });
    expect(rejectRiseFinding(data, 'quality')).toBeNull();
  });

  it('says nothing when there are no episodes', () => {
    expect(rejectRiseFinding(spc({}), 'quality')).toBeNull();
  });

  it('says nothing when there are no buckets or no baseline to compare against', () => {
    expect(rejectRiseFinding(spc({ buckets: [] }), 'quality')).toBeNull();
    expect(rejectRiseFinding(spc({ pBar: null }), 'quality')).toBeNull();
  });

  it('carries the reject kind through, because weight and quality send you to different places', () => {
    const data = spc({
      rejectTypeFilter: 'weight',
      episodes: [
        { startTs: '2026-09-01T00:00:00.000Z', endTs: '2026-09-01T00:00:00.000Z', bucketCount: 1, totalRejects: 217, totalProduced: 7000, totalInspected: 7217 },
      ],
    });
    expect(rejectRiseFinding(data, 'weight')?.rejectKind).toBe('weight');
  });
});
