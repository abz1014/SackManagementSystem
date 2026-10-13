import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AuthUser } from '../bridge/api';
import { C } from '../copy';
import { Icon } from './Icon';
const A11Y = C.a11y;
import { TextSizeControl, useUiScale } from './TextSize';
import { useZoomed, zoomBack } from '../charts/zoomMarker';

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
  const trigger = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useUiScale();
  const zoomed = useZoomed();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* CSS-039: the menu unmounts on close; focus inside it would drop to <body>, so hand it back to the button. */
      if (root.current?.contains(document.activeElement) && document.activeElement !== trigger.current) trigger.current?.focus();
      setOpen(false);
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
        {zoomed && (
          <button type="button" className="sh-zoomback" onClick={zoomBack}>
            {A11Y.zoomedBack}
          </button>
        )}
        {periodChip}
        {healthDot}
        {user && (
          <div className="sh-user" ref={root}>
            <button
              ref={trigger}
              type="button"
              className="sh-user-btn"
              aria-expanded={open}
              aria-controls={id}
              aria-label={C.shell.userMenu}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="sh-user-name">{name}</span>
              <span className="sh-user-role">{user.role}</span>
              <Icon name="chevron-down" size={16} />
            </button>
            {open && (
              <div className="popover sh-popover sh-menu" id={id} role="menu" aria-label={C.shell.signedInAs(name, user.role)}>
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
                <TextSizeControl scale={scale} onChange={setScale} />
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
