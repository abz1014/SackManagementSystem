import type { ReactNode } from 'react';
import { C } from '../copy';
import './components/Chip.css';

export interface ChipProps {
  children: ReactNode;
  /** Plain text of the chip, used for the remove button's name. Defaults to children when a string. */
  label?: string;
  /** Present: a removable filter chip (accent tint). Absent: read-only info chip. */
  onRemove?: () => void;
}

export function Chip({ children, label, onRemove }: ChipProps) {
  const name = label ?? (typeof children === 'string' ? children : '');
  return (
    <span className={`ui-chip ${onRemove ? 'ui-chip--filter' : 'ui-chip--info'}`}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip__x" onClick={onRemove} aria-label={C.ui.remove(name)}>
          <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      )}
    </span>
  );
}
