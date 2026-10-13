/**
 * The redesign's date format for the old report and Setup renderers (fix-wave T4, D15). The old components read their
 * date formatting from a context whose default is the old app's own (web/src/lib/fmtContext.ts); this provider swaps in
 * lib/fmt so a report page, the verdict, chart labels and Setup's audit log all print "1 Sep 2026" and 24-hour times.
 * TWO CLOCKS are kept: clock/day functions read the plant clock, appInstant shows the viewer's zone.
 */
import type { ReactNode } from 'react';
import { DateFmtContext, type DateFmt } from '../../../web/src/lib/fmtContext';
import { fmtAppDateTime, fmtDate, fmtDateTime, fmtTime, fmtTimeSec } from '../lib/fmt';

/** "1 Sep": a bar label, the day and month only. */
const dayMonth = (day: string): string => fmtDate(day).replace(/ \d{4}$/, '');

export const NEXT_DATE_FMT: DateFmt = {
  clock: fmtTime,
  clockSec: fmtTimeSec,
  dayLong: fmtDate,
  dayShort: dayMonth,
  plantInstant: fmtDateTime,
  appInstant: fmtAppDateTime,
};

export function NextDateFmt({ children }: { children: ReactNode }) {
  return <DateFmtContext.Provider value={NEXT_DATE_FMT}>{children}</DateFmtContext.Provider>;
}
