import { period as P } from '../bridge/lib';
import { fmtDate, fmtRange } from './fmt';

/**
 * The selected period in words, the same wording as the PeriodChip: a shift or a
 * shift range is named as one ("14 Oct, evening shift"), whole days as dates.
 * Every page sub-line that names the period uses this, so none can say "1 production
 * day" over figures that belong to one shift.
 */
export function periodWords(p: P.Period): string {
  if (p.shift || p.fromShift || p.toShift) return P.describePeriod(p);
  return p.from === p.to ? fmtDate(p.from) : fmtRange(p.from, p.to);
}

/** True when the figures cover less than whole production days (a shift, or a range ending on a shift boundary). */
export function isShiftBounded(p: P.Period): boolean {
  if (p.shift) return true;
  if (p.fromShift && p.toShift) return !(p.fromShift.shift === 'morning' && p.toShift.shift === 'night');
  return false;
}
