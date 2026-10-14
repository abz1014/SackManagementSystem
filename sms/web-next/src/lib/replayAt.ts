/**
 * The replay instant (`?at=`). Plant timestamps are the plant's wall clock labelled UTC (TWO CLOCKS), so a value typed
 * without a zone means plant wall time and gets the same "Z" the API wants. A value that is no date-time at all is
 * named as unreadable (never sent to the API, never a blank error).
 */
export type ReplayAt =
  | { kind: 'none' }
  | { kind: 'ok'; value: string }
  | { kind: 'bad'; raw: string };

const FULL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z)?$/;

export function normalizeAt(raw: string | null | undefined): ReplayAt {
  if (raw === null || raw === undefined || raw === '') return { kind: 'none' };
  const m = FULL.exec(raw.trim());
  if (!m) return { kind: 'bad', raw };
  const [, y, mo, d, h, mi, s = '00', frac = ''] = m;
  const value = `${y}-${mo}-${d}T${h}:${mi}:${s}${frac}Z`;
  const t = new Date(value);
  // Date.parse rolls 31 Feb over; a calendar date that does not exist is unreadable, not "March".
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return { kind: 'bad', raw };
  return { kind: 'ok', value };
}
