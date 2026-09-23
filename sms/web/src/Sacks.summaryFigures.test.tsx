/**
 * UX Phase WS-B2 (23 Sep 2026) — `SummaryFigures` (screens/Sacks.tsx), the
 * period's own sack figures. The brief flagged this as an UNDIAGNOSED
 * failure mode: establish what actually happens before fixing it.
 *
 * WHAT WAS FOUND (reproduced below, first as a RED test): `fmtInt`/`fmtKg`
 * (`lib/fmt.ts`) guard `n == null`, which catches `null` AND `undefined` —
 * so a field simply MISSING from the row (RT-005: present envelope, deleted
 * key) renders as an honest "—", not a fabricated zero. `SummaryFigures`'s
 * own `t.sacks === 0` early-return is similarly safe: `undefined === 0` is
 * false, so a stripped `sacks` field does not trip the "no sacks weighed"
 * empty state either.
 *
 * The actual hole is arithmetic done BEFORE formatting:
 * `fmtInt(Math.round(t.kg))`. `t.kg` stripped is `undefined`;
 * `Math.round(undefined)` is `NaN`; and `NaN == null` is `false` — `fmtInt`
 * does NOT catch it, because a `NaN` is not the same absence as a `null`.
 * The result is the literal string "NaN" printed on screen as a sack
 * weight, on a report a manager may read or print. Not a throw, not a `0`:
 * a silently plausible-looking three-letter word sitting where a number
 * belongs. Same shape independently in the in-range note's
 * `t.sacks - t.noFlag` (also NaN-producing arithmetic on a stripped field,
 * formatted by `fmtInt` which cannot see the difference).
 */
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithLive } from './testkit/render';
import { installFakeFetch } from './testkit/fetchRouter';
import { LIVE_FIXTURE, stripFields } from './testkit/fixtures';
import type { Envelope, SackSummaryData } from './api';
import type { Period } from './lib/period';
import { SacksScreen } from './screens/Sacks';

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

function noop(): void {}

function baseProps() {
  return {
    period: PERIOD,
    unit: 'sacks' as const,
    onUnitChange: noop,
    page: 1,
    onPageChange: noop,
    canRecord: false,
    onOpenReading: noop,
    onOpenDay: noop,
  };
}

const SUMMARY_ROW: SackSummaryData['totals'] = {
  sacks: 96,
  kg: 2649.6,
  avgKg: 27.6,
  inRangePct: 94.1,
  inRange: 90,
  noFlag: 2,
  implausible: 0,
  cones: 4820,
  conesPerSack: 50,
};

function summaryEnvelope(totals: SackSummaryData['totals']): Envelope<SackSummaryData> {
  return {
    data: {
      from: PERIOD.from,
      to: PERIOD.to,
      shift: PERIOD.shift ?? null,
      product: null,
      totals,
      byShift: [],
      byProduct: [],
      unattributed: { rows: 0, of: 96 },
      weightBasis: 'gross',
      tareKg: 0.6,
      plausibility: { loKg: 40, hiKg: 60 },
      sackTimeIsInsertTime: true,
      conesPerSackApproximate: true,
      machineLevel: { enabled: false, reason: 'no machine column on sack1_TP1U2' },
    },
    metadata: LIVE_FIXTURE.metadata,
  };
}

const LEDGER_EMPTY = {
  data: {
    from: PERIOD.from, to: PERIOD.to, product: null, basis: 'line', machineLevel: { enabled: false, reason: 'n/a' },
    dayBasis: 'production_day', sackTimeIsInsertTime: true, receiptMeaning: 'x', weightBasis: 'gross', tareKg: 0.6,
    opening: { sacks: 0, kg: 0 }, closing: { sacks: 0, kg: 0 },
    totals: { openingEntries: { sacks: 0, kg: 0 }, receipts: { sacks: 0, kg: 0 }, weighed: { sacks: 0, kg: 0 }, issues: { sacks: 0, kg: 0 }, consumption: { sacks: 0, kg: 0 }, adjustments: { sacks: 0, kg: 0 } },
    days: [], byMaterial: [], kgMissing: 0,
  },
  metadata: LIVE_FIXTURE.metadata,
};

function routes(totals: SackSummaryData['totals']) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/sacks/summary': summaryEnvelope(totals),
    '/api/sacks/stock': LEDGER_EMPTY,
    '/api/reports/sack': { data: { report: { byDay: [], totals: { avgSackKg: null } } }, metadata: LIVE_FIXTURE.metadata },
    '/api/products': { products: [] },
    '/api/events': { data: { rows: [], total: 0, page: 1, pageSize: 25 }, metadata: LIVE_FIXTURE.metadata },
  };
}

describe('Sacks — SummaryFigures with a field stripped from an otherwise real row', () => {
  it('`kg` deleted: must never print the literal string "NaN" (established failure mode: `Math.round(undefined)` -> `NaN`, and `NaN == null` is false so `fmtInt` does not catch it)', async () => {
    const totals = stripFields(SUMMARY_ROW, ['kg']);
    installFakeFetch(routes(totals));
    const { container } = renderWithLive(<SacksScreen {...baseProps()} />);

    await waitFor(() => expect(container.textContent ?? '').toContain('94.1%'));
    expect(container.textContent ?? '').not.toContain('NaN');
  });

  it('`sacks` deleted, `noFlag` present: the in-range note`s `t.sacks - t.noFlag` must never print "NaN" either', async () => {
    const totals = stripFields(SUMMARY_ROW, ['sacks']);
    installFakeFetch(routes(totals));
    const { container } = renderWithLive(<SacksScreen {...baseProps()} />);
    await waitFor(() => expect(container.textContent ?? '').toContain('94.1%'));
    expect(container.textContent ?? '').not.toContain('NaN');
  });
});
