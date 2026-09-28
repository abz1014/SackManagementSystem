/**
 * Rejects — the headline reject RATE must divide by the same generation its
 * numerator counts, not by every generation the query happened to touch.
 *
 * FIX 1, 28 Sep 2026 (follow-up to WS-B1, 23 Sep 2026 — see Rejects.tsx's own
 * comment above `preferredGeneration`). `rejectSpc.ts` scopes
 * `totalRejects`/`totalProduced` to ONE preferred generation (real over
 * simulator, then newest ordinal) but still returns EVERY generation the
 * query touched in `generations[]`. The old code summed `totalInspected`
 * across every one of those entries; when a period spans more than one
 * generation, that pools a much larger, unrelated population into a rate
 * whose numerator counts only one — diluting the printed rate toward zero.
 * Measured on the dev copy, 1-28 Sep (a real September generation plus the
 * local `_SIM` sidecar generation both in range): the screen read 0.5% where
 * Line and the reports, both scoped to one generation, read 4.5%.
 *
 * This fixture reproduces that shape: two generations per series, a small
 * "real" one the top-level totals belong to, and a much larger second one
 * (station/period filters would exclude it at IFL, where generations never
 * overlap — this is exactly the dev-sidecar contamination the bug shape
 * needs). FAILS on the pre-fix code (sums both generations -> ~0.2%), PASSES
 * once the denominator is scoped to the one matching generation (-> 5.0%).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { RejectSpcData, RejectGeneration } from '../api';
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

// Generation A: the "real" one the top-level totals belong to. Generation B:
// a much larger, unrelated one (e.g. the local plant simulator's sidecar
// generation) that is in range but is NOT what the numerator counts.
const GEN_A_PRODUCED = 9000;
const GEN_A_UNMATCHED = 8;
const GEN_B_PRODUCED = 200_000;
const GEN_B_UNMATCHED = 50;

function generation(id: number, produced: number, rejects: number, unmatched: number): RejectGeneration {
  return {
    generation: id,
    totalProduced: produced,
    totalRejects: rejects,
    totalInspected: produced + unmatched,
    pBar: (produced + unmatched) > 0 ? rejects / (produced + unmatched) : null,
    firstBucketTs: '2026-08-24T00:00:00Z',
    lastBucketTs: '2026-09-07T17:00:00Z',
  };
}

/**
 * `qualityRejectsA`/`weightRejectsA` are what the NUMERATOR (top-level
 * totalRejects) counts — generation A only, matching rejectSpc.ts's own
 * `newestGenTotals` behaviour. Generation B carries its own (much smaller
 * relative) reject counts, present in `generations[]` but never reflected in
 * the top-level totals — exactly the shape `preferredGeneration` must pick
 * generation A out of.
 */
function spcFixture(rejectType: 'quality' | 'weight', rejectsA: number, rejectsB: number): RejectSpcData {
  return {
    bucketSize: 'day', rejectTypeFilter: rejectType,
    totalProduced: GEN_A_PRODUCED, totalRejects: rejectsA,
    pBar: rejectsA / (GEN_A_PRODUCED + GEN_A_UNMATCHED),
    spansGenerations: true,
    generations: [
      generation(1, GEN_A_PRODUCED, rejectsA, GEN_A_UNMATCHED),
      generation(2, GEN_B_PRODUCED, rejectsB, GEN_B_UNMATCHED),
    ],
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

describe('Rejects — headline rate divides by the SAME generation the numerator counts, across a two-generation payload', () => {
  it('numerator: 400 quality + 50 weight = 450 · denominator: generation A alone (9,008) -> 5.0%, never generation A+B pooled (~209,058 -> 0.2%)', async () => {
    const quality = spcFixture('quality', 400, 5);
    const weight = spcFixture('weight', 50, 2);
    installFakeFetch(routes(quality, weight));

    const { findByRole } = renderWithLive(<RejectsScreen {...props()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toContain('450 cones rejected'));
    // The correct, single-generation rate: 450 / (9000 + 8) = 4.9955...% -> "5.0%".
    expect(h1.textContent).toContain('5.0% of everything weighed');
    // The pre-fix defect's rate: 450 / (9008 + 200050) = 0.2152...% -> "0.2%".
    expect(h1.textContent).not.toContain('0.2% of everything weighed');
  });
});
