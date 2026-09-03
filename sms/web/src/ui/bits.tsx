/**
 * The small shared pieces every screen is built from.
 *
 * There are deliberately few of them, and each one encodes a rule from
 * REDESIGN.md that a screen would otherwise be free to break:
 *
 *  - `Figure` puts the qualifier INSIDE the figure, so a number never appears
 *    without saying what it counts and on what basis.
 *  - `Block` is a rule and 28px of space, never a card. There is no `Card`
 *    component on purpose: cards nest, and nested cards are what the old
 *    screens turned into.
 *  - `Details` is the only route by which a statistic reaches the screen.
 *  - `Loading` / `Failed` / `Empty` exist so that "no data" is a sentence
 *    rather than an empty region a reader has to interpret.
 */
import type { ReactNode } from 'react';
import { W } from '../lib/words';

/* ------------------------------------------------------------------ blocks */

export function Block({
  label,
  note,
  first,
  tight,
  plain,
  children,
}: {
  label?: ReactNode;
  /** The right-hand note: the scope, or the one caveat this block is allowed. */
  note?: ReactNode;
  first?: boolean;
  tight?: boolean;
  plain?: boolean;
  children: ReactNode;
}) {
  const cls = ['block', first && 'first', tight && 'tight', plain && 'plain'].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {(label || note) && (
        <p className="h2">
          <span>{label}</span>
          {note && <span className="note">{note}</span>}
        </p>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- figures */

export interface FigureProps {
  /** The number itself, already formatted. */
  value: string;
  /** What it counts — "cones", "sacks", "kg". Sits beside the numeral. */
  unit?: string;
  /** The qualifier line: the basis, the share, the comparison. */
  note?: ReactNode;
  accent?: boolean;
}

export function Figure({ value, unit, note, accent }: FigureProps) {
  return (
    <div>
      <b className={`fig-val${accent ? ' acc' : ''}`}>
        {value}
        {unit && <span className="fig-unit">{unit}</span>}
      </b>
      {note && <span className="fig-note">{note}</span>}
    </div>
  );
}

/** Three figures, or two, or four. Never five: past four they stop being read. */
export function Figures({ items }: { items: FigureProps[] }) {
  const cls = items.length === 2 ? 'figs two' : items.length === 4 ? 'figs four' : 'figs';
  return (
    <div className={cls}>
      {items.map((f, i) => (
        <Figure key={i} {...f} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- disclosure */

/**
 * "Show the working". The ONLY place sigma, Cp, Cpk, control limits, Nelson
 * rule numbers, merge keys and transform versions may appear.
 *
 * A native <details> rather than a state toggle: it is open-able before the
 * JavaScript that would manage it has run, it prints open if the reader
 * expands it, and browser find-in-page reaches inside it.
 */
export function Details({ summary = W.working, children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="details">
      <summary>{summary}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------------ states */

export function Loading({ what }: { what?: string }) {
  return (
    <p className="state loading" role="status">
      {what ? `${W.loading} ${what}` : W.loading}
    </p>
  );
}

export function Failed({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  // A refusal is not an outage. Telling somebody the plant link is down when
  // they simply are not allowed to see something sends them to look for a
  // fault that does not exist.
  const refused = !!error && /insufficient role|authentication required/i.test(error);
  return (
    <p className="state err" role="status">
      {refused ? W.notAllowed : W.couldNotLoad}
      {onRetry && !refused && (
        <>
          {' '}
          <button type="button" className="btn" onClick={onRetry}>
            {W.retry}
          </button>
        </>
      )}
      {error && <span className="sr-only"> {error}</span>}
    </p>
  );
}

export function Empty({ message = W.nothingHere }: { message?: string }) {
  return <p className="state">{message}</p>;
}

/* ------------------------------------------------------------------ chrome */

export function Chevron() {
  return (
    <span className="chev" aria-hidden="true">
      ›
    </span>
  );
}

/**
 * A row of controls with the primary actions on the right.
 *
 * Export and Print sit at the TOP of a list, not below twenty-five rows: a
 * control the reader has to scroll past the content to find is a control they
 * do not know exists.
 */
export function Toolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="row between no-print">
      <div className="row">{left}</div>
      <div className="row">{right}</div>
    </div>
  );
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="toggle" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={o.key === value ? 'on' : ''}
          aria-pressed={o.key === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
