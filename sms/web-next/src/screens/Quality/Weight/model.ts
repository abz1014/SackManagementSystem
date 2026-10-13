/**
 * Pure helpers for Quality > Weight: URL keys, the two hops, labels. No fetching and no business
 * rules (those stay in the API and in the bridged libraries).
 */
import type { Route } from '../../../route';
import type { SpcType } from '../../../bridge/api';
import { fmtDate, fmtDateTime, fmtTime } from '../../../lib/fmt';

/** URL key `wm`. null = the period-conditional default (a day or less: spread; longer: over time). */
export type WeightMode = 'time' | 'dist';

export function readMode(keys: Record<string, string>): WeightMode | null {
  return keys.wm === 'dist' ? 'dist' : keys.wm === 'time' ? 'time' : null;
}

/** An explicit `wm` always wins over the default. */
export function resolveMode(explicit: WeightMode | null, days: number): WeightMode {
  if (explicit) return explicit;
  return days <= 1 ? 'dist' : 'time';
}

/** URL key `wt`, default cone. */
export function readChartType(keys: Record<string, string>): SpcType {
  return keys.wt === 'sack' ? 'sack' : 'cone';
}

/** URL key `st`: a positive whole station number, or null. */
export function readStation(keys: Record<string, string>): number | null {
  const n = Number(keys.st);
  return keys.st !== undefined && Number.isInteger(n) && n > 0 ? n : null;
}

/** The route with these keys set (a null value removes the key). Every other key is kept. */
export function withKeys(route: Route, patch: Record<string, string | null>): Route {
  const keys = { ...route.keys };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete keys[k];
    else keys[k] = v;
  }
  return { ...route, keys };
}

const OWN_KEYS = ['wm', 'wt', 'st'];

function without(keys: Record<string, string>, drop: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(keys).filter(([k]) => !drop.includes(k)));
}

/**
 * Hop: "see the cones outside the product's limits". Lands on Quality > Register with the
 * outside-limits filter and the cones listing, carrying the period; the chart keys and any stale
 * register page do not travel.
 */
export function outsideLimitsHop(route: Route): Route {
  return {
    ...route,
    t: 'register',
    sheet: null,
    keys: { ...without(route.keys, [...OWN_KEYS, 'rp', 'rs', 'rcs']), rf: 'outsideLimits', rl: 'cones' },
  };
}

/** Hop: the station table (Quality > Stations), same period. */
export function stationsHop(route: Route): Route {
  return { ...route, t: 'stations', sheet: null, keys: without(route.keys, ['wm', 'wt']) };
}

/** Hop: one station's sheet, over the same screen. */
export function stationSheetHop(route: Route, station: number): Route {
  return { ...route, sheet: { kind: 'station', id: String(station) } };
}


/** A group's axis label from its plant-clock ISO start: "06:00" within a day, "5 Aug" across days. */
export function groupLabel(ts: string, multiDay: boolean): string {
  if (Number.isNaN(new Date(ts).getTime())) return '';
  if (!multiDay) return fmtTime(ts);
  return fmtDate(ts).replace(/ \d{4}$/, '');
}

/** Heading of a group in the tooltip: "5 Aug 06:00" . */
export function groupHeading(ts: string): string {
  if (Number.isNaN(new Date(ts).getTime())) return '';
  return fmtDateTime(ts);
}

/** Signed one-decimal grams for the offset figure: "−8.2", "+1.9", "0.0". */
export function signed1(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
}

/** True for a count that is present and above zero (narrows away null and undefined; absence is never read as zero). */
export function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && n > 0;
}
