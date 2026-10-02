/**
 * C-049 / D-88 (2 Oct 2026): over a period with no readings the headline
 * correctly said "No cones were weighed in this period." while "Show the
 * working" printed "Over this period: 0 cones, mean 0 g, standard deviation
 * 0.00 g ... overall and 0.00 g within" — a mean and spreads that do not
 * exist. At n = 0 the working paragraph is not drawn at all.
 *
 * Two payload shapes are covered: the old one (zeros standing in for the
 * missing numbers) and the new one (null at n = 0, spc.ts).
 */
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
  key: 'shift', from: '2026-07-20', to: '2026-07-25', tsFrom: '2026-07-20T00:00:00Z', tsTo: '2026-07-25T23:59:59Z',
  shift: null, live: false, days: 6,
} as unknown as Period;

function noop(): void {}
const props = () => ({
  period: PERIOD, mode: 'time' as const, onModeChange: noop, chartType: 'cone' as const, onChartTypeChange: noop,
  chartStation: null, onChartStationChange: noop, onOpenStation: noop, onSeeOutside: noop,
});

const PRODUCTION: Envelope<ProductionData> = {
  data: { groupBy: 'none', rows: [], states: null, implausible: 0, unattributed: null },
  metadata: META_FIXTURE,
};

const STATIONS: Envelope<WeightStationsData> = {
  data: {
    from: '2026-07-12', to: '2026-07-25', days: 14, lineMeanG: null, targetG: null, productId: null, productLabel: null,
    thresholdG: 5, minDaysHeld: 3, lineRejectRatePct: null, stations: [],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 0, unjudged: 0 }, limits: null, rules: [],
    targetEffectiveFromUtc: null, limitsChangedInWindow: null, productChangesInWindow: 0,
  },
  metadata: META_FIXTURE,
} as unknown as Envelope<WeightStationsData>;

function emptySpc(numbers: 'zeros' | 'nulls'): Envelope<SpcData> {
  const z = numbers === 'zeros' ? 0 : null;
  return {
    data: {
      specAgreement: null, type: 'cone', unit: 'g', station: null, implausible: 0, count: 0,
      mean: z, median: null, stdevOverall: z, stdevWithin: z, bucketMinutes: 1440, bucketLabel: 'daily',
      grandMean: z, sChartCenter: z, xbarOutOfControl: 0, nelsonFlagged: 0, subgroups: [], stations: [],
      practicalThresholdG: 0, distinguishableStationCount: 0, flaggedStationCount: 0, histogram: [],
      spec: { usl: null, lsl: null, nominal: null, source: 'none' },
      capability: { cp: null, cpk: null, pp: null, ppk: null },
      generation: null, otherGenerationExcluded: 0, spansGenerations: false,
      xLimits: { valid: false, mrBar: 0, sigmaBetween: 0, halfWidth: 0, pairs: 0 },
    },
    metadata: META_FIXTURE,
  } as unknown as Envelope<SpcData>;
}

describe('Weight — "Show the working" over an empty period', () => {
  for (const numbers of ['zeros', 'nulls'] as const) {
    it(`n = 0 (${numbers}): the headline says nothing was weighed and no "mean 0 g" working is printed`, async () => {
      installFakeFetch({
        '/api/weight-stations': STATIONS,
        '/api/stations': { stations: [] },
        '/api/production': PRODUCTION,
        '/api/spc': emptySpc(numbers),
      });
      const { container, findByRole } = render(<WeightScreen {...props()} />);
      const h1 = await findByRole('heading', { level: 1 });
      await waitFor(() => expect(h1.textContent).toBe('No cones were weighed in this period.'));
      expect(container.textContent).not.toContain('Over this period:');
      expect(container.textContent).not.toMatch(/mean 0\s*g/);
      expect(container.textContent).not.toContain('0.00 g');
    });
  }
});
