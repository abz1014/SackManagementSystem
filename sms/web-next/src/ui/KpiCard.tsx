import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { C } from '../copy';
import { StatusPill, type UiState } from './StatusPill';
import '../components/state.css';

export interface KpiDelta {
  /** Already formatted: "0.4 pt". */
  text: string;
  /** Direction only. It is NOT a judgement and is never coloured by state. */
  direction: 'up' | 'down' | 'flat';
  /** "vs previous" */
  vs: string;
}

export interface KpiCardProps {
  label: string;
  /** Formatted value. */
  value?: string | null;
  unit?: string;
  icon?: ReactNode;
  /** Icon chip hue 1-5 (blue, violet, teal, indigo, slate). Never a state hue. */
  chip?: 1 | 2 | 3 | 4 | 5;
  delta?: KpiDelta | null;
  /** A small line under the value, for the count behind it ("14 of 3,089 cones"). Shown only when the value is. */
  note?: string | null;
  /** Show the note even when there is no value (a withheld figure explains itself). */
  noteWhenEmpty?: boolean;
  /** Help text for a small "?" button beside the label; opens a popover (Esc or outside click closes). */
  info?: string;
  /** Server-decided judgement. Omit for neutral cards (cones produced). */
  state?: UiState;
  /** Data hook status. */
  status?: 'loading' | 'ok' | 'empty' | 'error';
  /** Name of the part that failed, for the error line. */
  part?: string;
  onRetry?: () => void;
}

function InfoButton({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <span
      className="kpi-info-wrap"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="kpi-info"
        aria-label={`How ${label.toLowerCase()} is counted`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        ?
      </button>
      {open && (
        <span id={id} role="note" className="kpi-pop">{text}</span>
      )}
    </span>
  );
}

const ARROW = { up: '▲', down: '▼', flat: '▬' } as const;

export function KpiCard({ label, value, unit, icon, chip = 1, delta, note, noteWhenEmpty, info, state, status = 'ok', part, onRetry }: KpiCardProps) {
  const loading = status === 'loading';
  const error = status === 'error';
  const empty = status === 'empty';
  const judged = status === 'ok' && state && state !== 'nodata';
  const cls = `kpi${judged ? ` kpi-${state}` : ''}${loading ? ' kpi-loading' : ''}`;
  return (
    <section className={cls} aria-busy={loading || undefined} data-status={status}>
      <span className="kpi-chip" style={{ background: `var(--chip-${chip}-bg)`, color: `var(--chip-${chip}-fg)` }} aria-hidden="true">
        {icon}
      </span>
      <div className="kpi-label">
        {label}
        {info && <InfoButton label={label} text={info} />}
      </div>
      {loading ? (
        <div className="kpi-skel" aria-label="Loading" />
      ) : error ? (
        <div className="kpi-err">
          <div className="kpi-value">{'–'}</div>
          <div className="kpi-errtext" role="alert">{C.couldntLoad(part ?? label.toLowerCase())}</div>
          {onRetry && (
            <button type="button" className="kpi-retry" onClick={onRetry}>{C.tryAgain}</button>
          )}
        </div>
      ) : empty ? (
        <div>
          <div className="kpi-value">{'–'}</div>
          <StatusPill state="nodata" />
        </div>
      ) : (
        <div>
          <div className="kpi-value">
            {value ?? '–'}
            {unit && value != null && <span className="kpi-unit">{unit}</span>}
          </div>
          {note && (value != null || noteWhenEmpty) && <div className="kpi-note">{note}</div>}
          {delta && (
            <div className="kpi-delta" data-direction={delta.direction}>
              <span aria-hidden="true">{ARROW[delta.direction]}</span> {delta.text} {delta.vs}
            </div>
          )}
          {state && <StatusPill state={state} />}
        </div>
      )}
    </section>
  );
}
