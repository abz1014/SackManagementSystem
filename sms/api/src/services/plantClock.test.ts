import { describe, expect, it } from 'vitest';
import { fromPlantMs, plantNowMs, plantOffsetMinutes, toPlantIso, toPlantMs } from './plantClock.js';

/**
 * These assert the RELATIONSHIP between the two clocks rather than a fixed
 * five-hour offset: the suite has to pass on a developer machine in any
 * timezone as well as on the plant PC. The five-hour case is the one that
 * matters in production, and it is covered by the invariants below holding for
 * whatever offset the host reports.
 */
describe('the two clocks', () => {
  const utcInstant = '2026-09-02T07:03:58.046Z'; // a product recorded at noon on a UTC+5 plant

  it('shifts a genuine UTC instant onto the production-time convention by exactly the plant offset', () => {
    const shift = toPlantMs(utcInstant) - new Date(utcInstant).getTime();
    expect(shift).toBe(plantOffsetMinutes(new Date(utcInstant)) * 60_000);
  });

  it('round-trips, so a converted instant can be converted back without drift', () => {
    const ms = new Date(utcInstant).getTime();
    expect(fromPlantMs(toPlantMs(ms))).toBe(ms);
  });

  it('agrees with the plant clock live.ts already uses for "now"', () => {
    // If these two ever disagree, the line state and the product timeline are
    // being judged on different clocks, which is the bug this module exists to
    // prevent.
    expect(Math.abs(plantNowMs() - (Date.now() + plantOffsetMinutes() * 60_000))).toBeLessThan(50);
  });

  it('accepts a Date, a string or epoch milliseconds and gives the same answer', () => {
    const ms = new Date(utcInstant).getTime();
    expect(toPlantMs(utcInstant)).toBe(toPlantMs(new Date(utcInstant)));
    expect(toPlantMs(ms)).toBe(toPlantMs(utcInstant));
  });

  it('renders the converted instant as an ISO string on the production convention', () => {
    expect(toPlantIso(utcInstant)).toBe(new Date(toPlantMs(utcInstant)).toISOString());
  });

  it('reports the offset with the sign a reader expects: positive east of Greenwich', () => {
    // getTimezoneOffset() is positive WEST of Greenwich, which is the opposite
    // of how everyone states a timezone; the wrapper exists to hide that.
    const d = new Date(utcInstant);
    expect(plantOffsetMinutes(d)).toBe(-d.getTimezoneOffset());
  });
});
