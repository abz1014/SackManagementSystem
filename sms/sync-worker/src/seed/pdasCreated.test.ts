/**
 * `Materials.Timestamp` → `product_limit_version.effective_from`.
 *
 * THE TWO CLOCKS, at the one point in the limits-provenance path where a
 * wrong sign would be silently, plausibly wrong rather than loudly broken.
 * Timestamp is PDAS's own getdate() — the plant's wall clock — and
 * effective_from is defined as a genuine UTC instant, which
 * productLimits.ts's loadProductCatalogue converts back through toPlantMs()
 * before comparing it against a reading. Get the sign backwards on a UTC+5
 * plant and a version takes effect TEN hours from where it should, so a
 * changeover's first hours of cones are judged against the previous
 * material's tolerance and every figure still looks entirely reasonable.
 *
 * The round trip is asserted rather than the constant: this test must hold on
 * the UTC CI runner as well as on the UTC+5 development machine, and
 * plantOffsetMinutes() reads the host's own zone on purpose.
 */
import { describe, expect, it } from 'vitest';
import { plantOffsetMinutes } from '@sms/shared';
import { pdasCreatedAsUtc } from './seedProducts.js';

describe('pdasCreatedAsUtc', () => {
  it('takes the plant offset OFF, so toPlantMs puts it back exactly', () => {
    // 2026-07-30 11:07:20.067 on the factory floor — PDAS's own record of
    // when MaterialId 20 was created, read off the September copy.
    const plant = new Date('2026-07-30T11:07:20.067Z');
    const utc = pdasCreatedAsUtc(plant)!;
    const backToPlant = utc.getTime() + plantOffsetMinutes(utc) * 60_000;
    expect(backToPlant).toBe(plant.getTime());
  });

  it('moves the instant EARLIER east of Greenwich — not later', () => {
    const plant = new Date('2026-07-30T11:07:20.067Z');
    const utc = pdasCreatedAsUtc(plant)!;
    const offset = plantOffsetMinutes(plant);
    if (offset > 0) expect(utc.getTime()).toBeLessThan(plant.getTime());
    expect(plant.getTime() - utc.getTime()).toBe(offset * 60_000);
  });

  it('accepts the string form the driver may hand back', () => {
    expect(pdasCreatedAsUtc('2026-07-30T11:07:20.067Z')?.getTime()).toBe(
      pdasCreatedAsUtc(new Date('2026-07-30T11:07:20.067Z'))?.getTime(),
    );
  });

  it('returns null for a material PDAS records no creation instant for', () => {
    // The caller then falls back to a 'pdas_observed' row stamped now and
    // flagged as a lower bound — honest about knowing less, rather than
    // inventing a date, which is the whole point of the change.
    expect(pdasCreatedAsUtc(null)).toBeNull();
    expect(pdasCreatedAsUtc(undefined)).toBeNull();
    expect(pdasCreatedAsUtc('not a date')).toBeNull();
  });
});
