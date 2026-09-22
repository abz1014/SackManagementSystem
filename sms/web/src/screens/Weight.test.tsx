/**
 * UX Phase 8 Brief C: the failed-fetch-reads-as-zero defect class, locked
 * down for Weight's private `headline()` (Weight.tsx:500-518), reached only
 * through the mounted component.
 *
 * `WeightScreen` fires four independent fetches on mount: `getWeightStations`
 * (`/api/weight-stations`), `getSpc` twice — `coneLine` (always cone,
 * line-wide) and `spc` (the chart's own population, `cone` here since
 * `chartType="cone"` and `chartStation={null}`) — both against `/api/spc`,
 * and `getProduction`/`getStations` for the other figures and station names.
 * Each case below isolates ONE of those to a failure and leaves the rest
 * healthy, and is paired with its two-sided partner: a genuinely empty
 * period must still read as empty, never as "could not load", and a failed
 * fetch must never read as a clean bill of health.
 *
 * UX Phase 8 Brief C (21 Sep 2026).
 */
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { render } from '../testkit/render';
import { META_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { fmtG } from '../lib/fmt';
import type { Period } from '../lib/period';
import type { Envelope, SpcData, WeightStationsData, ProductionData } from '../api';
import { WeightScreen } from './Weight';

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

function noop(): void {}

function baseProps() {
  return {
    period: PERIOD,
    mode: 'time' as const,
    onModeChange: noop,
    chartType: 'cone' as const,
    onChartTypeChange: noop,
    chartStation: null,
    onChartStationChange: noop,
    onOpenStation: noop,
    onSeeOutside: noop,
  };
}

const STATIONS_OK = { stations: [] };

const PRODUCTION_OK: Envelope<ProductionData> = {
  data: {
    groupBy: 'none',
    rows: [{ group: 'line', cones: 500, rejectedCones: 10, sacks: 20, sackWeightKg: 550, conesInRangePct: 98 }],
    states: null,
    implausible: 0,
    unattributed: null,
  },
  metadata: META_FIXTURE,
};

const WEIGHT_STATIONS_OK: Envelope<WeightStationsData> = {
  data: {
    from: '2026-08-24',
    to: '2026-09-07',
    days: 14,
    lineMeanG: 1948,
    targetG: 1950,
    productId: 231,
    productLabel: '201-IH0-SD',
    thresholdG: 5,
    minDaysHeld: 3,
    lineRejectRatePct: 2.1,
    stations: [
      {
        station: 1,
        n: 812,
        meanG: 1949,
        vsLineG: 1,
        vsTargetG: -1,
        daysHeld: 0,
        flagged: false,
        rejectRatePct: 2.0,
        lastAdjustedUtc: null,
        days: [],
        medianG: 1949,
        sdG: 3.2,
        restartedOn: null,
        centrelineG: 1949,
        sigmaDayToDay: 1.1,
        longestRun: 5,
        projection: null,
        targetBasis: 'station_material',
      },
    ],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
    limits: { loG: 1900, hiG: 2000 },
    rules: [],
    targetEffectiveFromUtc: '2026-09-01T00:00:00Z',
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
  },
  metadata: META_FIXTURE,
};

function spcFixture(count: number, mean: number): Envelope<SpcData> {
  return {
    data: {
      specAgreement: null,
      type: 'cone',
      unit: 'g',
      station: null,
      implausible: 0,
      count,
      mean,
      median: count > 0 ? mean : null,
      stdevOverall: count > 0 ? 4.1 : 0,
      stdevWithin: count > 0 ? 3.0 : 0,
      bucketMinutes: 30,
      bucketLabel: '30-minute',
      grandMean: mean,
      sChartCenter: mean,
      xbarOutOfControl: 0,
      nelsonFlagged: 0,
      subgroups: [],
      stations: [],
      practicalThresholdG: 5,
      distinguishableStationCount: 0,
      flaggedStationCount: 0,
      histogram: [],
      spec: { usl: null, lsl: null, nominal: null, source: 'none' },
      capability: { cp: null, cpk: null, pp: null, ppk: null },
    },
    metadata: META_FIXTURE,
  };
}

describe('Weight — the headline', () => {
  it('/api/spc REJECTS: headline is couldNotLoad; the honest-empty sentence is absent', async () => {
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': () => {
        throw new Error('plant connection down');
      },
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe(W.couldNotLoad));
    expect(h1.textContent).not.toContain('No cones were weighed in this period.');
  });

  it('/api/spc RESOLVES with count 0: headline IS the honest-empty sentence', async () => {
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(0, 0),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe('No cones were weighed in this period.'));
    // Two-sided: must not be confused with the failure sentence above.
    expect(h1.textContent).not.toBe(W.couldNotLoad);
  });

  it('/api/spc resolves, /api/weight-stations REJECTS: headline states the mean AND names the station-data failure; "Every station is steady." is absent', async () => {
    const mean = 1948.3;
    installFakeFetch({
      '/api/weight-stations': () => {
        throw new Error('plant connection down');
      },
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, mean),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toContain(W.weight.headlineStationDataFailed));
    expect(h1.textContent).toContain(fmtG(mean));
    // The exact trap this phase exists to close: an empty/unavailable
    // station array must never read as a clean bill of health.
    expect(h1.textContent).not.toContain(W.weight.allStationsSteady);
  });
});

/**
 * DEFECTS.md (22 Sep 2026), reacting to D-1 (62263da): correctly sizing SPC
 * subgroups exposed that the X̄ control band itself does not fit this
 * process — measured ~16% of subgroups "out of control" at month scale
 * against an expected ~0.3% for a stable process. The owner's decision was
 * to suppress the violation/pattern marks and the sentence naming their
 * counts until the limit model is fixed, while leaving spc.ts's computation
 * on the wire. This pins that suppression so it cannot quietly come back
 * before the limit model is actually corrected.
 */
describe('Weight — X̄ violation/pattern suppression (DEFECTS.md, 22 Sep 2026)', () => {
  it('a subgroup with xViolates AND a Nelson pattern draws no accent-fill dot, and no sentence states the violation/pattern counts', async () => {
    const violating: Envelope<SpcData> = spcFixture(500, 1948);
    violating.data.xbarOutOfControl = 3;
    violating.data.nelsonFlagged = 2;
    violating.data.subgroups = [
      {
        ts: '2026-09-07T09:00:00.000Z', n: 82, mean: 1948, s: 3.0,
        xUcl: 1949, xLcl: 1947, sUcl: 4, sLcl: 2,
        xViolates: true, sViolates: false, nelson: [2, 3],
      },
      {
        ts: '2026-09-07T09:15:00.000Z', n: 80, mean: 1949, s: 3.1,
        xUcl: 1949, xLcl: 1947, sUcl: 4, sLcl: 2,
        xViolates: false, sViolates: false, nelson: [],
      },
    ];

    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': violating,
    });

    const { container, findByRole } = render(<WeightScreen {...baseProps()} />);
    await findByRole('heading', { level: 1 });
    await waitFor(() => expect(container.querySelectorAll('svg.chart path').length).toBeGreaterThan(0));

    // The dot mark: previously `p.nelson.length > 0 || p.xViolates` drew a
    // <circle fill="var(--acc-fill)">. With a genuinely violating subgroup in
    // the fixture, none should be drawn.
    const accentDots = Array.from(container.querySelectorAll('svg.chart circle')).filter(
      (c) => c.getAttribute('fill') === 'var(--acc-fill)',
    );
    expect(accentDots).toHaveLength(0);

    // The "Over this period" sentence must not assert the band's counts —
    // that was the same over-claim in words rather than a mark.
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toContain('control band');
    expect(bodyText).not.toContain('non-random pattern');
    // And nothing may say the process IS in control either — that would be
    // the same unsupported claim inverted.
    expect(bodyText).not.toMatch(/in control/i);
  });
});
