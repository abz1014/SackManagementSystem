/**
 * Comparison period for /api/production?compare=prev|week.
 *
 * Pure date arithmetic on production-convention dates (YYYY-MM-DD, the
 * plant's wall-clock production day; see plantClock.ts, TWO CLOCKS). Shift
 * maths reuses shiftRange.ts's `shiftOrd`; shifts are laid on one line as
 * day*3 + (ord-1), so a range of N shifts crosses midnight and month ends
 * correctly.
 *
 *  - prev, day range: equal-length block ending the day before `from`.
 *  - prev, shift range: same number of shifts ending just before `fromShift`.
 *  - prev, single shift (`shift` filter): same shift on the previous
 *    equal-length day block (the day rule, shift filter kept).
 *  - week: every bound minus 7 days, shifts unchanged.
 */
import { shiftOrd, type ShiftName } from './shiftRange.js';

export type CompareMode = 'prev' | 'week';

export interface ComparePeriodInput {
  from: string;
  to: string;
  fromShift?: ShiftName;
  toShift?: ShiftName;
  shift?: ShiftName;
}

const DAY_MS = 86_400_000;
const SHIFTS: readonly ShiftName[] = ['morning', 'evening', 'night'];

function dayNum(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}
function dayIso(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function previousPeriod(input: ComparePeriodInput, mode: CompareMode): ComparePeriodInput {
  const { from, to, fromShift, toShift, shift } = input;
  const f = dayNum(from);
  const t = dayNum(to);
  const out: ComparePeriodInput = { from, to };
  if (shift) out.shift = shift;

  if (mode === 'week') {
    out.from = dayIso(f - 7);
    out.to = dayIso(t - 7);
    if (fromShift && toShift) {
      out.fromShift = fromShift;
      out.toShift = toShift;
    }
    return out;
  }

  if (fromShift && toShift) {
    const startIdx = f * 3 + (shiftOrd(fromShift) - 1);
    const endIdx = t * 3 + (shiftOrd(toShift) - 1);
    const count = endIdx - startIdx + 1;
    const pEnd = startIdx - 1;
    const pStart = pEnd - count + 1;
    out.from = dayIso(Math.floor(pStart / 3));
    out.fromShift = SHIFTS[((pStart % 3) + 3) % 3]!;
    out.to = dayIso(Math.floor(pEnd / 3));
    out.toShift = SHIFTS[((pEnd % 3) + 3) % 3]!;
    return out;
  }

  const len = t - f + 1;
  out.to = dayIso(f - 1);
  out.from = dayIso(f - len);
  return out;
}
