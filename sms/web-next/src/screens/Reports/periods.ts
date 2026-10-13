/**
 * The builder's quick periods, as the period parameters the one global period control already understands
 * (decision E-1 neighbours: the builder never keeps a second period; it writes the shared one).
 * Pure functions over production-day strings (YYYY-MM-DD), so they are testable without a clock.
 */
import { period as P } from '../../bridge/lib';

export type QuickPeriod = 'whole' | 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';

export const QUICK_ORDER: readonly QuickPeriod[] = ['whole', 'today', 'yesterday', 'week', 'month', 'lastMonth', 'custom'];

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First and last day of the calendar month before the one `today` is in. */
export function lastMonthOf(today: string): { from: string; to: string } {
  const first = `${today.slice(0, 7)}-01`;
  const to = addDays(first, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}

/**
 * The period parameters for a quick choice. `today` is the production day in progress; `range` the held record
 * (null while unknown). Null when the choice cannot be made yet (the whole range needs the record's ends).
 */
export function paramsForQuick(
  q: Exclude<QuickPeriod, 'custom'>,
  today: string,
  range: { minDate: string; maxDate: string } | null,
): P.PeriodParams | null {
  switch (q) {
    case 'today': return { key: 'today' };
    case 'yesterday': return { key: 'yesterday' };
    case 'month': return { key: 'month' };
    case 'week': return { key: 'pick', picked: { from: addDays(today, -6), to: today } };
    case 'lastMonth': return { key: 'pick', picked: lastMonthOf(today) };
    case 'whole': return range ? { key: 'pick', picked: { from: range.minDate, to: range.maxDate } } : null;
  }
}

export type ShiftChoice = '' | P.ShiftCode;

/**
 * The same days with the first and last shift narrowed. Both blank returns to whole days. Null when the range
 * reads backwards (the same day, the end shift before the start shift): the control then says so and changes nothing.
 */
export function withShifts(from: string, to: string, fromShift: ShiftChoice, toShift: ShiftChoice): P.PeriodParams | null {
  if (!fromShift && !toShift) return { key: 'pick', picked: { from, to } };
  const range = { from: { date: from, shift: fromShift || 'morning' } as P.ShiftRef, to: { date: to, shift: toShift || 'night' } as P.ShiftRef };
  return P.decodeRangeParams(P.encodeShiftRef(range.from), P.encodeShiftRef(range.to)) ? { key: 'range', range } : null;
}

/** Which quick choice, if any, the shown period still is (so the select says "Current period" otherwise). */
export function quickOf(period: P.Period | null, range: { minDate: string; maxDate: string } | null): QuickPeriod | null {
  if (!period) return null;
  if (period.key === 'today' || period.key === 'yesterday' || period.key === 'month') return period.key;
  if (period.key === 'pick' && range && period.from === range.minDate && period.to === range.maxDate) return 'whole';
  return null;
}
