import { live } from '../bridge/lib';

type Ctx = ReturnType<typeof live.useLive>;
export type LiveLineT = NonNullable<Ctx['line']>;

/** A live line the screens can read without a guard: it has a shift, a state and a plant clock. A body with a hole in any of them is no line. */
export function usableLine(l: Ctx['line'] | undefined): LiveLineT | null {
  return l && l.shift && l.state && typeof l.plantNowUtc === 'string' && typeof l.shift.shiftDate === 'string' ? l : null;
}

/**
 * live.useLive() with the line checked (fix-wave T7a1, missing-field robustness): a /api/live answer missing its shift,
 * state or plant clock reads as "no line yet" (health: not known, never "running", never a guessed period) instead of
 * crashing every screen that reads `line.shift` or `line.state`. usePeriod names the failed plant clock.
 */
export function useLive(): Ctx {
  const v = live.useLive();
  const line = usableLine(v.line);
  return line === v.line ? v : { ...v, line };
}

/** The plant clock as it is now, or null when the line is unreadable. */
export function usePlantNow(): string | null {
  const { line, updatedAt } = useLive();
  const now = live.useTicker(1000);
  if (!line || updatedAt == null) return null;
  if (line.replay) return line.plantNowUtc;
  const t = new Date(line.plantNowUtc).getTime() + (now - updatedAt);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
