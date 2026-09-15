/**
 * checkPlantOffset (roadmap H7, 15 Sep 2026): the cross-check that catches a
 * deployment host whose OS timezone does not match the plant's declared
 * offset (PLANT_UTC_OFFSET_MINUTES). `hostOffsetMinutes` is a parameter here
 * — never read from the machine's real timezone via plantOffsetMinutes() —
 * precisely so these cases are deterministic on any box the suite runs on,
 * including CI's TZ=UTC runner and a developer's UTC+5 machine alike (see
 * plantClock.test.ts's sibling, api/src/services/plantClock.test.ts, for the
 * -0 gotcha that same runner already found once in this file's neighbourhood).
 */
import { describe, expect, it } from 'vitest';
import { checkPlantOffset } from './plantClock.js';

describe('checkPlantOffset', () => {
  it('is silent (checked, not mismatched) when the host and configured offsets agree', () => {
    const r = checkPlantOffset(300, 300);
    expect(r.checked).toBe(true);
    expect(r.mismatched).toBe(false);
    expect(r.hostOffsetMinutes).toBe(300);
    expect(r.plantOffsetMinutes).toBe(300);
    expect(r.offsetMismatchMinutes).toBeUndefined();
  });

  it('agrees on a zero offset without the -0 trap (Object.is, not ===)', () => {
    // plantOffsetMinutes() itself is documented to never return -0; this
    // pins that a caller passing a literal 0 (a UTC host) is treated the
    // same as any other match, in case a future refactor reintroduces -0.
    const r = checkPlantOffset(0, 0);
    expect(r.mismatched).toBe(false);
    expect(Object.is(r.hostOffsetMinutes, -0)).toBe(false);
  });

  it('warns with the exact mismatch, in both directions, when host and configured offsets differ', () => {
    // The plant is UTC+5 (300) but the host is a freshly imaged UTC server (0)
    // — the exact scenario roadmap H7 exists for.
    const freshUtcHost = checkPlantOffset(300, 0);
    expect(freshUtcHost.checked).toBe(true);
    expect(freshUtcHost.mismatched).toBe(true);
    expect(freshUtcHost.hostOffsetMinutes).toBe(0);
    expect(freshUtcHost.plantOffsetMinutes).toBe(300);
    expect(freshUtcHost.offsetMismatchMinutes).toBe(-300);
    expect(freshUtcHost.message).toBe(
      "plantClock: this host's OS timezone reports a UTC offset of 0 minutes, " +
        'but PLANT_UTC_OFFSET_MINUTES says the plant is at 300. Every production/app-time ' +
        'comparison in this app (product changeovers, calibration adjustments, live status) will be off by ' +
        "-300 minutes until this host's timezone matches the plant's.",
    );

    // The other direction: host ahead of the configured plant offset.
    const hostAhead = checkPlantOffset(300, 330);
    expect(hostAhead.mismatched).toBe(true);
    expect(hostAhead.offsetMismatchMinutes).toBe(30);
    expect(hostAhead.message).toContain('30 minutes until');
  });

  it('is skipped, and says why, when PLANT_UTC_OFFSET_MINUTES is unset', () => {
    const r = checkPlantOffset(undefined, 300);
    expect(r.checked).toBe(false);
    expect(r.mismatched).toBe(false);
    expect(r.plantOffsetMinutes).toBeUndefined();
    expect(r.offsetMismatchMinutes).toBeUndefined();
    // Still reports the host's own offset — a caller may want it even when
    // there is nothing configured to compare it against.
    expect(r.hostOffsetMinutes).toBe(300);
    expect(r.message).toMatch(/not set/i);
  });

  it('defaults hostOffsetMinutes to plantOffsetMinutes() when not supplied, so real call sites need only pass the configured value', () => {
    // Not asserting a specific number here — that would depend on the
    // machine's real timezone, which this suite must not do. Only that the
    // default path runs and returns a well-formed result.
    const r = checkPlantOffset(undefined);
    expect(typeof r.hostOffsetMinutes).toBe('number');
    expect(Number.isInteger(r.hostOffsetMinutes)).toBe(true);
  });
});
