/**
 * Wall-clock helpers (pure, tz-safe). With the driver's useUTC=true, an IFL
 * datetime comes back as a JS Date whose UTC fields equal the stored wall clock.
 * We read those via getUTC* so shift bucketing never depends on the Node tz.
 *
 * Roadmap Phase 1 (14 Sep 2026): the shift boundaries are an ARGUMENT, never
 * a constant. Until now `shiftCodeOf` and `shiftDateOf` read the shared
 * `SHIFT_BOUNDARIES` (06/14/22), so a rule edited in Setup › Rules changed the
 * night-attribution half and left the boundaries themselves frozen in code —
 * the same class of defect as finding H5, where the night rule was read from
 * the env at startup and a rebuild silently re-derived the old value. The
 * caller resolves the line's rule (`resolveShiftRule` in runTransform.ts) and
 * passes its boundaries in; there is deliberately no default parameter, so a
 * caller cannot forget the rule and get the seed values by accident.
 */
import { shiftCodeFromMinutes, type ShiftBoundaries, type ShiftCode, type NightBelongsTo } from '@sms/shared';

export interface WallClock {
  ms: number; // epoch ms — the cross-source merge key component
  minuteOfDay: number;
  y: number;
  mo: number; // 1-12
  d: number;
}

export function wallClockOf(dt: Date): WallClock {
  return {
    ms: dt.getTime(),
    minuteOfDay: dt.getUTCHours() * 60 + dt.getUTCMinutes(),
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

export function shiftCodeOf(wc: WallClock, boundaries: ShiftBoundaries): ShiftCode {
  return shiftCodeFromMinutes(wc.minuteOfDay, boundaries);
}

/**
 * Business date as a UTC-midnight Date (safe to store in a DATE column).
 * Under 'start_day' the part of the night shift after midnight — everything
 * before the morning boundary — belongs to the day the shift started on.
 */
export function shiftDateOf(wc: WallClock, rule: NightBelongsTo, boundaries: ShiftBoundaries): Date {
  let { y, mo, d } = wc;
  if (rule === 'start_day' && wc.minuteOfDay < boundaries.morningStart) {
    // night shift after midnight belongs to the previous calendar day
    const prev = new Date(Date.UTC(y, mo - 1, d) - 86_400_000);
    y = prev.getUTCFullYear();
    mo = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return new Date(Date.UTC(y, mo - 1, d));
}

/** Normalise IFL's legacy Shift string ('Morning'/'Evening'/'Night') → code. */
export function normalizeLegacyShift(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  return v === 'morning' || v === 'evening' || v === 'night' ? v : (v || null);
}
