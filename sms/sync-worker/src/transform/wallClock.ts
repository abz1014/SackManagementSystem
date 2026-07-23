/**
 * Wall-clock helpers (pure, tz-safe). With the driver's useUTC=true, an IFL
 * datetime comes back as a JS Date whose UTC fields equal the stored wall clock.
 * We read those via getUTC* so shift bucketing never depends on the Node tz.
 */
import { shiftCodeFromMinutes, SHIFT_BOUNDARIES, type ShiftCode, type NightBelongsTo } from '@sms/shared';

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

export function shiftCodeOf(wc: WallClock): ShiftCode {
  return shiftCodeFromMinutes(wc.minuteOfDay);
}

/** Business date as a UTC-midnight Date (safe to store in a DATE column). */
export function shiftDateOf(wc: WallClock, rule: NightBelongsTo): Date {
  let { y, mo, d } = wc;
  if (rule === 'start_day' && wc.minuteOfDay < SHIFT_BOUNDARIES.morningStart) {
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
