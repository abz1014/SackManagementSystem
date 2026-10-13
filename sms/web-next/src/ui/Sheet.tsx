import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SheetKind, SheetRef } from '../route';
import { U } from './strings';
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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Sheet({ sheet, kind, open, onClose, title, status, width = 480, footer, children }: SheetProps) {
  const isOpen = open ?? (!!sheet && (kind === undefined || sheet.kind === kind));
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    /* the trigger had focus when the effect runs: the panel is not focused yet */
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      const t = returnTo.current;
      if (t && document.contains(t)) t.focus();
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
    const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
          <button type="button" className="ui-sheet__close" onClick={onClose} aria-label={U.close}>
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
