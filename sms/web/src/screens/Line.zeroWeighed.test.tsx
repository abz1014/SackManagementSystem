/** C-155 (D-96): Line must not print "0% of everything weighed" when nothing was weighed. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import { resolvePeriod, type PeriodAnchor } from '../lib/period';
import { LineScreen } from './Line';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const anchor: PeriodAnchor = {
  shiftDate: '2026-09-07', shiftCode: 'evening', shiftStartUtc: '2026-09-07T14:00:00.000Z',
  plantNowUtc: '2026-09-07T17:00:00.000Z', dataAsOfUtc: '2026-09-07T16:50:00.000Z', firstDay: '2026-06-22',
};

const ROUTES = {
  '/api/live': LIVE_FIXTURE,
  '/api/stations': { stations: [] },
  '/api/product-at': { product: null, limits: null, neverRecorded: true },
  '/api/products': { products: [] },
  '/api/attention': {
    data: {
      window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
      period: { from: '2026-09-02', to: '2026-09-02', shift: null },
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
  '/api/production': {
    data: {
      groupBy: 'none',
      rows: [{ group: 'total', cones: 1080, rejectedCones: 10, unmatchedRejects: 5, sacks: 40, sackWeightKg: 1100, conesInRangePct: 97, sacksPassedScalePct: 95 }],
      unattributed: null, states: null, implausible: null, dataIssues: [],
    },
    metadata: META_FIXTURE,
  },
};

const props = (period: ReturnType<typeof resolvePeriod>) => ({
  period, onNavigate: noop, onOpenStation: noop, onOpenReading: noop, onOpenProduct: noop, canWrite: false,
});

describe('Line - nothing weighed', () => {
  it('prints a dash, not 0%, for the reject rate when weighed is 0', async () => {
    installFakeFetch({
      ...ROUTES,
      '/api/production': {
        data: {
          groupBy: 'none',
          rows: [{ group: 'total', cones: 0, rejectedCones: 0, unmatchedRejects: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null }],
          unattributed: null, states: null, implausible: null, dataIssues: [],
        },
        metadata: META_FIXTURE,
      },
    });
    const p = resolvePeriod('shift', anchor);
    const { findByText, container } = renderWithLive(<LineScreen {...props(p)} />);
    await findByText(/of everything weighed/);
    expect(container.textContent).not.toContain('0% of everything weighed');
    expect(container.textContent).toContain('— of everything weighed');
  });
});
