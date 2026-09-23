/**
 * THE "ONE REASON FITS ALL" FOOTNOTE — friction audit follow-up, 23 Sep 2026.
 *
 * `SummarySection` printed a page-level note explaining why some KPIs read
 * "not comparable", and it took that explanation from the FIRST incomparable
 * row: `d.kpis.find((k) => !k.comparable)?.incomparableReason`. That was
 * sound while only one kind of reason existed — it is derived from the two
 * periods' coverage, not from the individual KPI, so every blocked row really
 * did carry the same sentence.
 *
 * `71ac170` ended that. It added a SECOND, independent comparability test:
 * `attributionSensitive` KPIs are withheld when product attribution covers
 * materially different shares of the two periods (0.0 % prior against 100.0 %
 * current, on the real 5 Aug – 7 Sep window — the reason "Within product
 * limits" was reporting a +2,117.8 % "improvement"). A row can now be blocked
 * by coverage, by attribution, or by both, and `summary.ts` composes the
 * three differently.
 *
 * The per-row data stayed exact throughout; only the summarisation was wrong.
 * With both kinds present, `find` returned whichever came first in the KPI
 * list — the coverage reason, because `shape: 'total'` KPIs are declared
 * ahead of `cones_within_limits_pct` — and the attribution reason survived
 * only as a `title` tooltip on a different row. On a page whose whole purpose
 * is to be printed and sent to the GM, a tooltip is not a place a reason can
 * live.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { SummarySection } from './Summary';
import { W } from '../../lib/words';
import type { KpiRow, ManagementSummaryData, ProductOption } from '../../api';

const COVERAGE_REASON =
  'Prior period covers 19 of 34 days with readings, versus 34 of 34 for the current period — comparing the ' +
  'totals would measure that coverage gap, not a change in production.';
const ATTRIBUTION_REASON =
  "Not comparable: product attribution covers 0.0% of the prior period's cone readings against 100.0% of this " +
  "period's.";

function kpi(key: string, reason: string | null): KpiRow {
  return {
    key,
    label: key,
    unit: key === 'cones_within_limits_pct' ? '%' : 'cones',
    betterWhen: 'higher',
    definition: 'x',
    current: 100,
    prior: 50,
    delta: { abs: 50, pct: 100 },
    comparable: reason == null,
    incomparableReason: reason,
    approval: 'awaiting',
  };
}

const COVERAGE = { daysInPeriod: 34, daysWithData: 34, firstDay: '2026-08-05', lastDay: '2026-09-07' };

function fixture(kpis: KpiRow[]): ManagementSummaryData {
  return {
    period: { period: 'custom', from: '2026-08-05', to: '2026-09-07', days: 34 },
    prior: { from: '2026-07-02', to: '2026-08-04' },
    coverage: { current: COVERAGE, prior: { ...COVERAGE, daysWithData: 19 } },
    kpis,
    productMix: { current: [], prior: [] },
    verdict: { cones: 132552, sacks: 5435, sackWeightKg: 260000 },
    approval: 'awaiting',
    note: 'note',
  } as unknown as ManagementSummaryData;
}

const PRODUCTS: ProductOption[] = [];

const bodyOf = (d: ManagementSummaryData) =>
  render(<SummarySection d={d} products={PRODUCTS} />).container.textContent ?? '';

describe('the management summary’s “not comparable” footnote', () => {
  it('states BOTH reasons when two kinds are present — the defect case', () => {
    // Declaration order matters and is the defect's mechanism: the coverage
    // row comes first, so `find` used to stop there and the attribution
    // reason never reached the page.
    const body = bodyOf(fixture([
      kpi('cones', COVERAGE_REASON),
      kpi('cones_within_limits_pct', ATTRIBUTION_REASON),
    ]));
    expect(body).toContain(W.reports.incomparableNote);
    expect(body).toContain(COVERAGE_REASON);
    expect(body).toContain(ATTRIBUTION_REASON);
  });

  it('a single reason still reads exactly as it always did', () => {
    const body = bodyOf(fixture([kpi('cones', COVERAGE_REASON), kpi('sacks', null)]));
    expect(body).toContain(`${W.reports.incomparableNote} ${COVERAGE_REASON}`);
  });

  it('several rows blocked for the SAME reason print it once, not once per row', () => {
    const body = bodyOf(fixture([
      kpi('cones', COVERAGE_REASON),
      kpi('sacks', COVERAGE_REASON),
      kpi('kg', COVERAGE_REASON),
    ]));
    expect(body.split(COVERAGE_REASON)).toHaveLength(2); // one occurrence
  });

  it('no incomparable row prints no footnote at all', () => {
    const body = bodyOf(fixture([kpi('cones', null), kpi('sacks', null)]));
    expect(body).not.toContain(W.reports.incomparableNote);
  });

  it('a row blocked by BOTH tests (summary.ts joins the two sentences) is printed whole', () => {
    const joined = `${ATTRIBUTION_REASON} ${COVERAGE_REASON}`;
    const body = bodyOf(fixture([kpi('cones_within_limits_pct', joined)]));
    expect(body).toContain(joined);
  });
});
