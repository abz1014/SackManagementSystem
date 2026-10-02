/** C-138 (D-80): Sacks headline names a shift RANGE, not whole days. */
import { afterEach, describe, it, vi } from 'vitest';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { resolvePeriod, type PeriodAnchor } from '../lib/period';
import type { SackSummaryData } from '../api';
import { SacksScreen } from './Sacks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const anchor: PeriodAnchor = {
  shiftDate: '2026-09-07', shiftCode: 'evening', shiftStartUtc: '2026-09-07T14:00:00.000Z',
  plantNowUtc: '2026-09-07T17:00:00.000Z', dataAsOfUtc: '2026-09-07T16:50:00.000Z', firstDay: '2026-06-22',
};

function noop(): void {}
function baseProps(period: ReturnType<typeof resolvePeriod>) {
  return {
    period, unit: 'sacks' as const, onUnitChange: noop, page: 1, onPageChange: noop,
    canRecord: false, onOpenReading: noop, onOpenDay: noop,
  };
}

function summaryWithZeroSacks(): SackSummaryData {
  const zeroGroup = { sacks: 0, kg: 0, avgKg: null, inRangePct: null, inRange: 0, noFlag: 0, implausible: 0 };
  return {
    from: '2026-09-01', to: '2026-09-02', shift: null, product: null,
    totals: { ...zeroGroup, cones: 0, conesPerSack: null },
    byShift: [], byProduct: [],
    unattributed: { rows: 0, of: 0 },
    weightBasis: 'gross', tareKg: 0, plausibility: { loKg: 40, hiKg: 60 },
    sackTimeIsInsertTime: true, conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: 'not available' },
  };
}

const routes = () => ({
  '/api/live': LIVE_FIXTURE,
  '/api/sacks/summary': { data: summaryWithZeroSacks(), metadata: {} },
  '/api/reports/sack': () => new Promise(() => {}),
  '/api/products': { products: [] },
});

describe('Sacks headline - a shift range names its shifts', () => {
  it('one shift on a range period: "2 Sep, evening shift"', async () => {
    installFakeFetch(routes());
    const p = resolvePeriod('range', anchor, undefined, {
      from: { date: '2026-09-02', shift: 'evening' }, to: { date: '2026-09-02', shift: 'evening' },
    });
    const { findByText } = renderWithLive(<SacksScreen {...baseProps(p)} />);
    await findByText(W.sacks.headlineNone('2 Sep, evening shift'));
  });

  it('a partial multi-shift range: "1 Sep evening shift - 2 Sep morning shift"', async () => {
    installFakeFetch(routes());
    const p = resolvePeriod('range', anchor, undefined, {
      from: { date: '2026-09-01', shift: 'evening' }, to: { date: '2026-09-02', shift: 'morning' },
    });
    const { findByText } = renderWithLive(<SacksScreen {...baseProps(p)} />);
    await findByText(W.sacks.headlineNone('1 Sep evening shift – 2 Sep morning shift'));
  });
});
