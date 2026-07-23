/**
 * Shift domain. Boundaries confirmed by IFL (Q8): 06:00 / 14:00 / 22:00.
 * The fix-vs-reproduce decision (Q7) and the night-date rule are still open,
 * so we store BOTH the corrected and legacy shift on every event and let
 * config decide which to surface. See ARCHITECTURE.md §4.3.
 */

export const SHIFT_CODES = ['morning', 'evening', 'night'] as const;
export type ShiftCode = (typeof SHIFT_CODES)[number];

export type ShiftMode = 'corrected' | 'legacy';
export type NightBelongsTo = 'start_day' | 'calendar_day';

/** Confirmed IFL shift boundaries (Q8), as minutes from midnight. */
export const SHIFT_BOUNDARIES = {
  morningStart: 6 * 60, // 06:00
  eveningStart: 14 * 60, // 14:00
  nightStart: 22 * 60, // 22:00
} as const;

/** Corrected shift code from minutes-since-midnight (wall clock). Pure core. */
export function shiftCodeFromMinutes(minutes: number): ShiftCode {
  const { morningStart, eveningStart, nightStart } = SHIFT_BOUNDARIES;
  if (minutes >= morningStart && minutes < eveningStart) return 'morning';
  if (minutes >= eveningStart && minutes < nightStart) return 'evening';
  return 'night';
}

/**
 * Derive the corrected shift code from a real production timestamp.
 * Pure function — no timezone surprises; caller supplies a local Date.
 */
export function shiftCodeFromLocalTime(local: Date): ShiftCode {
  return shiftCodeFromMinutes(local.getHours() * 60 + local.getMinutes());
}

/**
 * Business date the shift is counted against.
 * For the night shift (22:00–06:00) the rule is still open (Q8): under
 * 'start_day' a 02:00 event belongs to the previous calendar day.
 */
export function shiftDateFromLocalTime(
  local: Date,
  rule: NightBelongsTo,
): { year: number; month: number; day: number } {
  const d = new Date(local.getTime());
  if (rule === 'start_day') {
    const minutes = d.getHours() * 60 + d.getMinutes();
    // Night shift after midnight but before 06:00 belongs to the previous day.
    if (minutes < SHIFT_BOUNDARIES.morningStart) {
      d.setDate(d.getDate() - 1);
    }
  }
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
