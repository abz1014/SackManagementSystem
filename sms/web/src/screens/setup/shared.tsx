/**
 * What every Setup section shares: one way to load, one way to write, one
 * way to say how the write went.
 *
 * Finding H14 (Sep 2026 audit) is the rule behind all three. A fetch failure
 * renders `Failed` with a retry — never an empty table, never a skeleton that
 * spins for ever. And every write reports its own outcome beside the control
 * that made it: before People was fixed, a 403 or a dropped connection was
 * an unhandled rejection, the control snapped back to its old value, and the
 * admin was told nothing. Six new sections arrived in roadmap Phase 1 (14 Sep
 * 2026); this file is how they all get the same discipline without each one
 * re-implementing it slightly differently.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api';
import { W } from '../../lib/words';

/* ---------------------------------------------------------------- loading */

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** Re-fetch. Existing data stays on screen meanwhile, so a table does not flash to a skeleton after every save. */
  reload: () => void;
}

export function useResource<T>(fn: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // The latest fn, read at fetch time, so a section can pass an inline arrow
  // without the effect re-running on every render.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String((e as Error).message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, error, reload };
}

/* ---------------------------------------------------------------- writing */

/**
 * How a write went, in words the admin can act on.
 *
 * The server's own sentence is kept when it has one worth keeping — a 409
 * says "machine number 3 already exists on this line", a 400 carries the
 * rule that was broken in `detail`, a 404 names the missing row. A refusal
 * is named as a refusal. Everything else is the plant connection.
 */
export function failMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return W.notAllowed;
    if (e.status === 400 || e.status === 404 || e.status === 409) return e.detail ?? e.message;
  }
  return W.config.couldNotSave;
}

export type Outcome =
  | { kind: 'ok'; /** The API's note, shown verbatim. */ note: string | null; /** Overrides "Saved." when set. */ said?: string }
  | { kind: 'failed'; message: string }
  | { kind: 'info'; message: string }
  | null;

/** The API's `note`, when the response carries one. */
function noteOf(r: unknown): string | null {
  const n = (r as { note?: unknown } | null)?.note;
  return typeof n === 'string' && n.trim() ? n : null;
}

/**
 * One in-flight write at a time, and its outcome.
 *
 * `run` never throws: the outcome is the report. `after` runs only on
 * success, and is where a section reloads its table.
 */
export function useWrite() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const run = useCallback(async <R,>(work: () => Promise<R>, after?: (r: R) => void, said?: (r: R) => string): Promise<R | undefined> => {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await work();
      setOutcome({ kind: 'ok', note: noteOf(r), said: said?.(r) });
      after?.(r);
      return r;
    } catch (e) {
      setOutcome({ kind: 'failed', message: failMessage(e) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const say = useCallback((o: Outcome) => setOutcome(o), []);
  return { busy, outcome, run, say };
}

/**
 * The outcome, printed under the control that produced it.
 *
 * `quiet` is for a table row, where the changed value IS the confirmation:
 * a "Saved." line under each of fourteen toggles is the overflow IFL
 * objected to. A row still prints every failure, and every note the API
 * sends — the note is information the value cannot carry.
 */
export function Said({ outcome, quiet }: { outcome: Outcome; quiet?: boolean }) {
  if (!outcome) return null;
  if (quiet && !worthARow(outcome)) return null;
  if (outcome.kind === 'failed') {
    return (
      <p className="acc sm" role="status" style={{ marginTop: 8 }}>
        {outcome.message}
      </p>
    );
  }
  if (outcome.kind === 'info') {
    return (
      <p className="mut sm" role="status" style={{ marginTop: 8 }}>
        {outcome.message}
      </p>
    );
  }
  return (
    <div role="status" style={{ marginTop: 8 }}>
      <p className="sm">{outcome.said ?? W.config.saved}</p>
      {/* The worker's or the rule's own words about what happens next — a
          rebuild, a halt on a new generation. Pre-wrapped: the shift note
          carries a command line, and a command line must not be re-flowed. */}
      {outcome.note && (
        <p className="mut sm" style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxWidth: '78ch' }}>
          {outcome.note}
        </p>
      )}
    </div>
  );
}

/**
 * A yes/no cell that writes on click, in the style People already uses for
 * "Active": the word itself is the button, and "no" carries the accent
 * because an inactive row is the one worth noticing.
 */
export function YesNo({ value, busy, label, onToggle }: { value: boolean; busy?: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="linkish sm" disabled={busy} aria-label={label} aria-pressed={value} onClick={onToggle}>
      {value ? W.config.yes : <span className="acc">{W.config.no}</span>}
    </button>
  );
}

/** Whether a quiet (row-level) Said would print anything — so a table does not insert an empty row. */
export function worthARow(o: Outcome): boolean {
  return o != null && (o.kind !== 'ok' || !!o.note || !!o.said);
}

/** Two strings, trimmed, the same? Null and '' count as the same absence. */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

/** A trimmed input, or null when it was left empty. */
export function textOrNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}
