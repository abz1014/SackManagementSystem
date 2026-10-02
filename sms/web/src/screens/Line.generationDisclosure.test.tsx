/** C-015 (D-79): Line's headline discloses a generation the period excluded. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { Envelope, ProductionData } from '../api';
import { LineScreen } from './Line';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const PERIOD: Period = {
  key: 'pick', from: '2026-07-01', to: '2026-08-20',
  tsTo: '2026-09-07T23:59:59.000Z', live: true, days: 51,
};

const BASE = {
  '/api/live': LIVE_FIXTURE,
  '/api/stations': { stations: [] },
  '/api/product-at': { product: null, limits: null, neverRecorded: true },
  '/api/products': { products: [] },
  '/api/attention': {
    data: {
      window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
      period: { from: '2026-07-01', to: '2026-08-20', shift: null },
      findings: [], totalFindings: 0, thresholds: { driftG: 15, minDaysHeld: 3 },
    },
    metadata: META_FIXTURE,
  },
  '/api/machines/running': {
    data: {
      asOfUtc: '2026-09-07T16:40:00Z', windowMs: 7_200_000, windowStartUtc: '2026-09-07T14:40:00Z',
      machines: [], materialsRunning: 0, generation: LIVE_FIXTURE.data.lines[0]!.generation,
    },
    metadata: META_FIXTURE,
  },
};

function production(spans: boolean): Envelope<ProductionData> {
  return {
    data: {
      groupBy: 'none',
      rows: [{ group: 'total', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 }],
      unattributed: null, states: null, implausible: null, dataIssues: [],
      generationNote: { generation: null, spansGenerations: spans, otherGenerationExcluded: spans ? 65_000 : 0 },
    },
    metadata: META_FIXTURE,
  };
}

const props = () => ({
  period: PERIOD, onNavigate: noop, onOpenStation: noop, onOpenReading: noop,
  onOpenProduct: noop, canWrite: false,
});

describe('Line — generation disclosure under the headline', () => {
  it('payload spans generations: the sentence is present', async () => {
    installFakeFetch({ ...BASE, '/api/production': production(true) });
    const { findByRole } = renderWithLive(<LineScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.parentElement!.textContent).toMatch(/different data batch/));
  });

  it('payload does not span: the sentence is absent', async () => {
    installFakeFetch({ ...BASE, '/api/production': production(false) });
    const { container, findAllByText } = renderWithLive(<LineScreen {...props()} />);
    await findAllByText(/Figures below cover/);
    await waitFor(() => expect(container.querySelectorAll('.fig-val').length).toBeGreaterThan(0));
    expect(container.textContent).not.toMatch(/different data batch/);
  });
});
