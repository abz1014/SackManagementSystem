import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { C } from '../copy';
import { createPortal } from 'react-dom';
import type { SheetKind, SheetRef } from '../route';
import './components/Sheet.css';

export interface SheetProps {
  /** Open state straight from the URL: pass route.sheet and the kind this Sheet shows. */
  sheet?: SheetRef | null;
  kind?: SheetKind;
  /** Or drive it directly. */
  open?: boolean;
  /** Close = remove the `sheet` key from the URL (so Back also closes it). */
  onClose: () => void;
  title: ReactNode;
  /** StatusPill slot beside the title. */
  status?: ReactNode;
  /** 480 (default) or 640 for reading-sheet detail. */
  width?: 480 | 640;
  footer?: ReactNode;
  children: ReactNode;
}

/* CSS-074: `summary` is focusable (a Disclosure's toggle) and must be in the trap, or Tab skips it and Shift+Tab from the
   first control after it wraps past it. Controls inside a closed <details> are not focusable and are left out. */
export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const closed = el.closest('details:not([open])');
    if (!closed || !root.contains(closed)) return true;
    return el.parentElement === closed && el.tagName === 'SUMMARY';
  });
}

/* D24: the control that opened a Sheet is not always the focused element when the Sheet mounts (a chart mark, a clickable
   row that cannot take focus, a Sheet opened from the address). Remember the last pointer or key target so focus can go back
   to it, and fall back to the page's main region rather than to <body>. */
let lastTarget: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  const note = (e: Event) => {
    lastTarget = e.target instanceof HTMLElement && !e.target.closest('.ui-sheet-root') ? e.target : lastTarget;
  };
  document.addEventListener('pointerdown', note, true);
  document.addEventListener('keydown', note, true);
}

const OPENER = 'button,a[href],summary,input,select,textarea,[tabindex],[role="button"],[role="row"],tr';

function findOpener(): HTMLElement | null {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a !== document.body && !a.closest('.ui-sheet-root')) return a;
  return lastTarget && document.contains(lastTarget) ? (lastTarget.closest<HTMLElement>(OPENER) ?? null) : null;
}

function giveFocus(el: HTMLElement) {
  if (!el.matches('button,a[href],input,select,textarea,summary,[tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus();
}

export function Sheet({ sheet, kind, open, onClose, title, status, width = 480, footer, children }: SheetProps) {
  const isOpen = open ?? (!!sheet && (kind === undefined || sheet.kind === kind));
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    /* the trigger had focus when the effect runs: the panel is not focused yet */
    returnTo.current = findOpener();
    const first = panel.current ? focusablesIn(panel.current)[0] : undefined;
    (first ?? panel.current)?.focus();
    return () => {
      const t = returnTo.current;
      const target = t && document.contains(t) ? t : document.getElementById('sh-main');
      if (target) giveFocus(target);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const els = focusablesIn(panel.current);
    if (els.length === 0) {
      e.preventDefault();
      panel.current.focus();
      return;
    }
    const first = els[0]!;
    const last = els[els.length - 1]!;
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="ui-sheet-root" onKeyDown={onKey}>
      <div className="ui-sheet__scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className={`ui-sheet ui-sheet--${width}`} role="dialog" aria-modal="true" aria-labelledby="ui-sheet-title" tabIndex={-1}>
        <header className="ui-sheet__head">
          <h2 id="ui-sheet-title" className="ui-sheet__title">
            {title}
          </h2>
          {status}
          <button type="button" className="ui-sheet__close" onClick={onClose} aria-label={C.ui.close}>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>
        <div className="ui-sheet__body">{children}</div>
        {footer && <footer className="ui-sheet__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
