/**
 * Rejects — the headline arithmetic guard (WS-CH, 23 Sep 2026 red-team
 * remediation, defect 2).
 *
 * `missingField.fuzz.test.tsx` (owned by a different worker) recorded this as
 * a KNOWN_DEFECT: `q.totalRejects + w.totalRejects` and the rate division ran
 * on a possibly-absent field BEFORE formatting. A stripped `totalRejects`
 * turned the sum into `NaN`, and `fmtInt`/`fmtPct1`'s `n == null` guard does
 * not catch `NaN` (`NaN == null` is `false`), so the literal word "NaN"
 * printed in the headline. This file is the two-sided regression test for
 * the fix: `finiteOrNull`, the same idiom `Sacks.tsx`'s WS-B2 fix already
 * uses, reused here rather than reinvented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, stripFields } from '../testkit/fixtures';
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

describe('Rejects — headline count/rate never prints "NaN" for a stripped totalRejects', () => {
  it('totalRejects KEY absent from the quality series, weight series real: headline reads "—", never "NaN"', async () => {
    const holedQuality = stripFields(spcFixture('quality', 25, 12_000), ['totalRejects']);
    const weightOk = spcFixture('weight', 10, 12_000);
    installFakeFetch(routes(holedQuality, weightOk));

    const { findByRole } = renderWithLive(<RejectsScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe('—'));
    expect(h1.textContent).not.toContain('NaN');
  });

  it('two-sided partner: both series genuinely report zero rejects (real 0, not stripped): headline reads the honest "0 cones rejected, 0.0% of everything weighed", never "—" and never "NaN"', async () => {
    const qualityZero = spcFixture('quality', 0, 12_000);
    const weightZero = spcFixture('weight', 0, 12_000);
    installFakeFetch(routes(qualityZero, weightZero));

    const { findByRole } = renderWithLive(<RejectsScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toContain('0 cones rejected'));
    expect(h1.textContent).not.toBe('—');
    expect(h1.textContent).not.toContain('NaN');
  });

  it('totalInspected KEY absent from one generation row (poisons the rate denominator): the rate falls back to "—" instead of a fabricated NaN%, never "NaN" anywhere in the headline', async () => {
    const holedQuality = spcFixture('quality', 25, 12_000);
    holedQuality.generations = [stripFields(holedQuality.generations[0]!, ['totalInspected'])];
    const weightOk = spcFixture('weight', 10, 12_000);
    installFakeFetch(routes(holedQuality, weightOk));

    const { findByRole } = renderWithLive(<RejectsScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).not.toContain('NaN'));
  });
});
