/*
 * The one date and time format of the redesign (fix-wave plan T0, D15).
 *
 *   fmtDate      "1 Sep 2026"
 *   fmtDateTime  "1 Sep 2026, 21:33"
 *   fmtTime      "21:33"            fmtTimeSec "21:33:02"
 *   fmtDayShort  "Tue 1 Sep"
 *   fmtRange     "5 Aug 2026 – 7 Sep 2026"
 *
 * Built by hand from the date parts, 24-hour, English month names: Intl and
 * toLocale* are not used because en-GB's short September is "Sept" and 12-hour
 * clocks print "PM". lib/dates.guard (T6) keeps toLocale*String out of web-next.
 *
 * TWO CLOCKS (CLAUDE.md). Production timestamps are the plant's wall clock
 * labelled UTC, so the plain functions read UTC fields and are independent of
 * the viewer's zone. Instants this system wrote itself (sync passes, audit rows,
 * product timeline) are genuine UTC and are shown in the viewer's own zone: the
 * fmtApp* variants. Never pass one clock to the other's function.
 */
import { fmt as old } from '../bridge/lib';

export type Instant = string | number | Date;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const p2 = (n: number) => String(n).padStart(2, '0');

interface Parts { y: number; mo: number; d: number; wd: number; h: number; mi: number; s: number }

function toDate(at: Instant): Date {
  if (at instanceof Date) return at;
  // A bare production day ("2026-09-01") is read as that day, not shifted by a zone.
  return new Date(typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at);
}

const plant = (at: Instant): Parts | null => {
  const t = toDate(at);
  if (Number.isNaN(t.getTime())) return null;
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
};
const app = (at: Instant): Parts | null => {
  const t = toDate(at);
  if (Number.isNaN(t.getTime())) return null;
  return { y: t.getFullYear(), mo: t.getMonth(), d: t.getDate(), wd: t.getDay(), h: t.getHours(), mi: t.getMinutes(), s: t.getSeconds() };
};

const DASH = '–';
const date = (x: Parts) => `${x.d} ${MONTHS[x.mo]} ${x.y}`;
const time = (x: Parts) => `${p2(x.h)}:${p2(x.mi)}`;
const timeSec = (x: Parts) => `${time(x)}:${p2(x.s)}`;
const day = (x: Parts) => `${DAYS[x.wd]} ${x.d} ${MONTHS[x.mo]}`;

function make(read: (at: Instant) => Parts | null) {
  return {
    date: (at: Instant) => { const x = read(at); return x ? date(x) : DASH; },
    dateTime: (at: Instant) => { const x = read(at); return x ? `${date(x)}, ${time(x)}` : DASH; },
    time: (at: Instant) => { const x = read(at); return x ? time(x) : DASH; },
    timeSec: (at: Instant) => { const x = read(at); return x ? timeSec(x) : DASH; },
    dayShort: (at: Instant) => { const x = read(at); return x ? day(x) : DASH; },
  };
}
const P = make(plant);
const A = make(app);

/** Plant clock: "1 Sep 2026". */
export const fmtDate = P.date;
/** Plant clock: "1 Sep 2026, 21:33". */
export const fmtDateTime = P.dateTime;
/** Plant clock: "21:33". */
export const fmtTime = P.time;
/** Plant clock: "21:33:02". */
export const fmtTimeSec = P.timeSec;
/** Plant clock: "Tue 1 Sep". */
export const fmtDayShort = P.dayShort;
/** Plant clock: "5 Aug 2026 – 7 Sep 2026" (one date when both ends are the same day). */
export function fmtRange(from: Instant, to: Instant): string {
  const a = fmtDate(from);
  const b = fmtDate(to);
  return a === b ? a : `${a} ${DASH} ${b}`;
}

/** App-written instant, viewer's zone: "1 Sep 2026". */
export const fmtAppDate = A.date;
/** App-written instant, viewer's zone: "1 Sep 2026, 21:33". */
export const fmtAppDateTime = A.dateTime;
/** App-written instant, viewer's zone: "21:33". */
export const fmtAppTime = A.time;
/** App-written instant, viewer's zone: "21:33:02". */
export const fmtAppTimeSec = A.timeSec;
/** App-written instant, viewer's zone: "Tue 1 Sep". */
export const fmtAppDayShort = A.dayShort;

/* Number and duration helpers stay the old app's, re-exported so a screen imports one module. */
export const fmtInt = old.fmtInt;
export const fmtKg = old.fmtKg;
export const fmtG = old.fmtG;
export const fmtPct1 = old.fmtPct1;
export const fmtSpan = old.fmtSpan;
export const fmtAgo = old.fmtAgo;
export const kgParts = old.kgParts;
export const gParts = old.gParts;
export const addDays = old.addDays;
