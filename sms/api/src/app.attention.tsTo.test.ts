/**
 * Defect fix (16 Sep 2026): `/api/attention` accepted no `tsTo`, so under a
 * replay (`?at=`, which moves the plant clock and is enabled in development)
 * the fixed 14-production-day trailing window (rules 1 and 2) stayed anchored
 * on the server's TRUE newest production day rather than the replayed one,
 * and rule 3's count (productDisagreement, tested separately in
 * productAt.disagreement.test.ts) had no instant-level bound at all.
 *
 * `cappedNewestDay` is app.ts's pure helper for the first half of that — it
 * decides where the trailing window's end moves to. Pulled out and exported
 * for the same reason `validateRange` is (see app.rangeCap.test.ts): pin the
 * date arithmetic without a full HTTP round trip.
 */
import { describe, expect, it } from 'vitest';
import { cappedNewestDay } from './app.js';
import { productionDaysApart } from './services/plantClock.js';

describe('cappedNewestDay', () => {
  it('is the identity when tsTo is absent — the no-regression pin', () => {
    expect(cappedNewestDay('2026-09-07', undefined)).toBe('2026-09-07');
    expect(cappedNewestDay('2026-09-07', null)).toBe('2026-09-07');
  });

  it('moves the window end to the replayed instant\'s own production day', () => {
    expect(cappedNewestDay('2026-09-07', '2026-09-03T09:57:36Z')).toBe('2026-09-03');
  });

  it('never moves the end LATER than the server\'s true newest day — a replay cannot see the future', () => {
    // A replay instant on or after the newest day must not push `to` past it.
    expect(cappedNewestDay('2026-09-03', '2026-09-07T09:57:36Z')).toBe('2026-09-03');
    expect(cappedNewestDay('2026-09-03', '2026-09-03T23:59:59Z')).toBe('2026-09-03');
  });
});

describe('the trailing window\'s length under a replay', () => {
  /** The same formula app.ts's /api/attention route uses for trailingFrom. */
  const trailingFromOf = (trailingTo: string, trailingDays: number) =>
    new Date(new Date(`${trailingTo}T12:00:00Z`).getTime() - (trailingDays - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);

  it('tsTo moves WHERE the window ends; it stays exactly `trailingDays` production days long', () => {
    const newest = '2026-09-07';
    const trailingDays = 14;
    const trailingTo = cappedNewestDay(newest, '2026-08-25T06:00:00Z'); // replay well before newest
    expect(trailingTo).toBe('2026-08-25');
    const trailingFrom = trailingFromOf(trailingTo, trailingDays);
    // productionDaysApart is inclusive-of-both-ends day counting: 13 days apart + the day itself = 14.
    expect(productionDaysApart(trailingFrom, trailingTo)).toBe(trailingDays - 1);

    // Unreplayed (tsTo absent), the window is the same length, just anchored on the true newest day.
    const trailingToNoReplay = cappedNewestDay(newest, undefined);
    expect(trailingToNoReplay).toBe(newest);
    expect(productionDaysApart(trailingFromOf(trailingToNoReplay, trailingDays), trailingToNoReplay)).toBe(trailingDays - 1);
  });

  it('a non-default trailingDays still yields exactly that many days, replayed or not', () => {
    const trailingTo = cappedNewestDay('2026-09-07', '2026-09-01T00:00:00Z');
    const trailingFrom = trailingFromOf(trailingTo, 6);
    expect(productionDaysApart(trailingFrom, trailingTo)).toBe(5);
  });
});
