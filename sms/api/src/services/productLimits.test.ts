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
import { ProductCatalogue, limitsFromVersion, type LimitVersion } from './productLimits.js';

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
