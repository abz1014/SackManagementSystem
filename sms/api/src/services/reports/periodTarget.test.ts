/**
 * F6 (23 Sep 2026) — "in force at period end", four days after the period end.
 *
 * Report › Cone weight for 2026-08-05 → 2026-09-07 published
 * `inForceAtUtc: '2026-09-11T15:03:15.957Z'` under
 * `source: 'in_force_at_period_end'`, beneath a caption promising the target
 * was the one in force at the END of the period and "never today's product
 * applied backwards". `ProductCatalogue.versionAt` had already flagged the
 * fallback honestly (`effectiveIsLowerBound: true`); the flag was simply
 * dropped on the way to the payload — at `weightStations.ts:196` and again
 * at `coneWeight.ts:144-146` — and the report asserted a start date it did
 * not have.
 *
 * The instants below are the REAL ones from the sidecar, read 23 Sep 2026:
 * every row in `sms.product_limit_version` is a migration-027 bootstrap
 * stamped 2026-09-11T10:03:15.957Z with `effective_is_lower_bound = 1` and
 * the reason "Bootstrapped from the sms.product mirror at migration 027;
 * true start unknown." Which is exactly the point: SMS holds no record at all
 * of what was in force during August, and a report may not invent one.
 */
import { describe, expect, it } from 'vitest';
import { resolvePeriodTarget } from './common.js';

const ms = (iso: string) => Date.parse(iso);
const PERIOD_TO = '2026-09-07';
const PERIOD_END_MS = ms('2026-09-07T23:59:59Z');

const BOOTSTRAP = {
  effectiveFromMs: ms('2026-09-11T15:03:15.957Z'),
  effectiveFromUtc: '2026-09-11T15:03:15.957Z',
  effectiveIsLowerBound: true,
};

describe('resolvePeriodTarget — the §8 rule at the one place a report states a target', () => {
  it('REFUSES a version that begins after the period ended, rather than calling it "in force"', () => {
    const r = resolvePeriodTarget(BOOTSTRAP, PERIOD_END_MS, PERIOD_TO);
    expect(r.usable).toBe(false);
    expect(r.omittedReason).toContain('2026-09-11');
    expect(r.omittedReason).toContain('2026-09-07');
    expect(r.omittedReason).toMatch(/never by a later record applied backwards/);
  });

  it('accepts a version in force at the period end, unqualified', () => {
    const r = resolvePeriodTarget(
      { effectiveFromMs: ms('2026-08-20T00:00:00Z'), effectiveFromUtc: '2026-08-20T00:00:00.000Z', effectiveIsLowerBound: false },
      PERIOD_END_MS,
      PERIOD_TO,
    );
    expect(r).toEqual({ usable: true, inForceAtUtc: '2026-08-20T00:00:00.000Z', isLowerBound: false, omittedReason: null });
  });

  it('CARRIES the lower-bound flag for a version in force but only first SEEN at its instant', () => {
    const r = resolvePeriodTarget(
      { effectiveFromMs: ms('2026-08-20T00:00:00Z'), effectiveFromUtc: '2026-08-20T00:00:00.000Z', effectiveIsLowerBound: true },
      PERIOD_END_MS,
      PERIOD_TO,
    );
    // Usable — the limits DID apply during the period; we only cannot prove
    // they started exactly then, which the instant must be read as.
    expect(r.usable).toBe(true);
    expect(r.isLowerBound).toBe(true);
  });

  it('a version beginning on the last second of the period is inside it, not after it', () => {
    const r = resolvePeriodTarget(
      { effectiveFromMs: PERIOD_END_MS, effectiveFromUtc: '2026-09-07T23:59:59.000Z', effectiveIsLowerBound: false },
      PERIOD_END_MS,
      PERIOD_TO,
    );
    expect(r.usable).toBe(true);
  });

  it('no version at all is not a defect and carries no explanation', () => {
    expect(resolvePeriodTarget(null, PERIOD_END_MS, PERIOD_TO)).toEqual({
      usable: false, inForceAtUtc: null, isLowerBound: false, omittedReason: null,
    });
  });
});
