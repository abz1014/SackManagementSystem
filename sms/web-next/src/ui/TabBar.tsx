import { useEffect, useState } from 'react';
import { C } from '../copy';
import type { Route } from '../route';
import { Icon, type IconName } from './Icon';
import { ADMIN_RANK, NAV_GROUPS, hrefFor, isActive, plainClick, routeFor } from './nav';
import { SHELL } from './shellCopy';

export interface TabBarProps {
  route: Route;
  rank: number;
  onNavigate: (r: Route) => void;
  onSignOut: () => void;
  signOutError?: string | null;
}

const byId = (id: string) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === id)!;

/** Phone (<768) bottom tab bar: Today, Quality, Products, Reports, More (decision E-8). */
export function TabBar({ route, rank, onNavigate, onSignOut, signOutError }: TabBarProps) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMore(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [more]);

  const tabs = ['today', 'quality', 'products', 'reports'].map(byId);
  const go = (r: Route) => {
    setMore(false);
    onNavigate(r);
  };
  const registerTarget = routeFor(route, { s: 'quality', t: 'register' });
  const moreLinks: Array<{ id: string; label: string; icon: IconName; target: Route }> = [
    { id: 'register', label: SHELL.register, icon: 'reports', target: registerTarget },
    { id: 'diagnostics', label: C.tabs.system.diagnostics, icon: 'health', target: routeFor(route, byId('diagnostics')) },
    ...(rank >= ADMIN_RANK ? [{ id: 'setup', label: C.tabs.system.setup, icon: 'setup' as IconName, target: routeFor(route, byId('setup')) }] : []),
    { id: 'account', label: C.tabs.system.account, icon: 'lock', target: routeFor(route, byId('account')) },
  ];

  return (
    <>
      {more && (
        <>
          <div className="scrim sh-scrim" onClick={() => setMore(false)} />
          <div className="sheet sh-more" role="dialog" aria-label={SHELL.more}>
            <ul className="sh-more-list">
              {moreLinks.map((l) => (
                <li key={l.id}>
                  <a href={hrefFor(l.target)} className="sh-more-item" onClick={(e) => plainClick(e, () => go(l.target))}>
                    <Icon name={l.icon} />
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <button type="button" className="sh-more-item" onClick={onSignOut}>
                  <Icon name="close" />
                  {C.signOut}
                </button>
              </li>
            </ul>
            {signOutError && (
              <p className="sh-menu-err" role="alert">
                {signOutError}
              </p>
            )}
          </div>
        </>
      )}
      <nav className="sh-tabbar" aria-label={SHELL.phoneNav}>
        {tabs.map((it) => {
          const target = routeFor(route, it);
          return (
            <a
              key={it.id}
              className="sh-tab"
              href={hrefFor(target)}
              aria-current={isActive(route, it) ? 'page' : undefined}
              onClick={(e) => plainClick(e, () => go(target))}
            >
              <Icon name={it.icon} />
              <span>{it.label.replace(' & PDAS', '')}</span>
            </a>
          );
        })}
        <button
          type="button"
          className="sh-tab"
          aria-expanded={more}
          aria-current={route.s === 'system' ? 'page' : undefined}
          onClick={() => setMore((m) => !m)}
        >
          <Icon name="menu" />
          <span>{SHELL.more}</span>
        </button>
      </nav>
    </>
  );
}
