/** C-015 (D-79): Rejects' headline discloses a generation the period excluded. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { RejectSpcData } from '../api';
import { RejectsScreen } from './Rejects';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: true, days: 1,
};

const RANGE_OK = { minDate: '2026-08-24', maxDate: '2026-09-07' };
const STATIONS_OK = { stations: [] };

function generations(totalInspected: number) {
  return [{ generation: 2, totalProduced: totalInspected - 40, totalRejects: 40, totalInspected, pBar: 0.02, firstBucketTs: '2026-08-24T00:00:00Z', lastBucketTs: '2026-09-07T17:00:00Z' }];
}

function spcFixture(rejectType: 'quality' | 'weight', totalRejects: number, totalProduced: number): RejectSpcData {
  return {
    bucketSize: 'day', rejectTypeFilter: rejectType, totalProduced, totalRejects,
    pBar: totalProduced > 0 ? totalRejects / totalProduced : null,
    spansGenerations: false,
    generations: generations(totalProduced + totalRejects),
    outOfControlCount: 0, buckets: [], episodes: [],
  };
}

function routes(quality: RejectSpcData, weight: RejectSpcData) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': RANGE_OK,
    '/api/stations': STATIONS_OK,
    '/api/products': { products: [] },
    '/api/reject-spc': (req: RouteRequest) => {
      const data = req.search.get('rejectType') === 'weight' ? weight : quality;
      return { data, metadata: META_FIXTURE };
    },
    '/api/rejects': { data: { total: 0, reasons: [], unattributed: null }, metadata: META_FIXTURE },
    '/api/rejects/by-day-code': { data: { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 1, total: 0, rows: [] }, metadata: META_FIXTURE },
  };
}

function props() {
  return {
    period: PERIOD,
    station: null, onStationChange: noop,
    product: null, onProductChange: noop,
    code: null, onCodeChange: noop,
    onSeeCones: noop, onSeeStations: noop, onOpenReason: noop,
    canName: false,
  };
}


describe('Rejects - generation disclosure under the headline', () => {
  it('payload spans generations: the sentence is present', async () => {
    const q = { ...spcFixture('quality', 25, 12_000), spansGenerations: true };
    installFakeFetch(routes(q, spcFixture('weight', 10, 12_000)));
    const { findByRole } = renderWithLive(<RejectsScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.parentElement!.textContent).toMatch(/different data batch/));
  });

  it('payload does not span: the sentence is absent', async () => {
    installFakeFetch(routes(spcFixture('quality', 25, 12_000), spcFixture('weight', 10, 12_000)));
    const { container, findByRole } = renderWithLive(<RejectsScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain('rejected'));
    expect(container.textContent).not.toMatch(/different data batch/);
  });
});
