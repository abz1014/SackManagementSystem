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

