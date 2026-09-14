/**
 * The shift-boundary check the Setup form runs BEFORE it submits.
 *
 * The server refuses three starts that are not in order (shift.ts's
 * `shiftBoundariesFrom` returns null unless morning < evening < night), so
 * this is not the authority — it exists so the form can say "morning must
 * start before evening" the moment the admin types it, rather than after a
 * round trip that answers `invalid`.
 *
 * Deliberately a copy of the shared package's parse, not an import: the web
 * bundle has never depended on @sms/shared, and a first cross-workspace
 * import is a build decision, not a form's. Same regex, same semantics; the
 * test pins them so the two cannot drift silently. (14 Sep 2026)
 */

/** 'HH:MM' (24 h) → minutes from midnight; null when malformed. */
export function parseShiftTime(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type ShiftOrderProblem = 'malformed' | 'out_of_order' | null;

/**
 * Why the three starts cannot be submitted, or null when they can.
 * 'malformed' wins over 'out_of_order': an empty field is not "in the wrong
 * order", it is missing.
 */
export function shiftOrderProblem(morning: string, evening: string, night: string): ShiftOrderProblem {
  const ms = parseShiftTime(morning);
  const es = parseShiftTime(evening);
  const ns = parseShiftTime(night);
  if (ms == null || es == null || ns == null) return 'malformed';
  return ms < es && es < ns ? null : 'out_of_order';
}
