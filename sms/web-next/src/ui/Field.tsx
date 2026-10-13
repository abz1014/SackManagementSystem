import { useId, type ReactNode } from 'react';
import { REASON_MIN_CHARS, WS } from './writeStrings';
import './components/write.css';

interface ShellProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  id: string;
  children: ReactNode;
}
function Shell({ label, hint, error, id, children }: ShellProps) {
  return (
    <div className="wr-field">
      <label className="wr-field__label" htmlFor={id}>{label}</label>
      {children}
      {hint && <div id={`${id}-hint`} className="wr-field__hint">{hint}</div>}
      {error && <div id={`${id}-err`} className="wr-field__error" role="alert">{error}</div>}
    </div>
  );
}
const describedBy = (id: string, hint: unknown, error: unknown) =>
  [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;

export interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
}
export function NumberField({ label, value, onChange, unit, min, max, step, hint, error, disabled }: NumberFieldProps) {
  const id = useId();
  return (
    <Shell label={label} hint={hint} error={error} id={id}>
      <span className="wr-input-wrap">
        <input id={id} className="wr-input" type="number" inputMode="decimal" value={value} min={min} max={max} step={step}
          disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)}
          onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="wr-input-unit">{unit}</span>}
      </span>
    </Shell>
  );
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
}
export function SelectField({ label, value, onChange, options, placeholder, hint, error, disabled }: SelectFieldProps) {
  const id = useId();
  return (
    <Shell label={label} hint={hint} error={error} id={id}>
      <select id={id} className="wr-input wr-select" value={value} disabled={disabled}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Shell>
  );
}

export interface ReasonFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Default 10, the server's minimum. */
  minLength?: number;
  hint?: ReactNode;
  disabled?: boolean;
}
/** True when the trimmed reason meets the minimum (the server trims too). */
export const reasonValid = (v: string, min = REASON_MIN_CHARS) => v.trim().length >= min;

export function ReasonField({ label, value, onChange, minLength = REASON_MIN_CHARS, hint, disabled }: ReasonFieldProps) {
  const id = useId();
  const n = value.trim().length;
  const ok = n >= minLength;
  return (
    <Shell label={label} hint={hint} id={id}>
      <textarea id={id} className="wr-input wr-textarea" rows={3} value={value} disabled={disabled}
        aria-describedby={[hint ? `${id}-hint` : '', `${id}-count`].filter(Boolean).join(' ')}
        onChange={(e) => onChange(e.target.value)} />
      <div id={`${id}-count`} className={`wr-count${ok ? ' wr-count--ok' : ''}`} aria-live="polite">
        {ok ? WS.reasonOk(n) : WS.reasonCount(n, minLength)}
      </div>
    </Shell>
  );
}
