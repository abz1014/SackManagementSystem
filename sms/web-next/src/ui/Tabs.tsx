import { useRef, type KeyboardEvent } from 'react';
import './components/Tabs.css';

export interface TabItem {
  id: string;
  label: string;
  /** Rank-gated tabs are left out by the caller, not disabled. */
  disabled?: boolean;
}
export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Panels use id `${idPrefix}-panel-${id}` and aria-labelledby `${idPrefix}-tab-${id}`. */
  idPrefix?: string;
}

export function Tabs({ items, value, onChange, label, idPrefix = 'tabs' }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((i) => !i.disabled);
  const onKey = (e: KeyboardEvent) => {
    const idx = enabled.findIndex((i) => i.id === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') n = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = enabled.length - 1;
    if (n < 0) return;
    e.preventDefault();
    const t = enabled[n]!;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          id={`${idPrefix}-tab-${t.id}`}
          role="tab"
          type="button"
          aria-selected={t.id === value}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          className="ui-tabs__tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
