import type { ReactNode } from 'react';
import { C, formatDate } from '../copy';
import { U } from './strings';
import './components/EmptyState.css';

export interface EmptyStateProps {
  /** Newest reading (plant-clock ISO, ms or Date). When given, the canonical sentence names it (X-3). */
  newest?: string | number | Date | null;
  /** Called by the "Show {date}" action. Without it no action is drawn. */
  onShowNewest?: () => void;
  /** Overrides the sentence (variants: no data yet, filter returns none, calm OK). */
  message?: ReactNode;
  /** Own action, e.g. "Clear filters". Replaces the newest-data action. */
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
}

export function EmptyState({ newest, onShowNewest, message, action, icon }: EmptyStateProps) {
  const date = newest !== null && newest !== undefined ? formatDate(newest) : null;
  const text = message ?? (date ? C.nothingInPeriod(date) : C.nothingInPeriodNoNewest);
  const act = action ?? (date && onShowNewest ? { label: U.showDate(date), onClick: onShowNewest } : null);
  return (
    <div className="ui-empty" role="status">
      <span className="ui-empty__icon" aria-hidden="true">
        {icon ?? (
          <svg viewBox="0 0 20 20" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M3 8h14" />
          </svg>
        )}
      </span>
      <p className="ui-empty__text">{text}</p>
      {act && (
        <button type="button" className="ui-btn" onClick={act.onClick}>
          {act.label}
        </button>
      )}
    </div>
  );
}
