import { C } from '../copy';
import { defaultTab, writeRoute, type Route, type Screen } from '../route';
import type { IconName } from './Icon';

export const ADMIN_RANK = 4;

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  s: Screen;
  t: string | null;
  /** The item is absent below this rank (never greyed). */
  minRank: number;
}
export interface NavGroup { id: string; label: string; items: NavItem[] }

const item = (id: string, label: string, icon: IconName, s: Screen, t: string | null, minRank = 1): NavItem => ({
  id, label, icon, s, t, minRank,
});

/** The approved IA (DESIGN-SYSTEM 6.2): Monitor, Operate, Analyse, System. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'monitor', label: C.shell.groups.monitor, items: [
    item('today', C.nav.today, 'overview', 'today', null),
    item('quality', C.nav.quality, 'weight', 'quality', defaultTab('quality')),
  ] },
  { id: 'operate', label: C.shell.groups.operate, items: [
    item('products', C.nav.products, 'product', 'products', defaultTab('products')),
  ] },
  { id: 'analyse', label: C.shell.groups.analyse, items: [
    item('reports', C.nav.reports, 'reports', 'reports', null),
  ] },
  { id: 'system', label: C.shell.groups.system, items: [
    item('diagnostics', C.tabs.system.diagnostics, 'health', 'system', 'diagnostics'),
    item('setup', C.tabs.system.setup, 'setup', 'system', 'setup', ADMIN_RANK),
    item('account', C.tabs.system.account, 'lock', 'system', 'account'),
  ] },
];

/** Query keys of the global period; they survive moving between screens. */
const PERIOD_KEYS = ['p', 'from', 'to', 'cmp', 'at'];

/** The route a nav entry opens: the period carries over; tab-specific keys and sheets do not. */
export function routeFor(current: Route, it: { s: Screen; t: string | null }): Route {
  const keys: Record<string, string> = {};
  for (const k of PERIOD_KEYS) if (current.keys[k] !== undefined) keys[k] = current.keys[k]!;
  return { s: it.s, t: it.t, sheet: null, wall: false, keys };
}

export function hrefFor(r: Route): string {
  return `?${writeRoute(r).toString()}`;
}

/** Non-system items match on the screen; system items also on the tab. */
export function isActive(current: Route, it: { s: Screen; t: string | null }): boolean {
  if (current.s !== it.s) return false;
  return it.s === 'system' ? current.t === it.t : true;
}

export function visibleGroups(rank: number): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => rank >= i.minRank) })).filter((g) => g.items.length > 0);
}

/** Click handler helper: plain left-clicks navigate in-app; modified clicks keep the browser default. */
export function plainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }, go: () => void): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}
