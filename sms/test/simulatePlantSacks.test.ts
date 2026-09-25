/**
 * Regression: a live-mode catch-up tick must not stamp every missed sack
 * with the tick instant. sack1_TP1U2 has no production-time column, so `Date`
 * IS the sack's event time; on 25 Sep 2026 a restart after a ~3-day pause
 * wrote 1,129 sacks at four timestamps and the Line screen showed 1,127
 * sacks for one shift beside ~130 cones.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations
import { generate, liveInsertTimes } from '../scripts/simulate-plant.mjs';

describe('simulate-plant live catch-up', () => {
  it('spreads catch-up sacks over their own weighing times, not the tick instant', () => {
    const now = Date.UTC(2026, 8, 25, 15, 40);
    const from = now - 3 * 86_400_000;
    const lag = 18 * 60_000;
    const t = liveInsertTimes(now, () => lag);
    const state = { coneCursor: from, sackCursor: from, sackNum: 1 };
    const ids = { cone: 1, sack: 1, qcs: 1, wrej: 1 };
    const { sacks } = generate(from, now - lag, ids, state, t.cone, t.sack);

    expect(sacks.length).toBeGreaterThan(300); // three days' worth
    const atNow = sacks.filter((s: { Date: Date }) => s.Date.getTime() === now).length;
    // Old code: every sack at `now`. New: only those weighed in the last lag.
    expect(atNow).toBeLessThan(sacks.length * 0.05);
    // No single 8-hour shift may hold more than a plausible share.
    const shiftMs = 8 * 3_600_000;
    const perShift = new Map<number, number>();
    for (const s of sacks as { Date: Date }[]) {
      const k = Math.floor(s.Date.getTime() / shiftMs);
      perShift.set(k, (perShift.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perShift.values())).toBeLessThan(250);
    for (const s of sacks as { Date: Date }[]) expect(s.Date.getTime()).toBeLessThanOrEqual(now);
  });
});
