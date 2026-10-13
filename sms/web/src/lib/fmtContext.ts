/**
 * Date and time formatting as a React context, so the redesign (web-next) can draw the old report and Setup renderers
 * with its own one date format without changing how the old app prints them.
 *
 * The DEFAULT value is the old app's own formatting (the same functions, or exact copies of the two that live in
 * screens/report), so the old app, which never mounts a provider, prints byte-for-byte what it printed before.
 * web-next's ReportDocument and SetupScreen mount a provider with lib/fmt-backed functions.
 *
 * TWO CLOCKS: clock/clockSec/dayLong/dayShort/plantInstant take the plant's wall clock labelled UTC;
 * appInstant takes a genuine UTC instant written by this system and shows it in the viewer's zone.
 */
import { createContext, useContext } from 'react';
import { fmtAppInstant, fmtClock, fmtClockSec, fmtDayLong } from './fmt';

export interface DateFmt {
  /** Plant time of day. Old: "5:53 PM". */
  clock: (iso: string) => string;
  /** Plant time of day with seconds. Old: "5:53:36 PM". */
  clockSec: (iso: string) => string;
  /** A production day (YYYY-MM-DD or ISO). Old: "Thursday 9 July 2026". */
  dayLong: (day: string) => string;
  /** A bar label for a production day. Old: "31 Aug" (the report renderers' own, not lib/fmt's fmtDay). */
  dayShort: (day: string) => string;
  /** The plant instant a report was generated. Old: "15 Sep 2026, 14:03". */
  plantInstant: (iso: string) => string;
  /** An instant this system wrote, in the viewer's zone. Old: "14/09/2026, 10:34:12". */
  appInstant: (iso: string) => string;
}

export const OLD_DATE_FMT: DateFmt = {
  clock: fmtClock,
  clockSec: fmtClockSec,
  dayLong: fmtDayLong,
  // Exact copy of screens/report/shared.tsx fmtDayShort.
  dayShort: (day) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }),
  // Exact copy of screens/report/PrintHead.tsx fmtPlantInstant.
  plantInstant: (iso) =>
    new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  appInstant: fmtAppInstant,
};

export const DateFmtContext = createContext<DateFmt>(OLD_DATE_FMT);

/** The date formatting in force for this subtree. Outside a provider: the old app's own. */
export function useDateFmt(): DateFmt {
  return useContext(DateFmtContext);
}
