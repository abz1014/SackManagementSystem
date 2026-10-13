import { useRef, type KeyboardEvent } from 'react';
import './components/Segmented.css';

export interface SegmentOption {
  id: string;
  label: string;
  /** Why it is unavailable; shown as a tooltip. */
  disabledReason?: string;
}
export interface SegmentedProps {
  /** 2 to 4 options (DESIGN-SYSTEM 6.12); more are cut off. */
  options: readonly SegmentOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}

export function Segmented({ options, value, onChange, label }: SegmentedProps) {
  const opts = options.slice(0, 4);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const on = opts.filter((o) => !o.disabledReason);
  const onKey = (e: KeyboardEvent) => {
    const i = on.findIndex((o) => o.id === value);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % on.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + on.length) % on.length;
    if (n < 0) return;
    e.preventDefault();
    onChange(on[n]!.id);
    refs.current[on[n]!.id]?.focus();
  };
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {opts.map((o) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[o.id] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          disabled={!!o.disabledReason}
          title={o.disabledReason}
          className="ui-seg__opt"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
