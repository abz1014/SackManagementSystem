import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AuthUser } from '../bridge/api';
import { C } from '../copy';
import { Icon } from './Icon';
import { SHELL } from './shellCopy';

export interface TopBarProps {
  title: string;
  /** PeriodChip goes here (built by another component). */
  periodChip?: ReactNode;
  /** HealthDot goes here. */
  healthDot?: ReactNode;
  user: AuthUser | null;
  /** Rank 1..4 is already applied by the caller; the menu has only Account and Sign out. */
  onOpenAccount: () => void;
  onSignOut: () => void;
  /** Set after a failed sign-out; shown in the menu. */
  signOutError?: string | null;
}

export function TopBar({ title, periodChip, healthDot, user, onOpenAccount, onSignOut, signOutError }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const name = user ? user.displayName || user.username : '';
  return (
    <header className="sh-top">
      <div className="sh-top-title">{title}</div>
      <div className="sh-top-right">
        {periodChip}
        {healthDot}
        {user && (
          <div className="sh-user" ref={root}>
            <button
              type="button"
              className="sh-user-btn"
              aria-expanded={open}
              aria-controls={id}
              aria-label={SHELL.userMenu}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="sh-user-name">{name}</span>
              <span className="sh-user-role">{user.role}</span>
              <Icon name="chevron-down" size={16} />
            </button>
            {open && (
              <div className="popover sh-popover sh-menu" id={id} role="menu" aria-label={SHELL.signedInAs(name, user.role)}>
                <button
                  type="button"
                  role="menuitem"
                  className="sh-menu-item"
                  onClick={() => {
                    setOpen(false);
                    onOpenAccount();
                  }}
                >
                  <Icon name="lock" />
                  {C.tabs.system.account}
                </button>
                <button type="button" role="menuitem" className="sh-menu-item" onClick={onSignOut}>
                  <Icon name="close" />
                  {C.signOut}
                </button>
                {signOutError && (
                  <p className="sh-menu-err" role="alert">
                    {signOutError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
