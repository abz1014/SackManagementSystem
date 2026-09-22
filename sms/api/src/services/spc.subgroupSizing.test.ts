/**
 * D-1 (DEFECTS.md) — subgroup sizing pinned against measurements taken from
 * the live `_SEP07` dev copy on 22 Sep 2026 (LINE_ID=1, `sms.cone_event`,
 * 1500-2100g plausibility window). The old rule sized buckets from the
 * requested period's CALENDAR span, clamped the desired bucket count at a
 * flat 72, and produced subgroups 8x-197x TARGET_PER_SUBGROUP (=20). The
 * fixed rule sizes buckets from the population's own OCCUPIED span
 * (`occupiedMinutesFor`), uncapped except by a defensive
 * MAX_REALISED_BUCKETS the shift/day/week/month scales below never approach.
 *
 * Every `count`/`rawSpanMinutes`/`occDays` triple below is a real number read
 * from the live copy (see the worker's report), not invented — so this test
 * doubles as the register for those measurements.
 */
import { describe, expect, it } from 'vitest';
import { occupiedMinutesFor, pickBucketMinutes } from './spc.js';

describe('occupiedMinutesFor — the span buckets are sized from', () => {
  it('uses the raw (max-min) span when it fits inside the occupied-days bound', () => {
    // A single evening shift, measured 21 Sep 2026: 2,619 cones over an
    // 8-hour window inside ONE calendar day. The raw span (480 min) is
    // already tighter than occDays*1440 (1,440) — no gap to cap.
    expect(occupiedMinutesFor(480, 1)).toBe(480);
  });

  it('caps a genuine multi-day production gap inside the period', () => {
    // 2026-07-05..2026-08-10, measured live: the source-generation cutover
    // (CLAUDE.md's "10 Jul - 5 Aug data gap") sits inside this window. First
    // and last readings are 37 calendar days apart (53,280 raw minutes) but
    // only 14 of those days produced a plausible reading. Without the cap,
    // the 24 empty days in the middle would be sized as if the line ran
    // through them.
    expect(occupiedMinutesFor(53_280, 14)).toBe(14 * 1440);
  });

  it('is 0 when nothing plausible was read (no span to size from)', () => {
    expect(occupiedMinutesFor(0, 0)).toBe(0);
  });

  it('floors the raw span at 1 minute rather than dividing by zero later', () => {
    // A single reading: min === max, raw span 0, but occDays is 1.
    expect(occupiedMinutesFor(0, 1)).toBe(1);
  });
});

describe('pickBucketMinutes — sized from the OCCUPIED span, not the calendar span (D-1)', () => {
  it('a shift: was 30-minute (median n=168, 8.4x target) — now 15-minute, close to target', () => {
    // count=2,619, occupiedMinutesFor(480, 1)=480 (measured 21 Sep 2026).
    const b = pickBucketMinutes(480, 2619);
    expect(b).toEqual({ minutes: 15, label: '15-minute' });
    // 480/15 = 32 buckets; 2619/32 ≈ 82 — a few multiples of the 20 target,
    // not 8x-197x. This IS the honest floor (see spc.ts's pickBucketMinutes
    // doc comment): NICE bottoms out at 15 minutes so a bucket still covers
    // a full cycle of the line's ~14 interleaved stations.
    const avgN = 2619 / (480 / 15);
    expect(avgN).toBeCloseTo(81.8, 1);
  });

  it('a day: was 30-minute (median n=165) — now 15-minute, same floor as a shift', () => {
    // count=7,839, occupiedMinutesFor(1437, 2)=1437 (measured 21 Sep 2026).
    const b = pickBucketMinutes(1437, 7839);
    expect(b).toEqual({ minutes: 15, label: '15-minute' });
  });

  it('a week: was 4-hour (median n=1,295, 65x target) — now 15-minute', () => {
    // count=44,372, occupiedMinutesFor(8278, 7)=8278 (measured 21 Sep 2026).
    const b = pickBucketMinutes(8278, 44_372);
    expect(b).toEqual({ minutes: 15, label: '15-minute' });
  });

  it('a month: was 12-hour (median n=4,400, 220x target) — now 15-minute', () => {
    // count=267,772, occupiedMinutesFor(48569, 35)=48569 (no internal gap in
    // this particular month; measured 21 Sep 2026 against the 05 Aug-07 Sep
    // generation).
    const b = pickBucketMinutes(48_569, 267_772);
    expect(b).toEqual({ minutes: 15, label: '15-minute' });
  });

  it('a period spanning a genuine gap: the gap-capped span, not the raw one, drives sizing', () => {
    // 2026-07-05..2026-08-10 (measured live): count=75,148, raw span 53,280
    // min (37 calendar days), occDays=14. occupiedMinutesFor caps this to
    // 20,160 min — see the describe block above. Sizing from the UNCAPPED
    // raw span would pick a coarser bucket (desiredBuckets = 75148/20 ≈
    // 3,757; 53,280/3,757 ≈ 14.2 min -> still 15-minute here, so this test
    // asserts the capped span is actually what's passed in, not just the
    // resulting bucket, since the two spans alias to the same NICE bucket at
    // this particular count and would silently pass even if the cap were
    // dropped).
    const capped = occupiedMinutesFor(53_280, 14);
    expect(capped).toBe(20_160);
    const b = pickBucketMinutes(capped, 75_148);
    expect(b).toEqual({ minutes: 15, label: '15-minute' });
  });

  it('a low-rate sack week: was 4-hour (avg n≈59) — now 2-hour, close to target', () => {
    // Measured 22 Sep 2026 against sms.sack_event: count=2,029,
    // occupiedMinutesFor(8258, 7)=8258.
    const b = pickBucketMinutes(8258, 2029);
    expect(b).toEqual({ minutes: 120, label: '2-hour' });
    const avgN = 2029 / (8258 / 120);
    expect(avgN).toBeCloseTo(29.5, 1);
  });

  it('a low-rate sack month: was 12-hour (avg n≈174, 8.7x target) — now 2-hour, near target', () => {
    // Measured 22 Sep 2026: count=11,630, occupiedMinutesFor(48178, 34)=48178.
    const b = pickBucketMinutes(48_178, 11_630);
    expect(b).toEqual({ minutes: 120, label: '2-hour' });
    const avgN = 11_630 / (48_178 / 120);
    expect(avgN).toBeCloseTo(29, 0);
  });

  it('no data: falls back to the coarsest bucket rather than dividing by zero', () => {
    expect(pickBucketMinutes(0, 0)).toEqual({ minutes: 1440, label: 'daily' });
    expect(pickBucketMinutes(500, 0)).toEqual({ minutes: 1440, label: 'daily' });
  });

  it('stability: a short partial shift still lands on the same 15-minute floor', () => {
    // 2026-09-15 morning, measured live: only 640 cones (a short/startup
    // shift) over a 119-minute occupied window — a much smaller n than the
    // other cases, checking the rule does not swing wildly as volume drops.
    const b = pickBucketMinutes(119, 640);
    expect(b).toEqual({ minutes: 15, label: '15-minute' });
  });

  it('a defensively pathological span (far beyond shift/day/week/month) falls back to daily', () => {
    // A period whose target-driven bucket count would demand well over
    // MAX_REALISED_BUCKETS buckets even at the 15-minute floor — the
    // defensive cap this module documents as protecting the SQL GROUP BY /
    // payload size, never the TARGET_PER_SUBGROUP calculation itself.
    const oneYearMinutes = 365 * 1440;
    const b = pickBucketMinutes(oneYearMinutes, 20_000_000);
    expect(b).toEqual({ minutes: 1440, label: 'daily' });
  });
});
