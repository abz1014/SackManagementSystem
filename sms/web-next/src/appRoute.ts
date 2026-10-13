/**
 * The frame's view of the URL: read it, rewrite legacy links, gate by rank.
 * Pure `resolveLocation` (testable in node) plus the small browser plumbing around it.
 * route.ts owns the URL model; this file only decides what to show for a given
 * location and rank.
 */
import { useEffect, useState } from 'react';
import { legacyRedirect, parseRoute, writeRoute, type Route } from './route';

/** The same event data/usePeriod.ts fires, so a period change and a navigation re-render together. */
export const URL_EVENT = 'sms-next:urlchange';

export interface Resolved {
  route: Route;
  /** Dev-only component gallery (?s=gallery); never true when `dev` is false. */
  gallery: boolean;
  /** The query to replace the address with (legacy link or forbidden tab), or null when it is already right. */
  canonical: string | null;
}

export function todayRoute(from: Route): Route {
  return { s: 'today', t: null, sheet: null, wall: false, keys: from.keys };
}

export function galleryEnabled(dev: boolean = import.meta.env.DEV): boolean {
  return dev === true;
}

export function resolveLocation(search: string, _rank: number, dev: boolean = import.meta.env.DEV): Resolved {
  const sp = new URLSearchParams(search);
  if (galleryEnabled(dev) && sp.get('s') === 'gallery') {
    return { route: parseRoute(new URLSearchParams()), gallery: true, canonical: null };
  }
  const redirected = legacyRedirect(sp);
  const route = parseRoute(redirected ?? sp);
  /* Fix-wave P4: Setup below rank 4 is not redirected. The screen itself says it is for an administrator and draws no section. */
  return { route, gallery: false, canonical: redirected !== null ? writeRoute(route).toString() : null };
}

/** window.location.search, kept current across popstate and this app's own navigations. */
export function useLocationSearch(): string {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const on = () => setSearch(window.location.search);
    window.addEventListener('popstate', on);
    window.addEventListener(URL_EVENT, on);
    on();
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(URL_EVENT, on);
    };
  }, []);
  return search;
}

/** Push (default) or replace the address with `next`. */
export function navigate(next: Route, opts?: { replace?: boolean }): void {
  const url = `${window.location.pathname}?${writeRoute(next).toString()}`;
  if (opts?.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(URL_EVENT));
}

/** Replace the query with an already-serialised one (legacy rewrite, forbidden tab). */
export function replaceQuery(query: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
  window.dispatchEvent(new Event(URL_EVENT));
}
