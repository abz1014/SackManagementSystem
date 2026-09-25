/**
 * Roadmap Phase 9 (calibration analytics, 15 Sep 2026): the restart of the
 * centreline and sigma at a logged adjustment, the per-station median under
 * the one population rule, the projection arithmetic, and the ledger filters.
 * Everything DB-backed runs over a recording fake pool, as the other suites do.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  adjustmentRestarts, getStationDrift, latestRestart, listCalibrationAdjustments, longestContiguousRun,
  projectDaysToLimit, restartsFor, slopePerDay, splitEpochs, type CalibrationAdjustment,
} from './calibration.js';
import { toPlantMs } from './plantClock.js';

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(answer: (sql: string, params: Map<string, unknown>) => unknown[]): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params });
          return { recordset: answer(sql, params) };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const RULE = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };
const endOf = (day: string) => new Date(`${day}T23:59:59.999Z`).getTime();

/* --------------------------------------------------------------- epochs */

describe('splitEpochs — a logged adjustment starts a new epoch', () => {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map((date) => ({ date }));

  it('leaves one epoch when there is no restart', () => {
    expect(splitEpochs(days, [])).toEqual([days]);
  });

  it('cuts at the day whose END is at or after the restart — the server rule the sheet shares', () => {
    // Adjusted at 16:56 plant time on 3 Sep: 3 Sep belongs to the NEW scale.
    const restart = new Date('2026-09-03T16:56:00Z').getTime();
    const epochs = splitEpochs(days, [restart]);
    expect(epochs.map((e) => e.map((d) => d.date))).toEqual([
      ['2026-09-01', '2026-09-02'],
      ['2026-09-03', '2026-09-04', '2026-09-05'],
    ]);
  });

  it('a restart before the first day or after the last day changes nothing', () => {
    expect(splitEpochs(days, [endOf('2026-08-20')])).toEqual([days]);
    expect(splitEpochs(days, [endOf('2026-09-09')])).toEqual([days]);
  });

  it('two restarts make three epochs; two on one day make two', () => {
    const a = new Date('2026-09-02T08:00:00Z').getTime();
    const b = new Date('2026-09-04T08:00:00Z').getTime();
    expect(splitEpochs(days, [b, a]).length).toBe(3);
    expect(splitEpochs(days, [a, a + 3_600_000]).length).toBe(2);
  });
});

describe('longestContiguousRun', () => {
  it('counts calendar-consecutive days, not array neighbours', () => {
    // 10 Jul and 5 Aug sit side by side in the array and 26 days apart on the calendar.
    expect(longestContiguousRun([{ date: '2026-07-09' }, { date: '2026-07-10' }, { date: '2026-08-05' }, { date: '2026-08-06' }, { date: '2026-08-07' }])).toBe(3);
    expect(longestContiguousRun([])).toBe(0);
    expect(longestContiguousRun([{ date: '2026-09-01' }])).toBe(1);
  });
});

/* ------------------------------------------------- restart at an adjustment */

describe('getStationDrift — centreline and sigma restart at a logged adjustment', () => {
  // Station 7: five flat days at 1950, adjusted, then five flat days at 1962.
  // Without the restart the centreline is ~1956 and every day sits 6 g off
  // it on one side — rule 2 territory. With it, each epoch is flat about its
  // own centreline and nothing fires.
  const rows = [
    ...['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map((d) => ({ st: 7, d: new Date(`${d}T00:00:00Z`), n: 600, mean: 1950, sd: 8 })),
    ...['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map((d) => ({ st: 7, d: new Date(`${d}T00:00:00Z`), n: 600, mean: 1962, sd: 8 })),
  ];
  const answer = (sql: string) => (sql.includes('PERCENTILE_CONT') ? [{ st: 7, med: 1955.5 }] : rows);
  const restartMs = new Date('2026-09-06T02:00:00Z').getTime(); // production clock, during 6 Sep

  it('without a restart: one centreline over the whole window', async () => {
    const { pool } = fakePool(answer);
    const cal = await getStationDrift(pool, 1, '2026-09-01', '2026-09-10', RULE);
    const st = cal.stations[0]!;
    expect(st.centrelineG).toBe(1956);
    expect(st.restartedOn).toBeNull();
    expect(st.longestRun).toBe(10);
    // And the false flag the restart exists to prevent: judged against a
    // centreline that is half the old scale, the new scale's days sit ~5σ
    // off it and rule 1 fires on every one of them.
    expect(st.days.filter((d) => d.nelson.includes(1)).length).toBeGreaterThan(0);
    expect(st.flagged).toBe(true);
  });

  it('with a restart: the newest epoch has its own centreline and its own sigma, and the run cannot cross it', async () => {
    const { pool } = fakePool(answer);
    const cal = await getStationDrift(pool, 1, '2026-09-01', '2026-09-10', RULE, {
      restarts: { byStation: new Map([[7, [restartMs]]]), lineWide: [] },
    });
    const st = cal.stations[0]!;
    expect(st.centrelineG).toBe(1962);
    expect(st.sigmaDayToDay).toBe(0); // flat within the epoch
    expect(st.restartedOn).toBe('2026-09-06');
    expect(st.longestRun).toBe(5);
    // grandMean stays the whole-window figure the table's Average column describes.
    expect(st.grandMean).toBe(1956);
    // Nothing fires in either epoch: each is flat about its own centreline.
    expect(st.days.every((d) => d.nelson.length === 0)).toBe(true);
  });

  it('a line-wide adjustment (station NULL) restarts every station', async () => {
    const { pool } = fakePool(answer);
    const cal = await getStationDrift(pool, 1, '2026-09-01', '2026-09-10', RULE, {
      restarts: { byStation: new Map(), lineWide: [restartMs] },
    });
    expect(cal.stations[0]!.restartedOn).toBe('2026-09-06');
  });

  it('reports the median from the ONE population predicate with the rule on file, and the rule table', async () => {
    const { pool, calls } = fakePool(answer);
    const cal = await getStationDrift(pool, 1, '2026-09-01', '2026-09-10', RULE);
    expect(cal.stations[0]!.medianG).toBe(1955.5);
    const med = calls.find((c) => c.sql.includes('PERCENTILE_CONT'))!;
    expect(med.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(med.params.get('plausLo')).toBe(1500);
    expect(med.params.get('plausHi')).toBe(2100);
    expect(cal.rules.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cal.rules.find((r) => r.id === 7)!.minPoints).toBe(15);
  });
});

/* ------------------------------------------------------------ projection */

describe('slopePerDay', () => {
  it('is the least-squares slope in grams per calendar day', () => {
    const run = [
      { date: '2026-09-01', mean: 1950 },
      { date: '2026-09-02', mean: 1951 },
      { date: '2026-09-03', mean: 1952 },
      { date: '2026-09-04', mean: 1953 },
    ];
    expect(slopePerDay(run)).toBeCloseTo(1, 9);
  });

  it('uses calendar positions, so a missing day is not treated as adjacent', () => {
    // 2 g over 4 calendar days = 0.5 g/day, not 2 g over 1 step.
    expect(slopePerDay([{ date: '2026-09-01', mean: 1950 }, { date: '2026-09-05', mean: 1952 }])).toBeCloseTo(0.5, 9);
  });

  it('is 0 for fewer than two points or a flat series', () => {
    expect(slopePerDay([])).toBe(0);
    expect(slopePerDay([{ date: '2026-09-01', mean: 1950 }])).toBe(0);
    expect(slopePerDay([{ date: '2026-09-01', mean: 1950 }, { date: '2026-09-02', mean: 1950 }])).toBe(0);
  });
});

describe('projectDaysToLimit — a projection from recent readings, with its assumption stated', () => {
  // RT-020 (25 Sep 2026): MIN_PROJECTION_POINTS raised 2 -> 5, and every
  // projection now carries a 90% CI on the slope — these fixtures were
  // extended from 4 to 5+ perfectly-linear points so the CI excludes zero
  // and the original point-estimate assertions still hold exactly.
  const limits = { loG: 1920, hiG: 2000, targetG: 1960 };
  const rising = [
    { date: '2026-09-01', mean: 1970 },
    { date: '2026-09-02', mean: 1972 },
    { date: '2026-09-03', mean: 1974 },
    { date: '2026-09-04', mean: 1976 },
    { date: '2026-09-05', mean: 1978 },
  ];

  it('extends the run’s line to the limit in its direction of travel', () => {
    const p = projectDaysToLimit(rising, limits)!;
    expect(p).toMatchObject({ slopeGPerDay: 2, overDays: 5, towards: 'upper', limitG: 2000, targetG: 1960, distanceG: 22, assumption: 'linear_over_run', status: 'established' });
    // 22 g at 2 g/day.
    expect(p.daysToLimit).toBe(11);
    expect(p.daysLow).not.toBeNull();
    expect(p.daysHigh).not.toBeNull();
  });

  it('heads for the lower limit when falling', () => {
    const falling = rising.map((d) => ({ date: d.date, mean: 3900 - d.mean }));
    const p = projectDaysToLimit(falling, limits)!;
    expect(p.towards).toBe('lower');
    expect(p.limitG).toBe(1920);
    expect(p.slopeGPerDay).toBe(-2);
    // last mean 1922, 2 g to go at 2 g/day.
    expect(p.daysToLimit).toBe(1);
  });

  it('is 0 days when the last mean is already past the limit', () => {
    const past = rising.map((d) => ({ date: d.date, mean: d.mean + 30 }));
    const p = projectDaysToLimit(past, limits)!;
    expect(p.daysToLimit).toBe(0);
    expect(p.daysLow).toBe(0);
    expect(p.daysHigh).toBe(0);
  });

  it('has no days-to-limit when the run is heading back toward the target (the station 3 case, 19-20 Aug 2026)', () => {
    // 9 g heavy, but the line slopes gently DOWN: extending it to the lower
    // limit far away is arithmetic, not a projection.
    const returning = [
      { date: '2026-08-16', mean: 1970.3 },
      { date: '2026-08-17', mean: 1969.9 },
      { date: '2026-08-18', mean: 1969.5 },
      { date: '2026-08-19', mean: 1969.3 },
      { date: '2026-08-20', mean: 1969.2 },
    ];
    const p = projectDaysToLimit(returning, limits)!;
    expect(p.slopeGPerDay).toBeLessThan(0);
    expect(p.towards).toBe('lower');
    expect(p.daysToLimit).toBeNull();
  });

  it('is null with no limits, a flat run, or fewer than MIN_PROJECTION_POINTS days — nothing to project', () => {
    expect(projectDaysToLimit(rising, null)).toBeNull();
    expect(projectDaysToLimit(rising.map((d) => ({ ...d, mean: 1970 })), limits)).toBeNull();
    expect(projectDaysToLimit(rising.slice(0, 4), limits)).toBeNull();
  });

  it('is not_established when the 5-day trend is noisy — the CI on the slope includes zero', () => {
    const noisy = [
      { date: '2026-09-01', mean: 1948 },
      { date: '2026-09-02', mean: 1974 },
      { date: '2026-09-03', mean: 1949 },
      { date: '2026-09-04', mean: 1977 },
      { date: '2026-09-05', mean: 1951 },
    ];
    const p = projectDaysToLimit(noisy, limits)!;
    expect(p.status).toBe('not_established');
    expect(p.daysToLimit).toBeNull();
    expect(p.daysLow).toBeNull();
    expect(p.daysHigh).toBeNull();
    expect(p.reason).toBeTruthy();
  });
});

/* ------------------------------------------------------------- the ledger */

describe('adjustmentRestarts / restartsFor / latestRestart', () => {
  const adj = (id: number, stationId: number | null, utc: string): CalibrationAdjustment => ({
    adjustmentId: id, stationId, adjustedAtUtc: utc, adjustedAtPlant: utc, recordedAtUtc: utc, recordedBy: null,
    reason: null, note: null, amountG: null, beforeG: null, afterG: null, referenceG: null, productId: null, productLabel: null,
  });

  it('converts the ledger’s UTC to the production clock and folds line-wide rows into every station', () => {
    const r = adjustmentRestarts([
      adj(1, 7, '2026-09-03T11:56:07.499Z'),
      adj(2, null, '2026-09-01T06:00:00.000Z'),
      adj(3, 7, '2026-09-05T06:00:00.000Z'),
    ]);
    expect(r.lineWide).toEqual([toPlantMs('2026-09-01T06:00:00.000Z')]);
    expect(restartsFor(r, 7)).toEqual([
      toPlantMs('2026-09-01T06:00:00.000Z'),
      toPlantMs('2026-09-03T11:56:07.499Z'),
      toPlantMs('2026-09-05T06:00:00.000Z'),
    ]);
    // A station with no adjustment of its own still restarts at the line-wide one.
    expect(restartsFor(r, 3)).toEqual([toPlantMs('2026-09-01T06:00:00.000Z')]);
    expect(latestRestart(r, 7)).toBe(toPlantMs('2026-09-05T06:00:00.000Z'));
    expect(latestRestart(undefined, 7)).toBeNull();
  });
});

describe('listCalibrationAdjustments — from/to on the plant clock, station plus line-wide', () => {
  const row = {
    adjustment_id: 4, station_id: 7, adjusted_at_utc: new Date('2026-09-03T11:56:07.499Z'), recorded_at_utc: new Date('2026-09-03T11:56:07.499Z'),
    recorded_by: 'abdullah', reason: 'verification test', note: null, amount_g: null, before_g: '1949.50', after_g: 1950, reference_g: 1950, product_id: 21,
    product_descr: 'PES 150/48 SD', product_lot: null,
  };

  it('binds the offset and compares the converted instant against the production days', async () => {
    const { pool, calls } = fakePool(() => [row]);
    const out = await listCalibrationAdjustments(pool, 1, { from: '2026-09-01', to: '2026-09-07', station: 7 });
    const c = calls[0]!;
    expect(c.sql).toContain('DATEADD(minute, @offset, a.adjusted_at_utc) >= CAST(@from AS datetime2)');
    expect(c.sql).toContain("DATEADD(minute, @offset, a.adjusted_at_utc) < DATEADD(day, 1, CAST(@to AS datetime2))");
    expect(c.sql).toContain('(a.station_id = @station OR a.station_id IS NULL)');
    expect(c.params.get('from')).toBe('2026-09-01');
    expect(c.params.get('to')).toBe('2026-09-07');
    expect(c.params.get('station')).toBe(7);
    expect(typeof c.params.get('offset')).toBe('number');
    // The row comes back on both clocks and with the reference readings.
    expect(out[0]).toMatchObject({
      adjustmentId: 4, stationId: 7, adjustedAtUtc: '2026-09-03T11:56:07.499Z',
      beforeG: 1949.5, afterG: 1950, referenceG: 1950, productId: 21, productLabel: 'PES 150/48 SD',
    });
    expect(out[0]!.adjustedAtPlant).toBe(new Date(toPlantMs('2026-09-03T11:56:07.499Z')).toISOString());
  });

  it('without filters: no date or station clause, and no offset bound', async () => {
    const { pool, calls } = fakePool(() => []);
    await listCalibrationAdjustments(pool, 1);
    const c = calls[0]!;
    expect(c.sql).not.toContain('@offset');
    expect(c.sql).not.toContain('@station');
    expect(c.params.has('offset')).toBe(false);
  });
});
