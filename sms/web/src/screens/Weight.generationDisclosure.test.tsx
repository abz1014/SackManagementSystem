/** C-015 (D-79): Weight's headline discloses a generation the period excluded. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { render } from '../testkit/render';
import { META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { Envelope, SpcData, WeightStationsData, ProductionData } from '../api';
import { WeightScreen } from './Weight';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'pick', from: '2026-07-01', to: '2026-08-20',
  tsTo: '2026-09-07T17:00:00Z', live: true, days: 51,
};

function noop(): void {}

function baseProps() {
  return {
    period: PERIOD, mode: 'time' as const, onModeChange: noop, chartType: 'cone' as const,
    onChartTypeChange: noop, chartStation: null, onChartStationChange: noop,
    onOpenStation: noop, onSeeOutside: noop,
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
      // One source generation, and a valid X̄ band — see api.ts's merged
      // SpcData block (23 Sep 2026). Tests that need the other cases override
      // these two fields on the fixture they build.
      generation: null,
      otherGenerationExcluded: 0,
      spansGenerations: false,
      xLimits: { valid: true, mrBar: 2.5, sigmaBetween: 2.2, halfWidth: 6.6, pairs: 400 },
    },
    metadata: META_FIXTURE,
  };
}


function routes(spans: boolean) {
  const spc = spcFixture(500, 1948);
  spc.data.spansGenerations = spans;
  spc.data.otherGenerationExcluded = spans ? 65_000 : 0;
  return {
    '/api/weight-stations': WEIGHT_STATIONS_OK,
    '/api/stations': STATIONS_OK,
    '/api/production': PRODUCTION_OK,
    '/api/spc': spc,
  };
}

describe('Weight - generation disclosure under the headline', () => {
  it('payload spans generations: the sentence is present', async () => {
    installFakeFetch(routes(true));
    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.parentElement!.textContent).toMatch(/different data batch/));
  });

  it('payload does not span: the sentence is absent', async () => {
    installFakeFetch(routes(false));
    const { container, findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain('Average recorded weight'));
    expect(container.textContent).not.toMatch(/different data batch/);
  });
});
