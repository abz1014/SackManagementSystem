import { describe, expect, it } from 'vitest';
import { ProductTimeline, limitsOf, type ProductInForce } from './productAt.js';

const at = (iso: string) => new Date(iso).getTime();

/** Production-time instants throughout: these are the plant's wall clock. */
const p = (over: Partial<ProductInForce> & { effectiveFromUtc: string }): ProductInForce => ({
  productId: 12,
  label: '201-IH0-SD',
  setpointG: 1960,
  weightOffsetMinusG: 40,
  weightOffsetPlusG: 40,
  effectiveFromMs: at(over.effectiveFromUtc),
  ...over,
});

describe('limitsOf', () => {
  it('builds a symmetric tolerance label', () => {
    expect(limitsOf(p({ effectiveFromUtc: '2026-09-02T12:03:58Z' }))).toEqual({
      targetG: 1960, loG: 1920, hiG: 2000, label: '1,960 ± 40 g',
    });
  });

  it('spells out an asymmetric tolerance rather than pretending it is ±', () => {
    const l = limitsOf(p({ effectiveFromUtc: '2026-09-02T12:03:58Z', weightOffsetMinusG: 30, weightOffsetPlusG: 50 }));
    expect(l).toMatchObject({ targetG: 1960, loG: 1930, hiG: 2010, label: '1,930 to 2,010 g' });
  });

  it('treats a negative offset as a magnitude, so limits never invert', () => {
    expect(limitsOf(p({ effectiveFromUtc: '2026-09-02T12:03:58Z', weightOffsetMinusG: -40 }))).toMatchObject({
      loG: 1920, hiG: 2000,
    });
  });

  it('refuses limits when there is no setpoint or no tolerance', () => {
    expect(limitsOf(p({ effectiveFromUtc: '2026-09-02T12:03:58Z', setpointG: null }))).toBeNull();
    // A missing offset must not be read as zero: that would declare every cone
    // outside a tolerance of nothing.
    expect(limitsOf(p({ effectiveFromUtc: '2026-09-02T12:03:58Z', weightOffsetPlusG: null }))).toBeNull();
    expect(limitsOf(null)).toBeNull();
  });
});

describe('ProductTimeline.at', () => {
  const t = new ProductTimeline([
    p({ effectiveFromUtc: '2026-08-19T15:29:11Z', productId: 11, label: 'older' }),
    p({ effectiveFromUtc: '2026-09-02T12:03:58Z', productId: 12, label: 'current' }),
  ]);

  it('returns the product in force, not the newest one', () => {
    expect(t.at('2026-08-25T09:00:00Z')?.label).toBe('older');
    expect(t.at('2026-09-03T09:57:36Z')?.label).toBe('current');
  });

  it('is inclusive of the instant a product takes effect', () => {
    expect(t.at('2026-09-02T12:03:58Z')?.label).toBe('current');
    expect(t.at('2026-09-02T12:03:57Z')?.label).toBe('older');
  });

  it('returns null before anything was ever recorded', () => {
    // 142,000 readings predate the product register. They have no product, and
    // the answer is "none", never "the current one".
    expect(t.at('2026-07-01T09:00:00Z')).toBeNull();
  });

  it('reports an empty timeline', () => {
    expect(new ProductTimeline([]).isEmpty).toBe(true);
    expect(new ProductTimeline([]).at('2026-09-03T09:00:00Z')).toBeNull();
  });
});

describe('ProductTimeline.verdict', () => {
  const t = new ProductTimeline([p({ effectiveFromUtc: '2026-09-02T12:03:58Z' })]);
  const when = '2026-09-03T09:57:36Z';

  it('passes a cone inside the limits', () => {
    expect(t.verdict(when, 1949)).toMatchObject({ inside: true, outsideByG: 0, reason: null });
  });

  it('reports how far below the lower limit a light cone is, as a negative', () => {
    expect(t.verdict(when, 1912)).toMatchObject({ inside: false, outsideByG: -8 });
  });

  it('reports how far above the upper limit a heavy cone is, as a positive', () => {
    expect(t.verdict(when, 2007)).toMatchObject({ inside: false, outsideByG: 7 });
  });

  it('treats the limits themselves as inside', () => {
    expect(t.verdict(when, 1920).inside).toBe(true);
    expect(t.verdict(when, 2000).inside).toBe(true);
  });

  it('NEVER judges a reading weighed before the product was recorded', () => {
    // The defect this module exists to remove: today's tolerance applied to
    // last month's cones, silently, as if it meant something.
    const v = t.verdict('2026-08-01T09:00:00Z', 1912);
    expect(v).toMatchObject({ product: null, limits: null, outsideByG: null, inside: null, reason: 'no_product_recorded' });
  });

  it('says a product has no setpoint rather than computing against nothing', () => {
    const noSp = new ProductTimeline([p({ effectiveFromUtc: '2026-09-02T12:03:58Z', setpointG: null })]);
    expect(noSp.verdict(when, 1912)).toMatchObject({ reason: 'no_setpoint', outsideByG: null, inside: null });
  });

  it('returns limits but no verdict for a reading with no weight', () => {
    const v = t.verdict(when, null);
    expect(v.limits).not.toBeNull();
    expect(v.outsideByG).toBeNull();
    expect(v.reason).toBeNull();
  });
});
