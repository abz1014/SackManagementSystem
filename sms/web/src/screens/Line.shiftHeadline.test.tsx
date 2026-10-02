/** C-138 (D-80): Line's headline names the shift or shift range, not the whole day. */
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

describe('Line headline - shift-bounded range periods', () => {
  it('a single-shift range says "2 Sep, evening shift", not the whole day', async () => {
    installFakeFetch(ROUTES);
    const p = resolvePeriod('range', anchor, undefined, {
      from: { date: '2026-09-02', shift: 'evening' }, to: { date: '2026-09-02', shift: 'evening' },
    });
    const { findByRole } = renderWithLive(<LineScreen {...props(p)} />);
    const h1 = await findByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('2 Sep, evening shift');
    expect(h1.textContent).not.toContain('Wednesday, 2 September 2026');
  });

  it('a partial multi-shift range names both shifts, not "1 Sept to 2 Sept 2026"', async () => {
    installFakeFetch(ROUTES);
    const p = resolvePeriod('range', anchor, undefined, {
      from: { date: '2026-09-01', shift: 'evening' }, to: { date: '2026-09-02', shift: 'morning' },
    });
    const { findByRole } = renderWithLive(<LineScreen {...props(p)} />);
    const h1 = await findByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('1 Sep evening shift – 2 Sep morning shift');
  });
});
