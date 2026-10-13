/**
 * The redesign's date format for the old report and Setup renderers (fix-wave T4, D15). The old components read their
 * date formatting from a context whose default is the old app's own (web/src/lib/fmtContext.ts); this provider swaps in
 * lib/fmt so a report page, the verdict, chart labels and Setup's audit log all print "1 Sep 2026" and 24-hour times.
 * TWO CLOCKS are kept: clock/day functions read the plant clock, appInstant shows the viewer's zone.
 *
 * RESERVED (owner decision 13 Oct 2026, confirming owner 30 Sep): IFL report tables and mastheads keep IFL house style,
 * "01-09-2026" and "01-09-2026 21:33" (fmtDayDmy / fmtAppInstantDmy in the IFL renderers, dayStamp / plantStamp here).
 * Everything that is not an IFL report (the Register's print header, Setup, chart labels) uses lib/fmt.
 */
import type { ReactNode } from 'react';
import { DateFmtContext, type DateFmt } from '../../../web/src/lib/fmtContext';
import { fmtDmy, fmtPlantDmyTime } from '../../../web/src/screens/report/PrintHead';
import { fmtAppDateTime, fmtDate, fmtDateTime, fmtTime, fmtTimeSec } from '../lib/fmt';

/** "1 Sep": a bar label, the day and month only. */
const dayMonth = (day: string): string => fmtDate(day).replace(/ \d{4}$/, '');

/** For the Reports tab: IFL report pages and mastheads, IFL house style kept for the masthead stamps. */
export const NEXT_DATE_FMT: DateFmt = {
  clock: fmtTime,
  clockSec: fmtTimeSec,
  dayLong: fmtDate,
  dayShort: dayMonth,
  plantInstant: fmtDateTime,
  appInstant: fmtAppDateTime,
  dayStamp: fmtDmy,
  plantStamp: fmtPlantDmyTime,
};

/** For a print header that is not an IFL report (the Register): the app's one format everywhere. */
export const NON_IFL_DATE_FMT: DateFmt = { ...NEXT_DATE_FMT, dayStamp: fmtDate, plantStamp: fmtDateTime };

export function NextDateFmt({ children }: { children: ReactNode }) {
  return <DateFmtContext.Provider value={NEXT_DATE_FMT}>{children}</DateFmtContext.Provider>;
}

export function NonIflDateFmt({ children }: { children: ReactNode }) {
  return <DateFmtContext.Provider value={NON_IFL_DATE_FMT}>{children}</DateFmtContext.Provider>;
}
