/**
 * Re-audit fix (29 Sep 2026): Sacks.tsx's own `periodLabel` used to format
 * only the dates, so a period whose `key` is 'shift' ("This shift") and one
 * whose `key` is 'today' — both same-day `from === to` — printed the exact
 * same headline sentence, with no word naming the shift. Mirrors Line.tsx's
 * own headline branch (`W.state.shiftOf`/`describePeriod` — see
 * `lib/period.ts`): when the period IS exactly one shift (`period.shift`
 * set), the headline now names it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import type { SackSummaryData } from '../api';
import { SacksScreen } from './Sacks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SHIFT_PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: true, days: 1,
} as unknown as Period;

const TODAY_PERIOD: Period = {
  key: 'today', from: '2026-09-07', to: '2026-09-07', tsTo: '2026-09-07T17:00:00Z',
  live: true, days: 1,
} as unknown as Period;

function noop(): void {}
function baseProps(period: Period) {
  return {
    period, unit: 'sacks' as const, onUnitChange: noop, page: 1, onPageChange: noop,
    canRecord: false, onOpenReading: noop, onOpenDay: noop,
  };
}

function summaryWithZeroSacks(): SackSummaryData {
  const zeroGroup = { sacks: 0, kg: 0, avgKg: null, inRangePct: null, inRange: 0, noFlag: 0, implausible: 0 };
  return {
    from: '2026-09-07', to: '2026-09-07', shift: null, product: null,
    totals: { ...zeroGroup, cones: 0, conesPerSack: null },
    byShift: [], byProduct: [],
    unattributed: { rows: 0, of: 0 },
    weightBasis: 'gross', tareKg: 0, plausibility: { loKg: 40, hiKg: 60 },
    sackTimeIsInsertTime: true, conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: 'not available' },
  };
}

function routes() {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/sacks/summary': { data: summaryWithZeroSacks(), metadata: {} },
    '/api/reports/sack': () => new Promise(() => {}), // never resolves; not needed for the headline
    '/api/products': { products: [] },
  };
}

describe('Sacks headline — names the shift, not just the date (re-audit fix, 29 Sep 2026)', () => {
  it('a shift period ("This shift") states the shift by name, distinct from a same-day non-shift period', async () => {
    installFakeFetch(routes());
    const { findByText } = renderWithLive(<SacksScreen {...baseProps(SHIFT_PERIOD)} />);

    await findByText(W.sacks.headlineNone('7 Sep, evening shift'));
  });

  it('a same-day non-shift period ("Today") keeps the plain date, no shift word', async () => {
    installFakeFetch(routes());
    const { findByText, queryByText } = renderWithLive(<SacksScreen {...baseProps(TODAY_PERIOD)} />);

    await waitFor(async () => {
      expect(await findByText(/no sacks weighed/)).toBeTruthy();
    });
    expect(queryByText(/evening shift/)).toBeNull();
  });
});
