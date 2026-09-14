/**
 * ProductTimeline.verdict with row attribution and versioned limits (Sep 2026).
 *
 * Two things a verdict must now get right:
 *  - a reading that carries its OWN MaterialId is judged against THAT product,
 *    not the line-wide timeline (six materials run concurrently on different
 *    machines, so the timeline is the wrong question for such a reading);
 *  - the limits are the ones in force at the reading's own time.
 * And the old behaviour must survive untouched when neither is supplied.
 */
import { describe, expect, it } from 'vitest';
import { ProductTimeline, type ProductInForce } from './productAt.js';
import { ProductCatalogue, type LimitVersion } from './productLimits.js';

const T = (iso: string) => new Date(iso).getTime();

const lineProduct: ProductInForce = {
  productId: 20,
  label: '205-IL0-SD',
  setpointG: 1960,
  weightOffsetMinusG: 50,
  weightOffsetPlusG: 50,
  effectiveFromMs: T('2026-08-01T00:00:00Z'),
  effectiveFromUtc: '2026-08-01T00:00:00.000Z',
};
const timeline = new ProductTimeline([lineProduct]);

const ver = (productId: number, iso: string, setpointG: number, off = 50): LimitVersion => ({
  productId,
  setpointG,
  offsetMinusG: off,
  offsetPlusG: off,
  effectiveFromMs: T(iso),
  effectiveFromUtc: iso,
  effectiveIsLowerBound: false,
  source: 'pdas_observed',
});
const catalogue = new ProductCatalogue(
  [
    { productId: 20, label: '205-IL0-SD', activeFlag: true },
    { productId: 21, label: '205-IL0-SD Blue', activeFlag: true },
  ],
  [
    ver(20, '2026-08-01T00:00:00.000Z', 1960),
    ver(20, '2026-08-20T00:00:00.000Z', 1970), // a setpoint change mid-record
    ver(21, '2026-08-01T00:00:00.000Z', 1960, 30),
  ],
);

describe('verdict — legacy behaviour without a catalogue', () => {
  it('uses the timeline product and its mirrored limits', () => {
    const v = timeline.verdict('2026-08-10T12:00:00Z', 2015);
    expect(v.attribution).toBe('timeline');
    expect(v.limits).toMatchObject({ loG: 1910, hiG: 2010 });
    expect(v.outsideByG).toBe(5);
    expect(v.limitsAreLowerBound).toBe(false);
  });
});

describe('verdict — versioned limits', () => {
  it('judges the same weight differently before and after a setpoint change', () => {
    const before = timeline.verdict('2026-08-10T12:00:00Z', 2015, { catalogue });
    const after = timeline.verdict('2026-08-25T12:00:00Z', 2015, { catalogue });
    expect(before.outsideByG).toBe(5); // 1910–2010 in force
    expect(after.inside).toBe(true); // 1920–2020 in force
    expect(before.attribution).toBe('timeline');
  });
});

describe('verdict — the reading carries its own product', () => {
  it('uses the row product, not the timeline, and says so', () => {
    // Product 21 is ±30: 2005 is outside for it, inside for the line's ±50 product.
    const v = timeline.verdict('2026-08-10T12:00:00Z', 2005, { catalogue, productId: 21 });
    expect(v.attribution).toBe('row');
    expect(v.product?.productId).toBe(21);
    expect(v.limits).toMatchObject({ loG: 1930, hiG: 1990 });
    expect(v.outsideByG).toBe(15);
  });

  it('flags limits as a lower bound when the reading predates every known version', () => {
    const v = timeline.verdict('2026-07-01T12:00:00Z', 1960, { catalogue, productId: 21 });
    expect(v.attribution).toBe('row');
    expect(v.limitsAreLowerBound).toBe(true);
  });

  it('falls back to the timeline when the row product is unknown to the catalogue', () => {
    const v = timeline.verdict('2026-08-10T12:00:00Z', 1960, { catalogue, productId: 999 });
    expect(v.attribution).toBe('timeline');
    expect(v.product?.productId).toBe(20);
  });
});
