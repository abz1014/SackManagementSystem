import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { C } from '../copy';
import { createPortal } from 'react-dom';
import './components/write.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in plain words. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Focus starts on Cancel, never on the confirming action. Esc cancels. Tab is trapped. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = C.write.cancel, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelBtn.current?.focus();
    return () => {
      const t = returnTo.current;
      if (t && document.contains(t)) t.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const els = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (els.length === 0) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    const a = document.activeElement;
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="wr-confirm-root" onKeyDown={onKey}>
      <div className="wr-confirm__scrim" aria-hidden="true" onClick={onCancel} />
      <div ref={box} className="wr-confirm" role="alertdialog" aria-modal="true" aria-labelledby="wr-confirm-title" aria-describedby="wr-confirm-body">
        <h2 id="wr-confirm-title" className="wr-confirm__title">{title}</h2>
        <div id="wr-confirm-body" className="wr-confirm__body">{children}</div>
        <div className="wr-confirm__actions">
          <button ref={cancelBtn} type="button" className="wr-btn" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="ui-btn" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
