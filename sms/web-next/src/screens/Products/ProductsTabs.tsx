/**
 * The one Products & PDAS tab strip (Board, Changeover, Catalogue, Limits & History). Switching tab
 * keeps the period keys and drops tab-specific filters and any open sheet (routeFor), so the strip is
 * identical on every Products tab. The legacy `history` tab is the same tab as `limits`.
 */
import { C } from '../../copy';
import type { Route } from '../../route';
import { routeFor } from '../../ui/nav';
import { Tabs } from '../../ui/Tabs';

const TABS = [
  { id: 'board', label: C.tabs.products.board },
  { id: 'changeover', label: C.tabs.products.changeover },
  { id: 'catalogue', label: C.tabs.products.catalogue },
  { id: 'limits', label: C.tabs.products.limits },
] as const;

export interface ProductsTabsProps {
  route: Route;
  go: (next: Route) => void;
}

export function ProductsTabs({ route, go }: ProductsTabsProps) {
  const current = route.t === 'history' ? 'limits' : (route.t ?? 'board');
  return (
    <Tabs
      label={C.nav.products}
      value={current}
      idPrefix="products"
      items={TABS}
      onChange={(id) => go(routeFor(route, { s: 'products', t: id }))}
    />
  );
}
