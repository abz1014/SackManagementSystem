/**
 * C-110 (D-89): a reject rate under 1 % prints two decimals so a non-zero rate
 * never reads "0.0%". 1 reject in 2,437 inspected is 0.041 %.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { RejectSpcData } from '../api';
import { RejectsScreen } from './Rejects';

afterEach(() => { vi.unstubAllGlobals(); });
function noop(): void {}

const PERIOD: Period = {
  key: 'shift', from: '2026-08-15', to: '2026-08-15',
  tsFrom: '2026-08-15T09:00:00Z', tsTo: '2026-08-15T17:00:00Z',
  shift: 'evening', live: true, days: 1,
};

function spc(rejectType: 'quality' | 'weight', rejects: number): RejectSpcData {
  return {
    bucketSize: 'day', rejectTypeFilter: rejectType,
    totalProduced: 2436, totalRejects: rejects,
    pBar: rejects / 2437, spansGenerations: false,
    generations: [{
      generation: 1, totalProduced: 2436, totalRejects: rejects, totalInspected: 2437,
      pBar: rejects / 2437, firstBucketTs: '2026-08-15T00:00:00Z', lastBucketTs: '2026-08-15T17:00:00Z',
    }],
    outOfControlCount: 0, buckets: [], episodes: [],
  };
}

describe('Rejects — a sub-1 % rate keeps its second decimal', () => {
  it('0.041 % prints as 0.04%, never 0.0%', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07' },
      '/api/stations': { stations: [] },
      '/api/products': { products: [] },
      '/api/reject-spc': (req: RouteRequest) => ({ data: req.search.get('rejectType') === 'weight' ? spc('weight', 1) : spc('quality', 0), metadata: META_FIXTURE }),
      '/api/rejects': { data: { total: 0, reasons: [], unattributed: null }, metadata: META_FIXTURE },
      '/api/rejects/by-day-code': { data: { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 1, total: 0, rows: [] }, metadata: META_FIXTURE },
    });
    const { findByRole } = renderWithLive(
      <RejectsScreen period={PERIOD} station={null} onStationChange={noop} product={null} onProductChange={noop}
        code={null} onCodeChange={noop} onSeeCones={noop} onSeeStations={noop} onOpenReason={noop} canName={false} />,
    );
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain('1 cone'));
    expect(h1.textContent).toContain('0.04% of everything weighed');
    expect(h1.textContent).not.toContain('0.0% of everything weighed');
  });
});
