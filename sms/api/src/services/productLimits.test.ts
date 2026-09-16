/**
 * Time-versioned product limits (SEPT-2026-EPOCH-DECISION §5.4).
 *
 * The bug this pins existed before any write path: sms.product is a mirror
 * overwritten every sync pass, and a reading used to be judged against the
 * product's CURRENT setpoint — so a setpoint change re-judged every past cone.
 * These tests hold the catalogue to "the limits in force at the reading's own
 * time", and to being honest about readings older than anything it knows.
 */
import { describe, expect, it } from 'vitest';
import {
  ProductCatalogue, checkLimitWindowSane, checkNotFuture, limitsFromVersion, type LimitVersion,
} from './productLimits.js';

const T = (iso: string) => new Date(iso).getTime();
const v = (over: Partial<LimitVersion> & { effectiveFromUtc: string }): LimitVersion => ({
  productId: 20,
  setpointG: 1960,
  offsetMinusG: 50,
  offsetPlusG: 50,
  effectiveIsLowerBound: false,
  source: 'pdas_observed',
  ...over,
  effectiveFromMs: T(over.effectiveFromUtc),
});

const catalogue = new ProductCatalogue(
  [{ productId: 20, label: '205-IL0-SD', activeFlag: true }],
  [
    v({ effectiveFromUtc: '2026-08-01T00:00:00.000Z', effectiveIsLowerBound: true }),
    v({ effectiveFromUtc: '2026-08-20T00:00:00.000Z', setpointG: 1970, source: 'sms_write' }),
  ],
);

describe('ProductCatalogue.versionAt / limitsAt', () => {
  it('returns the newest version that had started by the instant', () => {
    expect(catalogue.versionAt(20, T('2026-08-10T12:00:00Z'))?.setpointG).toBe(1960);
    expect(catalogue.versionAt(20, T('2026-08-25T12:00:00Z'))?.setpointG).toBe(1970);
    // Exactly at the boundary the new version is in force.
    expect(catalogue.versionAt(20, T('2026-08-20T00:00:00Z'))?.setpointG).toBe(1970);
  });

  it('judges a reading by the limits in force at ITS time, not the newest', () => {
    // The whole point: a later setpoint change must not move an older limit.
    expect(catalogue.limitsAt(20, T('2026-08-10T12:00:00Z'))).toMatchObject({ loG: 1910, hiG: 2010 });
    expect(catalogue.limitsAt(20, T('2026-08-25T12:00:00Z'))).toMatchObject({ loG: 1920, hiG: 2020 });
  });

  it('falls back to the OLDEST version for readings that predate all of them, flagged as a lower bound', () => {
    const before = catalogue.versionAt(20, T('2026-07-01T00:00:00Z'));
    expect(before?.setpointG).toBe(1960);
    expect(before?.effectiveIsLowerBound).toBe(true);
  });

  it('knows nothing about a product it was not given', () => {
    expect(catalogue.versionAt(99, T('2026-08-10T00:00:00Z'))).toBeNull();
    expect(catalogue.limitsAt(99, T('2026-08-10T00:00:00Z'))).toBeNull();
    expect(catalogue.product(99)).toBeNull();
  });

  it('exposes versions oldest-first for a time walk, and the newest as latest()', () => {
    expect(catalogue.versionsAscending(20).map((x) => x.setpointG)).toEqual([1960, 1970]);
    expect(catalogue.latest(20)?.setpointG).toBe(1970);
    expect(catalogue.productIds()).toEqual([20]);
  });
});

describe('sms_local — appending a version never reclassifies a past reading', () => {
  // A pdas_observed version from 1 Aug, then an sms_local change effective
  // 1 Sep — exactly what setLocalLimitVersion appends (roadmap Phase 4 item
  // 2, 15 Sep 2026). Nothing about the OLD version changes; the new one only
  // covers readings from its own effective_from onward.
  const withLocalChange = new ProductCatalogue(
    [{ productId: 20, label: '205-IL0-SD', activeFlag: true }],
    [
      v({ effectiveFromUtc: '2026-08-01T00:00:00.000Z', effectiveIsLowerBound: true }),
      v({ effectiveFromUtc: '2026-09-01T00:00:00.000Z', setpointG: 1970, source: 'sms_local' }),
    ],
  );

  it('judges a reading from BEFORE the sms_local change by the older version, unchanged', () => {
    const before = withLocalChange.versionAt(20, T('2026-08-15T00:00:00Z'));
    expect(before?.setpointG).toBe(1960);
    expect(before?.source).toBe('pdas_observed');
    expect(withLocalChange.limitsAt(20, T('2026-08-15T00:00:00Z'))).toMatchObject({ loG: 1910, hiG: 2010 });
  });

  it('judges a reading from AFTER the sms_local change by the new version', () => {
    const after = withLocalChange.versionAt(20, T('2026-09-05T00:00:00Z'));
    expect(after?.setpointG).toBe(1970);
    expect(after?.source).toBe('sms_local');
    expect(withLocalChange.limitsAt(20, T('2026-09-05T00:00:00Z'))).toMatchObject({ loG: 1920, hiG: 2020 });
  });

  it('exactly at effective_from, the new (sms_local) version is already in force', () => {
    expect(withLocalChange.versionAt(20, T('2026-09-01T00:00:00Z'))?.source).toBe('sms_local');
  });
});

describe('SOURCE_PRIORITY — the tie-break when two versions share one instant', () => {
  const TIE = '2026-09-01T00:00:00.000Z';

  it('an sms_local row outranks a pdas_observed row at the exact same effective_from, regardless of input order', () => {
    const local = v({ effectiveFromUtc: TIE, setpointG: 1970, source: 'sms_local' });
    const observed = v({ effectiveFromUtc: TIE, setpointG: 1980, source: 'pdas_observed' });

    const a = new ProductCatalogue([{ productId: 20, label: 'x', activeFlag: true }], [observed, local]);
    const b = new ProductCatalogue([{ productId: 20, label: 'x', activeFlag: true }], [local, observed]);

    // Same result whichever order the rows arrived in — the tie-break is a
    // property of the two rows, not an accident of loadProductCatalogue's
    // ORDER BY or array order.
    expect(a.versionAt(20, T(TIE))?.source).toBe('sms_local');
    expect(b.versionAt(20, T(TIE))?.source).toBe('sms_local');
    expect(a.latest(20)?.source).toBe('sms_local');
  });

  it('an sms_local row also outranks an sms_write row at the same instant', () => {
    const local = v({ effectiveFromUtc: TIE, setpointG: 1970, source: 'sms_local' });
    const written = v({ effectiveFromUtc: TIE, setpointG: 1990, source: 'sms_write' });
    const cat = new ProductCatalogue([{ productId: 20, label: 'x', activeFlag: true }], [written, local]);
    expect(cat.versionAt(20, T(TIE))?.source).toBe('sms_local');
  });

  it('an sms_write row outranks a pdas_observed row at the same instant', () => {
    const written = v({ effectiveFromUtc: TIE, setpointG: 1990, source: 'sms_write' });
    const observed = v({ effectiveFromUtc: TIE, setpointG: 1980, source: 'pdas_observed' });
    const cat = new ProductCatalogue([{ productId: 20, label: 'x', activeFlag: true }], [observed, written]);
    expect(cat.versionAt(20, T(TIE))?.source).toBe('sms_write');
  });
});

describe('limitsFromVersion', () => {
  it('is null without a setpoint or without BOTH offsets — a target with no tolerance is not a limit', () => {
    expect(limitsFromVersion(null)).toBeNull();
    expect(limitsFromVersion(v({ effectiveFromUtc: '2026-08-01T00:00:00Z', setpointG: null }))).toBeNull();
    expect(limitsFromVersion(v({ effectiveFromUtc: '2026-08-01T00:00:00Z', offsetPlusG: null }))).toBeNull();
  });

  it('labels symmetric and asymmetric tolerances differently', () => {
    expect(limitsFromVersion(v({ effectiveFromUtc: '2026-08-01T00:00:00Z' }))?.label).toBe('1,960 ± 50 g');
    expect(limitsFromVersion(v({ effectiveFromUtc: '2026-08-01T00:00:00Z', offsetMinusG: 30 }))?.label).toBe('1,930 to 2,010 g');
  });
});

describe('checkLimitWindowSane — the sms_local sanity check', () => {
  const bounds = { setpointLoG: 1500, setpointHiG: 2100 };

  it('accepts a setpoint within bounds and two positive offsets each at most half the setpoint', () => {
    expect(checkLimitWindowSane({ setpointG: 1970, offsetMinusG: 40, offsetPlusG: 40 }, bounds)).toBeNull();
    expect(checkLimitWindowSane({ setpointG: 1970, offsetMinusG: 985, offsetPlusG: 985 }, bounds)).toBeNull();
  });

  it('refuses a setpoint outside the plausible cone range', () => {
    expect(checkLimitWindowSane({ setpointG: 1000, offsetMinusG: 10, offsetPlusG: 10 }, bounds)).toMatch(/outside the plausible cone range/);
    expect(checkLimitWindowSane({ setpointG: 3000, offsetMinusG: 10, offsetPlusG: 10 }, bounds)).toMatch(/outside the plausible cone range/);
  });

  it('refuses a zero or negative offset — strictly positive, unlike the PDAS path', () => {
    expect(checkLimitWindowSane({ setpointG: 1970, offsetMinusG: 0, offsetPlusG: 40 }, bounds)).toMatch(/lower offset 0 g must be more than 0/);
    expect(checkLimitWindowSane({ setpointG: 1970, offsetMinusG: 40, offsetPlusG: -5 }, bounds)).toMatch(/upper offset -5 g must be more than 0/);
  });

  it('refuses an offset more than half the setpoint', () => {
    expect(checkLimitWindowSane({ setpointG: 1970, offsetMinusG: 1000, offsetPlusG: 40 }, bounds)).toMatch(/must be more than 0 and at most half the setpoint/);
  });
});

describe('checkNotFuture', () => {
  const now = new Date('2026-09-16T10:00:00.000Z');
  it('accepts an instant at or before now, refuses one after', () => {
    expect(checkNotFuture(new Date('2026-09-16T09:59:59.000Z'), now)).toBeNull();
    expect(checkNotFuture(now, now)).toBeNull();
    expect(checkNotFuture(new Date('2026-09-16T10:00:01.000Z'), now)).toMatch(/is in the future/);
  });
});
