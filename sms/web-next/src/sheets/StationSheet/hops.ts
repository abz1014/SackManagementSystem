/**
 * The four hops out of the station sheet (TRACE A6-H01, H02, H03, H07; IA-MAP section 5).
 * A hop carries state, it does not just switch screen: the station travels in `st`, the period
 * keys stay, the sheet closes, and the keys that belong to the screen being left (page, listing,
 * filter, reason code) are dropped so the destination opens fresh on this station.
 */
import { writeRoute, type Route } from '../../route';

export type HopKind = 'register' | 'rejects' | 'calibration' | 'machineProduct';

const LEFT_BEHIND = ['rp', 'rf', 'rl', 'rcs', 'jc'] as const;

export function hopRoute(route: Route, kind: HopKind, station: number): Route {
  const keys: Record<string, string> = { ...route.keys };
  for (const k of LEFT_BEHIND) delete keys[k];
  keys.st = String(station);
  switch (kind) {
    case 'register':
      return { ...route, s: 'quality', t: 'register', sheet: null, wall: false, keys };
    case 'rejects':
      return { ...route, s: 'quality', t: 'rejects', sheet: null, wall: false, keys };
    case 'calibration':
      return { ...route, s: 'reports', t: null, sheet: null, wall: false, keys: { ...keys, rt: 'calibration' } };
    default:
      return { ...route, s: 'reports', t: null, sheet: null, wall: false, keys: { ...keys, rt: 'machine-product' } };
  }
}

/** A real href (middle-click and copy-link work); the click itself goes through `go`. */
export function hopHref(r: Route): string {
  const qs = writeRoute(r).toString();
  return `${window.location.pathname}${qs ? `?${qs}` : ''}`;
}
