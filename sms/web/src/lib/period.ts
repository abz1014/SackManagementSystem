/**
 * THE period. One control, in the header, obeyed by every screen.
 *
 * IFL's complaint was not that the app lacked date controls; it was that it had
 * seven of them and no two agreed. Records defaulted to the night shift of the
 * day before, Weight to the day before, Calibration to the whole record, and
 * Reasons had no date control at all — so a reader could not say what period
 * any number on the screen described. This module is the single answer, and no
 * screen may carry a date picker of its own.
 *
 * TWO RULES THAT ARE EASY TO GET WRONG, both learned the hard way:
 *
 * 1. THE CLOCK IS THE PLANT'S, NEVER THE BROWSER'S. Production timestamps are
 *    the plant's wall clock labelled as UTC. Every window here is anchored on
 *    what /api/live reports, so a laptop in another timezone — or one with a
 *    wrong clock — still resolves "today" to the same production day the sync
 *    worker stamped on the rows.
 *
 * 2. THE PERIOD DOES NOT DRIVE THE DETECTORS. Station drift, the attention
 *    list and the reject-episode detector run on DAILY means: the Nelson runs
 *    need six to fifteen consecutive days, and one shift is one point. Chained
 *    to a "This shift" period they would report "Fine" for every station while
 *    measuring nothing. They therefore use `trailingWindow()` instead, always,
 *    and say so on screen. The period governs counts, averages, the register,
 *    the distribution and the report — the things a person means when they ask
 *    "over what?".
 */
import { addDays } from './fmt';

export type PeriodKey = 'shift' | 'today' | 'yesterday' | 'week' | 'month' | 'pick';

export const PERIOD_KEYS: readonly PeriodKey[] = ['shift', 'today', 'yesterday', 'week', 'month', 'pick'] as const;

export type ShiftCode = 'morning' | 'evening' | 'night';

/**
 * Everything the resolver needs, all of it from /api/live so the plant's clock
 * is the only clock involved.
 */
export interface PeriodAnchor {
  /** Production day in progress (shift_date), the same value on every row. */
  shiftDate: string;
  shiftCode: ShiftCode;
  shiftStartUtc: string;
  /** The plant's wall clock at the last poll. */
  plantNowUtc: string;
  /** Newest reading on record. Null before anything has ever arrived. */
  dataAsOfUtc: string | null;
  /** Oldest production day held, so a window is never claimed wider than the record. */
  firstDay?: string | null;
}

export interface Period {
  key: PeriodKey;
  /** Production-day bounds, for the day-grained endpoints. Inclusive. */
  from: string;
  to: string;
  /** Instant bounds, for the register and anything counted to the minute. */
  tsFrom?: string;
  /**
   * Always set, and always the plant clock: it caps the window at the present,
   * which is what makes a replay (?at=) show only what existed at that moment.
   * Harmless when live.
   */
  tsTo: string;
  /** Set only when the period IS exactly one shift. */
  shift?: ShiftCode;
  /** New rows can still land inside this window. */
  live: boolean;
  /** Calendar days the window spans, inclusive. */
  days: number;
  /** For "Pick dates", so the control can show what was picked. */
  picked?: { from: string; to: string };
}

/* --------------------------------------------------------------- resolving */

/** Monday of the ISO week containing `date`. */
function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  // getUTCDay is 0 for Sunday; ISO weeks start on Monday.
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Never resolve a window that runs past the production day in progress. */
const clip = (date: string, notAfter: string) => (date > notAfter ? notAfter : date);

export function resolvePeriod(key: PeriodKey, a: PeriodAnchor, picked?: { from: string; to: string }): Period {
  const today = a.shiftDate;
  const tsTo = a.plantNowUtc;
  const base = { key, tsTo } as const;

  switch (key) {
    case 'shift':
      // A night shift spans two calendar dates; shift_date already resolves
      // that the same way the transform stamped it, so day bounds plus the
      // shift code select exactly the rows this shift produced.
      return { ...base, from: today, to: today, shift: a.shiftCode, tsFrom: a.shiftStartUtc, live: true, days: 1 };

    case 'today':
      return { ...base, from: today, to: today, live: true, days: 1 };

    case 'yesterday': {
      const d = addDays(today, -1);
      return { ...base, from: d, to: d, live: false, days: 1 };
    }

    case 'week': {
      const from = weekStart(today);
      return { ...base, from, to: today, live: true, days: daysBetween(from, today) };
    }

    case 'month': {
      const from = `${today.slice(0, 7)}-01`;
      return { ...base, from, to: today, live: true, days: daysBetween(from, today) };
    }

    case 'pick': {
      // A picked range is the one case the user can get backwards or push into
      // the future; both are corrected here rather than sent to the API.
      const rawFrom = picked?.from ?? today;
      const rawTo = picked?.to ?? rawFrom;
      const lo = clip(rawFrom <= rawTo ? rawFrom : rawTo, today);
      const hi = clip(rawFrom <= rawTo ? rawTo : rawFrom, today);
      return {
        ...base,
        from: lo,
        to: hi,
        live: hi >= today,
        days: daysBetween(lo, hi),
        picked: { from: lo, to: hi },
      };
    }
  }
}

/* --------------------------------------------------- the detectors' window */

/**
 * How much history the pattern tests are given, regardless of the period.
 *
 * Fourteen because that is what the per-station Nelson runs need to be capable
 * of firing at all: rule 2 wants nine points in a row on one side and rule 3
 * wants six trending, and a point is a DAY. Below about nine days the table can
 * only ever say "Fine", which would be a lie of omission on a station that has
 * read heavy all week.
 */
export const TRAILING_DAYS = 14;

export interface TrailingWindow {
  from: string;
  to: string;
  /** Calendar days requested. The screen states the days actually RETURNED. */
  requestedDays: number;
}

export function trailingWindow(a: PeriodAnchor, days = TRAILING_DAYS): TrailingWindow {
  const to = a.shiftDate;
  const wanted = addDays(to, -(days - 1));
  // Never claim a window that reaches back past the first day on record.
  const from = a.firstDay && a.firstDay > wanted ? a.firstDay : wanted;
  return { from, to, requestedDays: daysBetween(from, to) };
}

/**
 * How many distinct days in a set of DAY buckets actually hold readings.
 *
 * trailingWindow clamps at the first day on record and nowhere else — it cannot
 * see a hole in the middle. The record has one: nothing between 10 Jul and
 * 5 Aug 2026 (IFL rebuilt their tables; the month before it has not been
 * sent). A screen that says "the last 14 days" over that hole must also say how
 * many of them hold anything, or a two-day trend reads as a fortnight's.
 * Day buckets carry the shift date at midnight, so the date is the first ten
 * characters of bucketTs.
 */
export function daysWithReadings(buckets: ReadonlyArray<{ bucketTs: string; produced: number }>): number {
  return new Set(buckets.filter((b) => b.produced > 0).map((b) => b.bucketTs.slice(0, 10))).size;
}

/**
 * True when the selected period is too short for a screen to say anything.
 *
 * The screen must then SAY so — "One shift is too short to judge drift; showing
 * the last 14 days" — rather than print "Fine" over a window in which nothing
 * could have been measured, or draw a one-bar chart and call it a trend.
 */
export function tooShortFor(p: Period, minDays: number): boolean {
  return p.days < minDays;
}

/* ------------------------------------------------------------------- URL */

/**
 * The period travels in the URL, so it survives navigation between screens,
 * a refresh, and a link pasted to a colleague. That is the whole point of one
 * global control: the same period, everywhere, including in someone else's
 * browser.
 */
export interface PeriodParams {
  key: PeriodKey;
  picked?: { from: string; to: string };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePeriodParams(sp: URLSearchParams): PeriodParams {
  const raw = sp.get('p');
  const key: PeriodKey = (PERIOD_KEYS as readonly string[]).includes(raw ?? '') ? (raw as PeriodKey) : 'shift';
  if (key !== 'pick') return { key };
  const from = sp.get('from');
  const to = sp.get('to');
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) return { key, picked: { from, to } };
  // A malformed pick is not an error worth a message; it falls back to the
  // default rather than rendering an empty screen.
  return { key: 'shift' };
}

export function writePeriodParams(sp: URLSearchParams, p: PeriodParams): void {
  sp.set('p', p.key);
  sp.delete('from');
  sp.delete('to');
  if (p.key === 'pick' && p.picked) {
    sp.set('from', p.picked.from);
    sp.set('to', p.picked.to);
  }
}
