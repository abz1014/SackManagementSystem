/**
 * THE LIMITS' START DATE, AND WHAT THE APP SAYS WHEN IT DOES NOT KNOW IT.
 *
 * Measured 23 Sep 2026, before this work: all 14 rows of
 * sms.product_limit_version were migration-027 bootstraps stamped
 * 2026-09-11T10:03:15.957Z with `effective_is_lower_bound = 1` and the reason
 * "true start unknown" — i.e. AFTER the last reading in every real source
 * generation. ProductCatalogue.versionAt's documented fallback ("a reading
 * older than the oldest known version is judged by that oldest version") was
 * therefore not a rare edge case; it was the ONLY path, covering 275,063 of
 * 275,063 cones. productAt.ts:211,221 surfaced the flag on the reading sheet,
 * but `limitsAt()` returned BARE limits, so limitWindowsFor → coneState's
 * CASE — the register's state column, /api/production's counts,
 * productDisagreement, weightStations — computed a product-tolerance verdict
 * for every real reading SMS has ever shown without anything downstream
 * knowing the date behind it was invented.
 *
 * Two things close that, and both are pinned here:
 *   1. migration 040 + seedProducts — the TRUE start, read from PDAS's own
 *      `dbo.Materials.Timestamp`, so the question mostly stops arising;
 *   2. `assumedStart` / `limitProvenance` — so that where it DOES still
 *      arise, it is disclosed once over the affected figures instead of
 *      silently or 275,063 times.
 */
import { describe, expect, it } from 'vitest';
import { limitProvenance, type StateContext } from './coneState.js';
import { limitWindowsFor, ProductTimeline } from './productAt.js';
import { ProductCatalogue, type CatalogueProduct, type LimitVersion } from './productLimits.js';

const T = (iso: string) => new Date(iso).getTime();

const version = (over: Partial<LimitVersion> & { effectiveFromUtc: string }): LimitVersion => ({
  productId: 20,
  setpointG: 1960,
  offsetMinusG: 50,
  offsetPlusG: 50,
  effectiveIsLowerBound: false,
  source: 'pdas_created',
  ...over,
  effectiveFromMs: T(over.effectiveFromUtc),
});

const PRODUCT: CatalogueProduct = {
  productId: 20, label: '205-IL0-SD', activeFlag: true,
  description: '205-IL0-SD', lotCode: null, color: null, blend: null, countText: null, tubeType: null,
};

const ctxOf = (windows: StateContext['windows']): StateContext => ({
  plausibility: { loG: 1500, hiG: 2100 },
  windows,
});

/** The catalogue as migration 027 left it: one bootstrap, start unknown. */
const bootstrapped = new ProductCatalogue([PRODUCT], [
  version({ effectiveFromUtc: '2026-09-11T10:03:15.957Z', effectiveIsLowerBound: true, source: 'pdas_observed' }),
]);

/** The catalogue as migration 040 + seedProducts leave it: the measured start. */
const measured = new ProductCatalogue([PRODUCT], [
  version({ effectiveFromUtc: '2026-07-30T06:07:20.067Z', effectiveIsLowerBound: false, source: 'pdas_created' }),
]);

const EMPTY_TIMELINE = new ProductTimeline([]);

describe('limitWindowsFor — assumedStart', () => {
  it('flags the backwards-extended oldest window when its version does not own its start', () => {
    const [w] = limitWindowsFor(EMPTY_TIMELINE, bootstrapped);
    // fromMs null IS the backwards extension: this window judges every
    // reading that ever existed for product 20, including all of them from
    // before 2026-09-11.
    expect(w).toMatchObject({ materialId: 20, fromMs: null, assumedStart: true });
  });

  it('does NOT flag it once the version carries a measured start', () => {
    const [w] = limitWindowsFor(EMPTY_TIMELINE, measured);
    expect(w).toMatchObject({ materialId: 20, fromMs: null, assumedStart: false });
  });

  it('never flags a later version: it governs from a date it really does own', () => {
    const twoVersions = new ProductCatalogue([PRODUCT], [
      version({ effectiveFromUtc: '2026-07-30T06:07:20.067Z', effectiveIsLowerBound: true, source: 'pdas_observed' }),
      version({ effectiveFromUtc: '2026-08-20T00:00:00.000Z', setpointG: 1970, source: 'sms_local' }),
    ]);
    const ws = limitWindowsFor(EMPTY_TIMELINE, twoVersions);
    expect(ws).toHaveLength(2);
    // Oldest first (versionsAscending): extended backwards, start doubted.
    expect(ws[0]).toMatchObject({ fromMs: null, assumedStart: true });
    // The second starts exactly when it says it does.
    expect(ws[1]).toMatchObject({ fromMs: T('2026-08-20T00:00:00.000Z'), assumedStart: false });
  });
});

describe('limitProvenance — the aggregate disclosure', () => {
  it('says nothing at all when every window owns its start', () => {
    const p = limitProvenance(ctxOf(limitWindowsFor(EMPTY_TIMELINE, measured)));
    expect(p.ok).toBe(true);
    expect(p.note).toBeNull();
    expect(p.assumedWindows).toBe(0);
  });

  it('states the fact once, in full, when no window owns its start', () => {
    const p = limitProvenance(ctxOf(limitWindowsFor(EMPTY_TIMELINE, bootstrapped)));
    expect(p.ok).toBe(false);
    expect(p.assumedWindows).toBe(1);
    expect(p.totalWindows).toBe(1);
    // VERBATIM. This wording is the deliverable, not an implementation
    // detail: it has to name what is not known WITHOUT casting doubt on the
    // scale's own verdict (CLAUDE.md rule 1, ONE STATUS VOCABULARY) and
    // WITHOUT over-claiming (rule 5) that the figures are wrong — they are
    // today's limits applied to older readings, which is a different and
    // statable thing.
    expect(p.note).toBe(
      'Product-tolerance figures below are judged against limits whose start date this system does not know. ' +
        'Every set of limits in force here was first recorded after the readings they are being applied to, ' +
        'so "within" and "outside the product\'s limits" state what today\'s limits would have said, not what was in force at the time. ' +
        'The scale\'s own verdict — passed, or rejected by the scale — is a separate reading taken at the machine and is not affected.',
    );
  });

  it('counts rather than generalises when only some windows are affected', () => {
    const p = limitProvenance(ctxOf([
      { materialId: 20, fromMs: null, toMs: null, loG: 1910, hiG: 2010, assumedStart: true },
      { materialId: 21, fromMs: null, toMs: null, loG: 1910, hiG: 2010, assumedStart: false },
    ]));
    expect(p.ok).toBe(false);
    expect(p.note).toContain('1 of the 2 sets of limits in force here was first recorded');
    expect(p.note).not.toContain('Every set of limits');
  });

  it('GOES QUIET BY ITSELF — the same context, with the start confirmed, prints nothing', () => {
    // This is what makes it a disclosure and not a permanent disclaimer:
    // nothing is edited, no flag is cleared by hand. The version gains a
    // start date it owns (a 'pdas_created' row from migration 040, or an
    // engineer's confirmed 'sms_local' one) and the sentence stops being
    // true, so it stops being printed.
    const before = limitProvenance(ctxOf(limitWindowsFor(EMPTY_TIMELINE, bootstrapped)));
    const after = limitProvenance(ctxOf(limitWindowsFor(EMPTY_TIMELINE, measured)));
    expect(before.note).not.toBeNull();
    expect(after.note).toBeNull();
  });

  it('never mentions the scale in a way that puts its verdict in doubt', () => {
    const p = limitProvenance(ctxOf(limitWindowsFor(EMPTY_TIMELINE, bootstrapped)));
    // It names the scale exactly once, to EXCLUDE it.
    expect(p.note).toContain('is not affected');
    expect(p.note).not.toMatch(/scale.{0,40}(unknown|unreliable|in doubt|may be wrong)/i);
  });
});
