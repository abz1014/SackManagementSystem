/**
 * The right-hand sheet: how every drill-down opens.
 *
 * The old app answered "what does this one reading say?" with a page
 * navigation, so a reader who wanted to check a single cone lost their filters,
 * their scroll position and their place in a 3,000-row list, and had to
 * reconstruct all three to look at the next one. A sheet keeps the screen
 * underneath and closes with Escape, which is the difference between glancing
 * at a record and making a journey to it.
 *
 * It is a real modal dialog, not a styled div: focus moves in on open, is
 * trapped while it is up, and returns to whatever opened it on close. A wall
 * display and a keyboard user both depend on that; so does anyone using a
 * screen reader, for whom an untrapped "dialog" is just content that appeared
 * somewhere unannounced.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { W } from '../lib/words';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title,
  eyebrow,
  onClose,
  children,
}: {
  /** The accessible name. Rendered as the sheet's own heading unless the body
   *  supplies one, so a sheet is never an unnamed dialog. */
  title: string;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  // Remember what had focus, so closing returns the reader to the row they
  // opened rather than to the top of the document.
  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // The page behind must not scroll while a sheet is up: on a touch screen the
  // sheet's own scroll otherwise chains into the list underneath and the
  // reader loses the place the sheet exists to preserve.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <>
      <button type="button" className="scrim" aria-label={`${W.close} ${title}`} onClick={onClose} />
      <div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="sheet-head">
          <div>{eyebrow && <p className="q">{eyebrow}</p>}</div>
          <button type="button" className="btn no-print" onClick={onClose}>
            {W.close} · {W.esc}
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
