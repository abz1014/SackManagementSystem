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
