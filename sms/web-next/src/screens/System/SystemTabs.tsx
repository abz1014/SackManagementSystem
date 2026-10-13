/**
 * The System tab strip: Diagnostics, Setup, Account. Setup is left out below rank 4 (never greyed), as in the sidebar.
 * Switching tab keeps the period keys and drops the rest (routeFor).
 */
import { C } from '../../copy';
import type { Route } from '../../route';
import { ADMIN_RANK } from '../../ranks';
import { routeFor } from '../../ui/nav';
import { Tabs } from '../../ui/Tabs';

export interface SystemTabsProps {
  route: Route;
  rank: number;
  go: (next: Route) => void;
}

export function SystemTabs({ route, rank, go }: SystemTabsProps) {
  const items = [
    { id: 'diagnostics', label: C.tabs.system.diagnostics },
    ...(rank >= ADMIN_RANK ? [{ id: 'setup', label: C.tabs.system.setup }] : []),
    { id: 'account', label: C.tabs.system.account },
  ];
  return (
    <Tabs
      label={C.nav.system}
      value={route.t ?? 'diagnostics'}
      idPrefix="system"
      items={items}
      onChange={(id) => go(routeFor(route, { s: 'system', t: id }))}
    />
  );
}
