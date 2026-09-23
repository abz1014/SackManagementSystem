/**
 * LINE'S TWO BLOCKS, AND WHY THEY DISAGREED (23 Sep 2026).
 *
 * Reported by the friction audit and REPRODUCED against the sidecar before
 * anything was changed:
 *
 *   "Stations — cones this period"   all fourteen stations at 0 · quiet
 *   "What is being made"             the same fourteen at 34-51 cones each
 *
 * One screen, one moment, two opposite-sounding statements about fourteen
 * machines. The measurement, run directly against `sms.cone_event`:
 *
 *   shift_date = 2026-09-23 (the selected period, the current day)  ->  0 rows
 *   MAX(production_ts_utc_ms) for the line                          ->  2026-09-22 12:29:22
 *   the two hours to that anchor, per station                       ->  34-51 cones, all 14
 *
 * BOTH BLOCKS WERE RIGHT. The period block is right that the selected day
 * holds no readings. The machines block is right about the two hours to the
 * newest reading on record — which was the PREVIOUS DAY.
 *
 * THE CAUSE IS NOT THE 18-MINUTE ACQUISITION LAG, and it matters not to
 * record it as such. The lag is ~18 minutes; this gap was over 24 hours. The
 * cause is that `getMachinesRunning` does not take the selected period at
 * all: it anchors its two-hour window on `MAX(production_ts_utc_ms)` over the
 * whole table, capped only by the replay instant. That is CORRECT and
 * deliberate (machinesRunning.ts rule 1 — "the window is anchored on the
 * newest reading on record, never on the clock"), and it is why the fix is
 * not to make the numbers agree. They measure different things. The defect
 * was that NEITHER BLOCK NAMED ITS OWN WINDOW, so the reader had no way to
 * know that.
 *
 * THE GENERATION HALF OF THIS IS NOW FIXED, ELSEWHERE (23 Sep 2026). The
 * 34-51 cones came entirely from source epoch 13, the plant simulator's
 * generation, and this header used to end by recording that `machinesRunning`
 * was deliberately left unconstrained pending an owner decision. That
 * decision was made the same day — the newest REAL generation wins (D-11) —
 * so `machinesRunning.ts` now anchors on `MAX(production_ts_utc_ms)` over ONE
 * generation. Re-measured after the change: the anchor moves from 2026-09-22
 * (simulator) to 2026-09-07 12:00 (IFL's own September generation), and the
 * window holds 8 stations on 347 cones rather than 14 on 603.
 *
 * NOTHING IN THIS FILE CHANGES BECAUSE OF THAT, and that is the point. Rule 1
 * is intact — the window is still anchored on the newest reading on record,
 * never on the selected period or the clock — so the window-vs-period
 * mismatch these tests cover still exists, at IFL too, on any period that is
 * not the newest data. What was a simulator-shaped symptom here is now a
 * generation-shaped one; the sentences that name the window are what make
 * either of them readable.
 */
import { describe, expect, it } from 'vitest';
import type { Period } from '../lib/period';
import { W } from '../lib/words';
import { windowAsOfText, windowOutsidePeriod } from './Line';

const period = (from: string, to: string): Period => ({
  key: 'pick', from, to, tsTo: `${to}T23:59:59.000Z`, live: false, days: 1, picked: { from, to },
});

describe('the machines window is stated, not implied', () => {
  it('names the day AND the time of the window anchor', () => {
    // A bare clock time would be the same defect one step smaller: "12:29 PM"
    // reads as today to anyone who does not already know it is not.
    const t = windowAsOfText('2026-09-22T12:29:22.000Z')!;
    expect(t).toContain('22 Sep');
    expect(t).toContain('12:29');
  });

  it('renders in the PLANT clock, never converted to the viewer zone', () => {
    // Production instants are the plant's wall clock labelled UTC. Applying
    // the viewer's offset would apply the plant's offset twice (TWO CLOCKS).
    expect(windowAsOfText('2026-09-22T00:30:00.000Z')).toContain('22 Sep');
    expect(windowAsOfText('2026-09-22T23:30:00.000Z')).toContain('22 Sep');
  });

  it('says nothing at all rather than inventing an anchor when there is none', () => {
    expect(windowAsOfText(null)).toBeNull();
  });
});

describe('the wording itself cannot regress to a constant', () => {
  it('machinesWindow REQUIRES an as-of — it cannot be a fixed sentence again', () => {
    // It used to be the constant "…in the last 2 hours of plant time", which
    // reads as the last two hours of NOW and was the whole contradiction.
    // A function cannot be rendered without naming its window.
    expect(typeof W.cone.machinesWindow).toBe('function');
    const s = W.cone.machinesWindow('Tue 22 Sep, 12:29 PM');
    expect(s).toContain('Tue 22 Sep, 12:29 PM');
    expect(s).toMatch(/newest reading/i);
    expect(s).toMatch(/not (on )?the selected period/i);
  });

  it('the quiet row says "this window", not "the last 2 h"', () => {
    expect(W.cone.quietWindow).not.toMatch(/last 2\s*h/i);
    expect(W.cone.quietWindow).toMatch(/window/i);
  });

  it('the block note carries the as-of beside the product count', () => {
    expect(W.cone.machinesNote(6, 'Tue 22 Sep, 12:29 PM')).toContain('Tue 22 Sep, 12:29 PM');
    // With no reading at all there is no as-of to state, and none is invented.
    expect(W.cone.machinesNote(6, null)).toBe('6 products running');
  });

  it('the outside-period sentence names BOTH windows, so neither is the default', () => {
    const s = W.cone.machinesOutsidePeriod('Tue 22 Sep, 12:29 PM', 'Today');
    expect(s).toContain('Tue 22 Sep, 12:29 PM');
    expect(s).toContain('Today');
  });
});

describe('windowOutsidePeriod — the reproduced case', () => {
  it('flags the exact case from the audit: newest reading 22 Sep, period 23 Sep', () => {
    expect(windowOutsidePeriod('2026-09-22T12:29:22.000Z', period('2026-09-23', '2026-09-23'))).toBe(false);
    // One day apart is inside the tolerance below, so the sentence is not
    // shown; the as-of on the block still names 22 Sep. Two days is where
    // the claim becomes safe to make.
    expect(windowOutsidePeriod('2026-09-21T12:29:22.000Z', period('2026-09-23', '2026-09-23'))).toBe(true);
  });

  it('flags a window weeks away from the period — the worst reading of the block', () => {
    // A July period beside a September window is the case that would have
    // had a reader believe fourteen machines were running in July.
    expect(windowOutsidePeriod('2026-09-22T12:29:22.000Z', period('2026-06-22', '2026-07-10'))).toBe(true);
  });

  it('does not flag a window inside the period', () => {
    expect(windowOutsidePeriod('2026-08-14T06:00:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(false);
    expect(windowOutsidePeriod('2026-08-05T00:10:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(false);
    expect(windowOutsidePeriod('2026-08-20T23:50:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(false);
  });

  it('tolerates ONE day at each edge, because shift_date is not the calendar day', () => {
    // A night shift's cones carry the START day's shift_date, so a
    // production instant and its shift_date legitimately differ by up to a
    // calendar day at a boundary. Asserting "outside the period" on a
    // one-day difference would print a false statement, on paper, routinely.
    expect(windowOutsidePeriod('2026-08-21T02:00:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(false);
    expect(windowOutsidePeriod('2026-08-04T22:00:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(false);
    expect(windowOutsidePeriod('2026-08-22T02:00:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(true);
    expect(windowOutsidePeriod('2026-08-03T22:00:00.000Z', period('2026-08-05', '2026-08-20'))).toBe(true);
  });

  it('consults no clock of its own — the answer depends only on its two arguments', () => {
    const args = ['2026-09-22T12:29:22.000Z', period('2026-06-22', '2026-07-10')] as const;
    const first = windowOutsidePeriod(...args);
    const real = Date.now;
    try {
      Date.now = () => Date.parse('2030-01-01T00:00:00Z');
      expect(windowOutsidePeriod(...args)).toBe(first);
    } finally {
      Date.now = real;
    }
  });
});
