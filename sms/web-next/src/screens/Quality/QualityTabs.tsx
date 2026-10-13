/**
 * The one Quality tab strip (Weight, Rejects, Stations, Register). Switching tab keeps the period keys
 * and drops tab-specific filters and any open sheet (routeFor), so the tabs are identical on every screen.
 */
import { C } from '../../copy';
import type { Route } from '../../route';
import { routeFor } from '../../ui/nav';
import { Tabs } from '../../ui/Tabs';

const TABS = [
  { id: 'weight', label: C.tabs.quality.weight },
  { id: 'rejects', label: C.tabs.quality.rejects },
  { id: 'stations', label: C.tabs.quality.stations },
  { id: 'register', label: C.tabs.quality.register },
] as const;

export interface QualityTabsProps {
  route: Route;
  go: (next: Route) => void;
}

export function QualityTabs({ route, go }: QualityTabsProps) {
  return (
    <Tabs
      label={C.nav.quality}
      value={route.t ?? 'weight'}
      idPrefix="quality"
      items={TABS}
      onChange={(id) => go(routeFor(route, { s: 'quality', t: id }))}
    />
  );
}
