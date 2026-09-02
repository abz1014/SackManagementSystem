/**
 * The ONE time selector the floor screens offer.
 *
 * IFL's complaint was that the app mixed last-24-hours, weekly, monthly and
 * "legacy" views and nobody could tell what period a number described. The
 * floor lists have exactly four scopes, all anchored on the PLANT clock the
 * /api/live endpoint reports (never the browser's), and every screen says
 * which one is active in plain words.
 *
 *   shift      — since the current shift began (live; grows as you watch)
 *   today      — the production day in progress, 06:00 to 06:00
 *   yesterday  — the previous production day
 *   day        — any one production day, picked from a calendar
 *
 * "Production day" is shift_date, the same value the sync worker stamps on
 * every row, so a day here is exactly a day in Records.
 */
import { addDays } from './fmt';

export type ScopeKey = 'shift' | 'today' | 'yesterday' | 'day';
export const SCOPE_KEYS: readonly ScopeKey[] = ['shift', 'today', 'yesterday', 'day'] as const;

export function parseScope(sub: string | undefined): ScopeKey {
  return (SCOPE_KEYS as readonly string[]).includes(sub ?? '') ? (sub as ScopeKey) : 'shift';
}

export interface ScopeAnchor {
  shiftStartUtc: string;
  shiftDate: string;
  plantNowUtc: string;
}

export interface ScopeWindow {
  from?: string;
  to?: string;
  tsFrom?: string;
  /** Always set: caps the window at the plant clock, which is what makes a
   *  replay (?at=) show only what existed at that moment. Harmless live. */
  tsTo: string;
  /** True when new rows can still arrive inside the window. */
  live: boolean;
}

export function scopeWindow(key: ScopeKey, a: ScopeAnchor, day?: string): ScopeWindow {
  switch (key) {
    case 'shift':
      return { tsFrom: a.shiftStartUtc, tsTo: a.plantNowUtc, live: true };
    case 'today':
      return { from: a.shiftDate, to: a.shiftDate, tsTo: a.plantNowUtc, live: true };
    case 'yesterday': {
      const d = addDays(a.shiftDate, -1);
      return { from: d, to: d, tsTo: a.plantNowUtc, live: false };
    }
    case 'day': {
      const d = day ?? a.shiftDate;
      return { from: d, to: d, tsTo: a.plantNowUtc, live: d >= a.shiftDate };
    }
  }
}
