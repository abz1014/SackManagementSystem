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

/** Shift boundaries as minutes from midnight, morning < evening < night. */
export interface ShiftBoundaries {
  morningStart: number;
  eveningStart: number;
  nightStart: number;
}

/**
 * The boundaries IFL confirmed for TP1 Line 3 (Q8): 06:00 / 14:00 / 22:00.
 *
 * Roadmap Phase 1: these are the DEFAULT, not the rule. The rule in force for
 * a line is the newest `sms.shift_rule` row, which carries its own three start
 * times and is edited in Setup; the worker reads it at the start of every
 * pass and the API per request. This constant seeds a fresh database and is
 * the fallback when a line has no rule row yet — nothing else should read it.
 */
export const DEFAULT_SHIFT_BOUNDARIES: ShiftBoundaries = {
  morningStart: 6 * 60, // 06:00
  eveningStart: 14 * 60, // 14:00
  nightStart: 22 * 60, // 22:00
};

/** @deprecated Read the line's shift rule; use DEFAULT_SHIFT_BOUNDARIES only as a seed/fallback. */
export const SHIFT_BOUNDARIES = DEFAULT_SHIFT_BOUNDARIES;

/** 'HH:MM' (24 h) → minutes from midnight; null when malformed. */
export function parseShiftTime(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes from midnight → 'HH:MM'. */
export function formatShiftTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Three 'HH:MM' strings → boundaries, or null unless morning < evening < night. */
export function shiftBoundariesFrom(morning: string, evening: string, night: string): ShiftBoundaries | null {
  const ms = parseShiftTime(morning);
  const es = parseShiftTime(evening);
  const ns = parseShiftTime(night);
  if (ms == null || es == null || ns == null) return null;
  if (!(ms < es && es < ns)) return null;
  return { morningStart: ms, eveningStart: es, nightStart: ns };
}

/** Corrected shift code from minutes-since-midnight (wall clock). Pure core. */
export function shiftCodeFromMinutes(minutes: number, b: ShiftBoundaries = DEFAULT_SHIFT_BOUNDARIES): ShiftCode {
  const { morningStart, eveningStart, nightStart } = b;
  if (minutes >= morningStart && minutes < eveningStart) return 'morning';
  if (minutes >= eveningStart && minutes < nightStart) return 'evening';
  return 'night';
}

