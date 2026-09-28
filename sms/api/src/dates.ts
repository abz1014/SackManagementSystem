/**
 * The one place a plain YYYY-MM-DD date string is validated in this API.
 *
 * Before this file existed, every route defined its own
 * `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` — a regex checks SHAPE, not
 * whether the date is real. `2026-02-30` (February has 28/29 days) matches
 * the regex, passes validation, reaches the SQL layer as a literal string,
 * and comes back as a 200 with rows silently filtered to nothing by every
 * `WHERE ProductionDate >= @from AND ProductionDate <= @to` comparison —
 * indistinguishable on screen from "no production that day". The caller
 * never sees an error for typing an impossible date.
 *
 * `isoDate` fixes this by validating the same shape, then re-parsing the
 * string as a real calendar date and checking it round-trips exactly —
 * `new Date('2026-02-30T00:00:00Z')` normalizes to 2026-03-02, so re-slicing
 * its own ISO string and comparing it back to the input catches the
 * impossible date without hand-rolling a per-month/leap-year table.
 */
import { z } from 'zod';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a real calendar date');

/**
 * RT-016: every `.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)`
 * timestamp param across the app had the identical shape-only flaw `isoDate`
 * already fixed for plain dates — `2026-13-45T25:99:99Z` matches no shape
 * regex used here, but `2026-02-31T10:00:00Z` and `2026-01-01T24:00:00Z` do,
 * and both reach the driver as a `new Date(...)` that is either silently
 * rolled over (Feb 31 -> Mar 3) or genuinely `Invalid Date`, which crashes
 * the Tedious driver with a raw internal stack trace instead of a 400.
 *
 * Same technique as `isoDate`: check the shape, then round-trip through
 * `Date` and compare the Y-M-D-h-m-s fields back against the input. The
 * input's milliseconds are normalized to exactly 3 digits first (`.toISOString()`
 * always emits 3), since `.1Z` and `.100Z` name the same instant but would
 * otherwise fail a naive string compare.
 */
export const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected ISO timestamp')
  .refine((s) => {
    // The .regex() check above runs independently of this .refine() (zod
    // does not short-circuit a ZodEffects chain on an earlier failing
    // check), so a shape-invalid string — no `T`, missing `Z`, wrong
    // punctuation — reaches here too. Re-match rather than assume the shape
    // is already good; a non-match just fails the refinement, same as any
    // other invalid value, instead of crashing on `undefined.slice(...)`.
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(s);
    if (!m) return false;
    const [, datePart, timeCore, msDigits] = m;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return false;
    const normalizedMs = (msDigits ?? '0').padEnd(3, '0');
    const normalized = `${datePart}T${timeCore}.${normalizedMs}Z`;
    return d.toISOString() === normalized;
  }, 'That date or time does not exist.');
