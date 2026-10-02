/**
 * C-170 (D-103, 2 Oct 2026): the Sacks stock ledger is kept per whole production
 * day (06:00 to 06:00); /api/sacks/stock takes no shift. Under a shift (or shift
 * range) headline it must therefore say it covers the whole day(s), and its
 * opening line must not claim to be "before this period" (the shift).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithLive } from './testkit/render';
import { installFakeFetch } from './testkit/fetchRouter';
import { LIVE_FIXTURE } from './testkit/fixtures';
import { W } from './lib/words';
import type { Period } from './lib/period';
import { SacksScreen } from './screens/Sacks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SHIFT_PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsFrom: '2026-09-07T22:00:00Z',
  tsTo: '2026-09-08T04:00:00Z', shift: 'night', live: false, days: 1,
};
const DAY_PERIOD: Period = { key: 'yesterday', from: '2026-09-07', to: '2026-09-07', tsTo: '2026-09-08T04:00:00Z', live: false, days: 1 };

const flow = (sacks: number) => ({ sacks, kg: sacks * 27 });
const zero = { sacks: 0, kg: 0 };
const LEDGER = {
  data: {
    from: '2026-09-07', to: '2026-09-07', product: null, basis: 'line', machineLevel: { enabled: false, reason: 'n/a' },
    dayBasis: 'production_day', sackTimeIsInsertTime: true, receiptMeaning: 'x', weightBasis: 'gross', tareKg: 0.6,
    opening: flow(0), closing: flow(148),
    totals: { openingEntries: zero, receipts: flow(148), weighed: flow(148), issues: zero, consumption: zero, adjustments: zero },
    days: [{
      day: '2026-09-07', opening: flow(0), openingEntries: zero, receipts: flow(148), weighed: flow(148), issues: zero,
      consumption: zero, adjustments: zero, closing: flow(148), movements: 0,
    }],
    byMaterial: [], kgMissing: 0,
  },
  metadata: LIVE_FIXTURE.metadata,
};
const SUMMARY = {
  data: {
    from: '2026-09-07', to: '2026-09-07', shift: 'night', product: null,
    totals: { sacks: 51, kg: 1377, avgKg: 27, inRangePct: 98, inRange: 50, noFlag: 0, implausible: 0, cones: 2550, conesPerSack: 50 },
    byShift: [], byProduct: [], unattributed: { rows: 0, of: 51 }, weightBasis: 'gross', tareKg: 0.6,
    plausibility: { loKg: 40, hiKg: 60 }, sackTimeIsInsertTime: true, conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: 'n/a' },
  },
  metadata: LIVE_FIXTURE.metadata,
};
const routes = () => ({
  '/api/live': LIVE_FIXTURE,
  '/api/sacks/summary': SUMMARY,
  '/api/sacks/stock': LEDGER,
  '/api/reports/sack': { data: { report: { byDay: [], totals: { avgSackKg: null } } }, metadata: LIVE_FIXTURE.metadata },
  '/api/products': { products: [] },
  '/api/events': { data: { rows: [], total: 0, page: 1, pageSize: 25 }, metadata: LIVE_FIXTURE.metadata },
});
function props(period: Period) {
  const noop = (): void => {};
  return { period, unit: 'sacks' as const, onUnitChange: noop, page: 1, onPageChange: noop, canRecord: false, onOpenReading: noop, onOpenDay: noop };
}

describe('Sacks ledger under a shift period', () => {
  it('states the ledger covers the whole production day(s) and relabels the opening line', async () => {
    installFakeFetch(routes());
    const { container } = renderWithLive(<SacksScreen {...props(SHIFT_PERIOD)} />);
    await waitFor(() => expect(container.textContent ?? '').toContain('148'));
    const text = container.textContent ?? '';
    expect(text).toContain(W.sacks.ledgerWholeDays);
    expect(text).not.toContain(W.sacks.openingBefore('0 sacks'));
  });

  it('a whole-day period carries no such disclosure and keeps the original opening line', async () => {
    installFakeFetch(routes());
    const { container } = renderWithLive(<SacksScreen {...props(DAY_PERIOD)} />);
    await waitFor(() => expect(container.textContent ?? '').toContain('148'));
    const text = container.textContent ?? '';
    expect(text).not.toContain(W.sacks.ledgerWholeDays);
    expect(text).toContain(W.sacks.openingBefore('0 sacks'));
  });
});
