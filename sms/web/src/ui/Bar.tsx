/**
 * The top bar and the strip beneath it — the app's entire chrome.
 *
 * It replaces a 92px icon rail plus a 250px section column plus a sub-tab row:
 * 342 horizontal pixels on every screen, which mostly showed the screen's title
 * twice and the running product a third time. Five words, one period control,
 * one sentence about the data's age, and two buttons.
 *
 * THE STRIP IS NOT DECORATION. It is the only place the app says how old the
 * numbers are, and it has three states, because the honest answer differs:
 * healthy, the plant link has gone quiet, and readings are arriving far too
 * late to judge the line by. When it is not healthy, screens must not assert
 * whether the line is running — see lib/health.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { W } from '../lib/words';
import { PERIOD_KEYS, type PeriodKey, type PeriodParams } from '../lib/period';
import type { Health } from '../lib/health';
import { fmtClock, fmtSpan } from '../lib/fmt';
import type { AuthUser } from '../api';

export type Screen = 'line' | 'readings' | 'weight' | 'rejects' | 'report';

export const SCREENS: readonly Screen[] = ['line', 'readings', 'weight', 'rejects', 'report'] as const;

/* -------------------------------------------------------------- the gear */

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/* ---------------------------------------------------- the period control */

export function PeriodControl({
  value,
  onChange,
}: {
  value: PeriodParams;
  onChange: (p: PeriodParams) => void;
}) {
  const picked = value.picked;
  return (
    <div className="row">
      <div className="period" role="group" aria-label="Period">
        {PERIOD_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={value.key === k ? 'on' : ''}
            aria-pressed={value.key === k}
            onClick={() => onChange(k === 'pick' ? { key: 'pick', picked: picked ?? todayRange() } : { key: k })}
          >
            {W.period[k as PeriodKey]}
          </button>
        ))}
      </div>
      {value.key === 'pick' && picked && (
        <span className="picked">
          <input
            type="date"
            aria-label="From"
            value={picked.from}
            max={picked.to}
            onChange={(e) => onChange({ key: 'pick', picked: { ...picked, from: e.target.value } })}
          />
          <span className="q" style={{ margin: 0 }}>{W.periodTo}</span>
          <input
            type="date"
            aria-label="To"
            value={picked.to}
            min={picked.from}
            onChange={(e) => onChange({ key: 'pick', picked: { ...picked, to: e.target.value } })}
          />
        </span>
      )}
    </div>
  );
}

/** A sane starting range when "Pick dates" is first chosen: the last week. */
function todayRange(): { from: string; to: string } {
  const d = new Date();
  const to = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 6);
  return { from: d.toISOString().slice(0, 10), to };
}

/* -------------------------------------------------------- the user menu */

const SCALES = [
  { key: '1', label: 'Desk' },
  { key: '1.3', label: 'Wall' },
] as const;

function UserMenu({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('sms.uiScale');
      return SCALES.some((s) => s.key === saved) ? saved! : '1';
    } catch {
      return '1';
    }
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', scale);
    try {
      localStorage.setItem('sms.uiScale', scale);
    } catch {
      /* private mode — the choice simply will not persist */
    }
  }, [scale]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const name = user.displayName ?? user.username;
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="menu-wrap" ref={box}>
      <button
        type="button"
        className="icon-btn initials"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{initials}</span>
        <span className="sr-only">{name}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-who">
            <b>{name}</b>
            <span>{user.role}</span>
          </div>
          <div className="menu-row">
            <span>Text size</span>
            <span className="toggle">
              {SCALES.map((s) => (
                <button key={s.key} type="button" className={scale === s.key ? 'on' : ''} onClick={() => setScale(s.key)}>
                  {s.label}
                </button>
              ))}
            </span>
          </div>
          <button type="button" className="menu-item" role="menuitem" onClick={onSignOut}>
            {W.signOut}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the strip */

/** The lag sentence, in whichever of its three states is true. */
export function HealthLine({ health, onOpen }: { health: Health; onOpen: () => void }) {
  let text: string;
  let dot: string;

  switch (health.kind) {
    case 'ok':
      dot = 'dot';
      text =
        health.lagSeconds != null
          ? W.lag.ok(fmtClock(health.readingUtc), fmtSpan(health.lagSeconds))
          : W.lag.okNoLag(fmtClock(health.readingUtc));
      break;
    case 'stale':
      dot = 'dot bad';
      text = W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—');
      break;
    case 'late':
      dot = 'dot bad';
      text = W.lag.late(fmtSpan(health.lagSeconds));
      break;
    default:
      dot = 'dot warn';
      text = W.lag.noData;
  }

  return (
    <span>
      <span className={dot} aria-hidden="true" />
      {/* The whole sentence is the link, and it ends in the word "details":
          a bare coloured dot beside a sentence is not a target anyone finds. */}
      <button type="button" className="strip-link" onClick={onOpen}>
        {text} {W.lag.details}
      </button>
    </span>
  );
}

/* --------------------------------------------------------------- the bar */

export function Bar({
  screen,
  lineName,
  health,
  period,
  user,
  isAdmin,
  onNavigate,
  onPeriod,
  onWall,
  onSetup,
  onOpenSync,
  onSignOut,
}: {
  screen: Screen | 'setup';
  lineName: string;
  health: Health;
  period: PeriodParams;
  user: AuthUser;
  isAdmin: boolean;
  onNavigate: (s: Screen) => void;
  onPeriod: (p: PeriodParams) => void;
  onWall: () => void;
  onSetup: () => void;
  onOpenSync: () => void;
  onSignOut: () => void;
}) {
  const alarm = health.kind === 'stale' || health.kind === 'late';
  return (
    <>
      <div className="bar no-print">
        <nav className="nav" aria-label="Screens">
          <span className="brand">{W.brand}</span>
          {SCREENS.map((s) => (
            <button
              key={s}
              type="button"
              className={`nav-link${screen === s ? ' on' : ''}`}
              aria-current={screen === s ? 'page' : undefined}
              onClick={() => onNavigate(s)}
            >
              {W.nav[s]}
            </button>
          ))}
        </nav>

        <PeriodControl value={period} onChange={onPeriod} />

        <div className="bar-right">
          <button type="button" className="btn" onClick={onWall}>
            {W.wall}
          </button>
          {isAdmin && (
            <button type="button" className="icon-btn" onClick={onSetup} aria-label={W.setup} title={W.setup}>
              <GearIcon />
            </button>
          )}
          <UserMenu user={user} onSignOut={onSignOut} />
        </div>
      </div>

      <div className={`strip no-print${alarm ? ' alarm' : ''}`}>
        <span>{lineName}</span>
        <HealthLine health={health} onOpen={onOpenSync} />
      </div>
    </>
  );
}
