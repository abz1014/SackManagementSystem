/**
 * FRICTION AUDIT F6 (23 Sep 2026) — the cone-weight report's target tile.
 *
 * `coneWeight.ts` has published `target.omittedReason` and
 * `target.inForceIsLowerBound` since `71ac170`, and this tile rendered
 * neither: it printed `W.reports.targetNone` — "No product was in force at
 * the end of this period" — for BOTH reasons a target can be absent, and it
 * printed "in force since <date>" for an instant that is only ever a lower
 * bound on the data this system holds.
 *
 * The distinction is not academic on real data. Over epoch 9 (2026-08-05 to
 * 08-20) a product WAS in force on the line (id 12, 201-IH0-SD); every one
 * of the fourteen `sms.product_limit_version` rows is a migration-027
 * bootstrap stamped 2026-09-11 with `effective_is_lower_bound = 1`, so what
 * is missing is the TOLERANCE, not the product. The old sentence told a
 * manager the opposite of the truth about the one case the fix exists for.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { ConeWeightSection } from './ConeWeight';
import type { ConeWeightReportData } from '../../api';

/** The resolver's real sentence, as `reports/common.ts` composes it for 5–20 Aug. */
const REASON =
  'No target is stated: the earliest limits this system holds for that product were first recorded on ' +
  '2026-09-11, after this period ended on 2026-08-20. What was actually in force during the period is not ' +
  'recorded anywhere, and a reading is judged by the limits in force at its own time — never by a later record ' +
  'applied backwards.';

function fixture(target: Partial<ConeWeightReportData['target']> & Record<string, unknown>): ConeWeightReportData {
  return {
    period: { period: 'custom', from: '2026-08-05', to: '2026-08-20' },
    basis: 'as_recorded',
    cones: 77488,
    weighed: 77488,
    implausible: 12,
    meanG: 1958.2,
    medianG: 1958,
    medianSource: 'weights_service',
    sdG: 8.4,
    minG: 1901,
    maxG: 2005,
    states: null,
    bucketSizeG: 5,
    histogram: [],
    target: {
      setpointG: null,
      productId: 12,
      label: null,
      inForceAtUtc: null,
      limitsChangedInPeriod: 0,
      source: 'none',
      ...target,
    } as ConeWeightReportData['target'],
    byStation: [],
    lineMeanG: 1958.2,
    plausibility: { loG: 1500, hiG: 2100 },
    note: 'note',
  } as unknown as ConeWeightReportData;
}

describe('ConeWeightSection — the target tile states the RIGHT reason for a missing target', () => {
  it('prints the resolver\'s own sentence, not "no product was in force", when limits postdate the period', () => {
    const { container } = render(
      <ConeWeightSection d={fixture({ source: 'none', omittedReason: REASON })} names={[]} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('the earliest limits this system holds');
    expect(text).toContain('2026-08-20');
    // The false sentence must be gone, not merely joined by the true one.
    expect(text).not.toContain('No product was in force');
  });

  it('keeps the no-product sentence for the genuine no-product case', () => {
    // Epoch 1 (22 Jun – 10 Jul) is this case on real data: productId is null,
    // so there is nothing to explain beyond the absence of a product.
    const { container } = render(
      <ConeWeightSection d={fixture({ source: 'none', productId: null, omittedReason: null })} names={[]} />,
    );
    expect(container.textContent).toContain('No product was in force');
  });

  it('a lower-bound instant is printed as "no later than", never as "in force since"', () => {
    const { container } = render(
      <ConeWeightSection
        d={fixture({
          source: 'in_force_at_period_end',
          setpointG: 1960,
          label: '201-IH0-SD',
          inForceAtUtc: '2026-09-11T10:03:15.957Z',
          inForceIsLowerBound: true,
        })}
        names={[]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('no later than');
    expect(text).not.toContain('in force since');
  });

  it('a version with a genuine start date still says "in force since"', () => {
    const { container } = render(
      <ConeWeightSection
        d={fixture({
          source: 'in_force_at_period_end',
          setpointG: 1960,
          label: '201-IH0-SD',
          inForceAtUtc: '2026-08-01T00:00:00.000Z',
          inForceIsLowerBound: false,
        })}
        names={[]}
      />,
    );
    expect(container.textContent).toContain('in force since');
  });
});
