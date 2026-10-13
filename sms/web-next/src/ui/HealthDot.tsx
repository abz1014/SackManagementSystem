import { useEffect, useId, useRef, useState } from 'react';
import { fmt, health as healthLib } from '../bridge/lib';
import { W } from '../bridge/words';
import { C } from '../copy';
import { fmtDateTime, fmtTime } from '../lib/fmt';

type Health = healthLib.Health;

export type DotState = 'ok' | 'watch' | 'act' | 'nodata';

export interface HealthView { state: DotState; short: string; sentence: string }

/**
 * Renders the verdict lib/health.ts (assessHealth) already made. No thresholds here: only 'ok' is OK,
 * and a missing verdict (null: loading or failed) is "Status unknown", never OK.
 */
export function describeHealth(health: Health | null, plantNowUtc?: string | null): HealthView {
  /* One date format (lib/fmt, 24-hour): a time alone when it is the plant's current day, else the full date and time. */
  const when = (iso: string) => (!plantNowUtc || iso.slice(0, 10) === plantNowUtc.slice(0, 10) ? fmtTime(iso) : fmtDateTime(iso));
  if (!health) return { state: 'nodata', short: C.shell.health.unknown, sentence: C.shell.health.unknownSentence };
  switch (health.kind) {
    case 'ok':
      return {
        state: 'ok',
        short: C.shell.health.ok,
        sentence:
          health.lagSeconds != null
            ? W.lag.ok(when(health.readingUtc), fmt.fmtSpan(health.lagSeconds))
            : W.lag.okNoLag(when(health.readingUtc)),
      };
    case 'late':
      return { state: 'watch', short: C.shell.health.late, sentence: W.lag.late(fmt.fmtSpan(health.lagSeconds)) };
    case 'lag_unknown':
      return { state: 'watch', short: C.shell.health.lagUnknown, sentence: W.lag.lagUnknown(when(health.readingUtc)) };
    case 'stale':
      return {
        state: 'act',
        short: C.shell.health.stale,
        sentence: health.readingUtc ? C.noDataSince(when(health.readingUtc)) : W.lag.stale('-'),
      };
    default:
      return { state: 'nodata', short: C.shell.health.none, sentence: W.lag.noData };
  }
}

export interface HealthDotProps {
  /** assessHealth output; null while loading or after a failed fetch. */
  health: Health | null;
  plantNowUtc?: string | null;
  /** Opens Diagnostics (System > Diagnostics). */
  onOpen: () => void;
}

export function HealthDot({ health, plantNowUtc, onOpen }: HealthDotProps) {
  const v = describeHealth(health, plantNowUtc);
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="sh-health" ref={root}>
      <button
        type="button"
        className="sh-health-btn"
        aria-expanded={open}
        aria-controls={id}
        data-health-state={v.state}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="state pill" data-state={v.state}>
          <span className="sr-only">{`${C.state[v.state === 'nodata' ? 'noData' : v.state]}: `}</span>
          {v.short}
        </span>
      </button>
      {open && (
        <div className="popover sh-popover" id={id} role="dialog" aria-label={C.shell.health.title}>
          <p className="sh-pop-text">{v.sentence}</p>
          <button
            type="button"
            className="btn quiet"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          >
            {C.shell.health.open}
          </button>
        </div>
      )}
    </div>
  );
}
