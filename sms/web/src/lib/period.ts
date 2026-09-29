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

export type PeriodKey = 'shift' | 'today' | 'yesterday' | 'week' | 'month' | 'pick' | 'range';

export const PERIOD_KEYS: readonly PeriodKey[] = ['shift', 'today', 'yesterday', 'week', 'month', 'pick', 'range'] as const;

export type ShiftCode = 'morning' | 'evening' | 'night';

/**
 * Chart overhaul T0 (28 Sep 2026): the type a chart drag-select produces.
 * Alias of ShiftCode — same three values, named for the new call sites
 * (snapToShifts, ShiftRef) so this module's shift vocabulary reads as one
 * thing rather than two coincidentally-identical unions.
 */
export type ShiftName = ShiftCode;

/** One shift, unambiguously: the production day it BELONGS TO (the day it
 *  starts on — night's own shift_date convention) plus which of the three it
 *  is. This is the unit a chart drag snaps to and the URL range encodes. */
export interface ShiftRef {
  date: string;
  shift: ShiftName;
}

const SHIFT_ORDER: readonly ShiftName[] = ['morning', 'evening', 'night'] as const;
const SHIFT_START_HOUR: Record<ShiftName, number> = { morning: 6, evening: 14, night: 22 };

/** Sortable key: fixed-width date plus a single ordering digit, so plain
 *  string comparison orders any two ShiftRefs correctly. */
function shiftRefKey(r: ShiftRef): string {
  return `${r.date}#${SHIFT_ORDER.indexOf(r.shift)}`;
}

/** The instant (plant clock, labelled UTC) a shift begins. */
function shiftStartUtc(r: ShiftRef): string {
  const h = String(SHIFT_START_HOUR[r.shift]).padStart(2, '0');
  return `${r.date}T${h}:00:00.000Z`;
}

/** The instant (plant clock, labelled UTC) a shift ends — the next shift's
 *  start, or, for night, 06:00 on the day after the one it belongs to. */
function shiftEndUtc(r: ShiftRef): string {
  const idx = SHIFT_ORDER.indexOf(r.shift);
  if (idx < SHIFT_ORDER.length - 1) return shiftStartUtc({ date: r.date, shift: SHIFT_ORDER[idx + 1]! });
  return shiftStartUtc({ date: addDays(r.date, 1), shift: 'morning' });
}

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
  /** Set only when the period IS exactly one shift (key 'shift', or key
   *  'range' whose from/to resolve to the same single shift). */
  shift?: ShiftCode;
  /** New rows can still land inside this window. */
  live: boolean;
  /** Calendar days the window spans, inclusive. */
  days: number;
  /** For "Pick dates", so the control can show what was picked. */
  picked?: { from: string; to: string };
  /** Set only for key 'range': the shift-bounded endpoints a chart drag
   *  produced (or that were restored from the URL). */
  fromShift?: ShiftRef;
  toShift?: ShiftRef;
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

export function resolvePeriod(
  key: PeriodKey,
  a: PeriodAnchor,
  picked?: { from: string; to: string },
  range?: { from: ShiftRef; to: ShiftRef },
): Period {
  const today = a.shiftDate;
  const tsTo = a.plantNowUtc;
  const base = { key, tsTo } as const;

  switch (key) {
    case 'range': {
      // No range given (URL lost it, or the caller hasn't picked one yet):
      // degrade to the current shift rather than throw — the same shape
      // 'shift' already returns, just carrying key 'range' so a caller can
      // tell a drag-select is in play.
      if (!range) {
        const s = resolvePeriod('shift', a);
        return { ...s, key: 'range', fromShift: { date: today, shift: a.shiftCode }, toShift: { date: today, shift: a.shiftCode } };
      }
      const { from, to } = range;
      const sameShift = from.date === to.date && from.shift === to.shift;
      const current: ShiftRef = { date: a.shiftDate, shift: a.shiftCode };
      const live = shiftRefKey(from) <= shiftRefKey(current) && shiftRefKey(current) <= shiftRefKey(to);
      const rangeEndUtc = shiftEndUtc(to);
      return {
        ...base,
        from: from.date,
        to: to.date,
        tsFrom: shiftStartUtc(from),
        // Cap at the plant clock, same replay-cap rule every other key
        // follows: a selected range cannot report rows that do not exist yet.
        tsTo: rangeEndUtc < a.plantNowUtc ? rangeEndUtc : a.plantNowUtc,
        shift: sameShift ? from.shift : undefined,
        fromShift: from,
        toShift: to,
        live,
        days: daysBetween(from.date, to.date),
      };
    }
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

/**
 * Snaps a chart drag-select's two endpoints (in either order — a drag can run
 * left-to-right or right-to-left) to a whole-page 'range' period. Order-
 * independent: whichever of `first`/`last` is earlier becomes `range.from`.
 * Returns null, rather than a PeriodParams identical to what is already
 * selected, so a caller can skip a pointless navigation/refetch — e.g. a
 * drag that starts and ends inside the shift already shown.
 */
export function snapToShifts(first: ShiftRef, last: ShiftRef, current?: PeriodParams): PeriodParams | null {
  const firstIsEarlier = shiftRefKey(first) <= shiftRefKey(last);
  const from = firstIsEarlier ? first : last;
  const to = firstIsEarlier ? last : first;
  if (
    current?.key === 'range' &&
    current.range &&
    current.range.from.date === from.date &&
    current.range.from.shift === from.shift &&
    current.range.to.date === to.date &&
    current.range.to.shift === to.shift
  ) {
    return null;
  }
  return { key: 'range', range: { from, to } };
}

/** The full-day span D1.morning .. D2.night for two production days, in
 *  whichever order they were given — the shift-range equivalent of a plain
 *  day picker's [from, to]. Feed the result to snapToShifts to get a
 *  PeriodParams (dayToShiftRange never itself no-ops against `current`). */
export function dayToShiftRange(fromDate: string, toDate: string): { from: ShiftRef; to: ShiftRef } {
  const lo = fromDate <= toDate ? fromDate : toDate;
  const hi = fromDate <= toDate ? toDate : fromDate;
  return { from: { date: lo, shift: 'morning' }, to: { date: hi, shift: 'night' } };
}

const SHIFT_LABEL: Record<ShiftName, string> = { morning: 'morning', evening: 'evening', night: 'night' };

/** "2 Sep" — day and short month only, no weekday, no year (a period is
 *  always within one plant record, never ambiguous across years in practice).
 *  Built by hand, the same workaround fmt.ts's fmtClockOn uses: en-GB's short
 *  month is "Sept" in current ICU, not "Sep". Plant time is stated elsewhere
 *  (Health), never repeated per period. */
function shortDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const month = d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
  return `${d.getUTCDate()} ${month}`;
}

/**
 * The period, in the plain words a reader (not a developer) can act on:
 *
 *   "2 Sep, evening shift"                     — exactly one shift: key 'shift', or a
 *                                                 'range' whose from/to are the same
 *                                                 shift on the same date
 *   "2 Sep"                                     — a single whole day: today/yesterday/a
 *                                                 one-day pick, or a 'range' that runs
 *                                                 the same date's morning shift through
 *                                                 its own night shift
 *   "2 Sep – 3 Sep"                             — a multi-day span: week/month/pick, or
 *                                                 a 'range' that runs morning..night
 *                                                 across more than one date
 *   "2 Sep morning shift – 3 Sep night shift"  — any other 'range' (partial shifts at
 *                                                 either end)
 *
 * (owner 29 Sep: collapse — the range branch used to print the last form
 * unconditionally, so a same-shift or whole-day range never collapsed to the
 * shorter phrasing the other period kinds already use.)
 */
export function describePeriod(p: Period): string {
  if (p.key === 'range' && p.fromShift && p.toShift) {
    const { fromShift: from, toShift: to } = p;
    const sameDate = from.date === to.date;
    if (sameDate && from.shift === to.shift) return `${shortDate(from.date)}, ${SHIFT_LABEL[from.shift]} shift`;
    if (from.shift === 'morning' && to.shift === 'night') {
      return sameDate ? shortDate(from.date) : `${shortDate(from.date)} – ${shortDate(to.date)}`;
    }
    return `${shortDate(from.date)} ${SHIFT_LABEL[from.shift]} shift – ${shortDate(to.date)} ${SHIFT_LABEL[to.shift]} shift`;
  }
  if (p.shift) return `${shortDate(p.from)}, ${SHIFT_LABEL[p.shift]} shift`;
  if (p.from === p.to) return shortDate(p.from);
  return `${shortDate(p.from)} – ${shortDate(p.to)}`;
}

/**
 * Every fetch's period-scoped query params in one object, so a caller does
 * `{...periodQuery(period), ...otherFilters}` instead of re-deriving from/to/
 * shift by hand at each call site. `fromShift`/`toShift` are the URL-ready
 * encoded form (see encodeShiftRef) because that is what ends up in a
 * URLSearchParams either way; the API does not accept them yet (T0, 28 Sep
 * 2026) but passing them is harmless until it does, and each api.ts function
 * that takes from/to now forwards them.
 */
export interface PeriodQuery {
  from: string;
  to: string;
  shift?: ShiftCode;
  fromShift?: string;
  toShift?: string;
  tsTo?: string;
}

export function periodQuery(p: Period): PeriodQuery {
  const q: PeriodQuery = { from: p.from, to: p.to, tsTo: p.tsTo };
  if (p.shift) q.shift = p.shift;
  if (p.fromShift) q.fromShift = encodeShiftRef(p.fromShift);
  if (p.toShift) q.toShift = encodeShiftRef(p.toShift);
  return q;
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
  /** Set only for key 'range'. */
  range?: { from: ShiftRef; to: ShiftRef };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHIFT_REF_RE = /^(\d{4}-\d{2}-\d{2})\.(morning|evening|night)$/;

/**
 * "2026-09-02.morning" — the URL form of one ShiftRef. Never '#': the period
 * lives in the query string like every other param here, not a fragment, so
 * it survives a server round-trip and a pasted link the same way `p=`/
 * `from=`/`to=` already do.
 */
export function encodeShiftRef(ref: ShiftRef): string {
  return `${ref.date}.${ref.shift}`;
}

function decodeShiftRef(raw: string | null): ShiftRef | null {
  const m = raw ? SHIFT_REF_RE.exec(raw) : null;
  return m ? { date: m[1]!, shift: m[2] as ShiftName } : null;
}

/** `{from, to}` ready to assign onto a URLSearchParams as `from=`/`to=`. */
export function encodeRangeParams(range: { from: ShiftRef; to: ShiftRef }): { from: string; to: string } {
  return { from: encodeShiftRef(range.from), to: encodeShiftRef(range.to) };
}

/**
 * The inverse: raw `from=`/`to=` query values back to a range. Null on
 * anything malformed (bad date, unknown shift name, missing side) or on a
 * start strictly after the end — a caller falls back to the default period
 * exactly as parsePeriodParams already does for a malformed 'pick'.
 */
export function decodeRangeParams(rawFrom: string | null, rawTo: string | null): { from: ShiftRef; to: ShiftRef } | null {
  const from = decodeShiftRef(rawFrom);
  const to = decodeShiftRef(rawTo);
  if (!from || !to) return null;
  if (shiftRefKey(from) > shiftRefKey(to)) return null;
  return { from, to };
}

export function parsePeriodParams(sp: URLSearchParams): PeriodParams {
  const raw = sp.get('p');
  const key: PeriodKey = (PERIOD_KEYS as readonly string[]).includes(raw ?? '') ? (raw as PeriodKey) : 'shift';
  if (key === 'range') {
    const range = decodeRangeParams(sp.get('from'), sp.get('to'));
    if (range) return { key, range };
    // A malformed range is not an error worth a message; it falls back to
    // the default rather than rendering an empty screen (same rule as pick).
    return { key: 'shift' };
  }
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
  if (p.key === 'range' && p.range) {
    const enc = encodeRangeParams(p.range);
    sp.set('from', enc.from);
    sp.set('to', enc.to);
  }
}

/**
 * True when two PeriodParams describe the same period — same key, and for
 * 'pick'/'range' the same bounds too. Used to skip a no-op zoom: clicking a
 * chart region that already matches the period on screen should not push a
 * new history entry (owner 29 Sep 2026).
 */
export function samePeriodParams(a: PeriodParams, b: PeriodParams): boolean {
  if (a.key !== b.key) return false;
  if (a.key === 'pick') {
    return a.picked?.from === b.picked?.from && a.picked?.to === b.picked?.to;
  }
  if (a.key === 'range') {
    const ar = a.range;
    const br = b.range;
    if (!ar || !br) return ar === br;
    return (
      ar.from.date === br.from.date &&
      ar.from.shift === br.from.shift &&
      ar.to.date === br.to.date &&
      ar.to.shift === br.to.shift
    );
  }
  return true;
}
