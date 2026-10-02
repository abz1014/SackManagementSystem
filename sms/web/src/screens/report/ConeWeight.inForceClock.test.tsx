/**
 * C-119 (D-101, 2 Oct 2026): `target.inForceAtUtc` is the PLANT's wall clock
 * labelled `Z` (productLimits.ts converts a stored-UTC `effective_from` through
 * `toPlantMs`). The tile formatted it with `fmtAppInstant`, which converts a
 * genuine UTC instant into the viewer's zone, so a UTC+5 PC printed 15:24:59
 * for a limit PDAS stamped at 10:24:59 — five hours late.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { ConeWeightSection } from './ConeWeight';
import type { ConeWeightReportData } from '../../api';

function fixture(inForceIsLowerBound: boolean): ConeWeightReportData {
  return {
    period: { period: 'custom', from: '2026-08-18', to: '2026-08-20' },
    basis: 'as_recorded', cones: 100, weighed: 100, implausible: 0,
    meanG: 1958.2, medianG: 1958, medianSource: 'weights_service', sdG: 8.4, minG: 1901, maxG: 2005,
    states: null, bucketSizeG: 5, histogram: [],
    target: {
      setpointG: 1960, productId: 1022, label: '201-IH0-SD', inForceAtUtc: '2026-08-18T10:24:59.930Z',
      inForceIsLowerBound, limitsChangedInPeriod: 0, source: 'in_force_at_period_end', omittedReason: null, productActive: true, productsRan: [],
    },
    byStation: [], lineMeanG: 1958.2, plausibility: { loG: 1500, hiG: 2100 }, note: 'note',
  } as unknown as ConeWeightReportData;
}

describe('ConeWeightSection — the "in force" instant is on the plant clock', () => {
  let tz: string | undefined;
  beforeEach(() => { tz = process.env.TZ; process.env.TZ = 'Asia/Karachi'; });
  afterEach(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

  for (const lower of [false, true]) {
    it(`shows 10:24:59, not 15:24:59, on a UTC+5 PC (lower bound: ${lower})`, () => {
      const { container } = render(<ConeWeightSection d={fixture(lower)} names={[]} />);
      const text = container.textContent ?? '';
      expect(text).toContain('10:24:59');
      expect(text).not.toContain('15:24:59');
      expect(text).toContain('18 August 2026');
    });
  }
});
