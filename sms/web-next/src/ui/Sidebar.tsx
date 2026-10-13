import { useCallback, useState, type ReactNode } from 'react';
import { C, PLANT_NAME } from '../copy';
import type { Route } from '../route';
import { Icon } from './Icon';
import { hrefFor, isActive, plainClick, routeFor, visibleGroups } from './nav';

const KEY = 'sms.sidebar.collapsed';

/** Collapsed state, persisted per viewer. Storage may be absent or throw (private window): then it simply is not remembered. */
export function useSidebarCollapsed(viewer: string | null): [boolean, (v: boolean) => void] {
  const key = `${KEY}.${viewer ?? 'anon'}`;
  const [collapsed, setState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setState(v);
      try {
        window.localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* not remembered */
      }
    },
    [key],
  );
  return [collapsed, set];
}

export interface SidebarProps {
  route: Route;
  /** 1 viewer .. 4 admin. Items above this rank are absent, not disabled. */
  rank: number;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  onNavigate: (r: Route) => void;
  /** Optional block above the collapse control (for example a health summary). */
  footer?: ReactNode;
}

export function Sidebar({ route, rank, collapsed, onCollapsedChange, onNavigate, footer }: SidebarProps) {
  const groups = visibleGroups(rank);
  return (
    <aside className="sh-side" data-collapsed={collapsed ? '' : undefined}>
      <div className="sh-brand">
        <span className="sh-wordmark">{C.shell.appName}</span>
        {!collapsed && <span className="sh-plant">{PLANT_NAME}</span>}
      </div>
      <nav aria-label={C.shell.mainNav} className="sh-nav">
        {groups.map((g) => (
          <div className="sh-group" key={g.id} role="group" aria-label={g.label}>
            {!collapsed && <div className="sh-group-label">{g.label}</div>}
            {g.items.map((it) => {
              const active = isActive(route, it);
              const target = routeFor(route, it);
              return (
                <a
                  key={it.id}
                  className="sh-item"
                  href={hrefFor(target)}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? it.label : undefined}
                  aria-label={collapsed ? it.label : undefined}
                  onClick={(e) => plainClick(e, () => onNavigate(target))}
                >
                  <Icon name={it.icon} />
                  {!collapsed && <span>{it.label}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sh-side-foot">
        {footer}
        <button
          type="button"
          className="sh-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? C.shell.expand : C.shell.collapse}
          title={collapsed ? C.shell.expand : C.shell.collapse}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} className={collapsed ? undefined : 'sh-rot'} />
        </button>
      </div>
    </aside>
  );
}
