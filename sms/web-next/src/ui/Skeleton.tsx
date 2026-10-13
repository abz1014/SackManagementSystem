import { useEffect, useState } from 'react';
import { C } from '../copy';
import { ErrorState } from './ErrorState';
import { KpiCard } from './KpiCard';
import './components/Skeleton.css';

export interface SkeletonProps {
  /** Which part is loading, for the timeout message. */
  part: string;
  /** Give the same box as the content it replaces, so nothing shifts. */
  width?: number | string;
  height?: number | string;
  /** Text-line rows instead of one block. */
  lines?: number;
  /**
   * A table-shaped placeholder: the DataTable header row plus this many body rows. Each row is
   * `rowHeight` tall (default the DataTable's own --row-h token), so loaded and loading tables
   * match when the row count is known.
   */
  rows?: number;
  rowHeight?: number | string;
  /** Default 10 000 ms (DESIGN-SYSTEM 6.15). */
  timeoutMs?: number;
  onRetry?: () => void;
}

export function Skeleton({ part, width = '100%', height = 96, lines, rows, rowHeight = 'var(--row-h)', timeoutMs = 10_000, onRetry }: SkeletonProps) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const t = setTimeout(() => setSlow(true), timeoutMs);
    return () => clearTimeout(t);
  }, [part, timeoutMs]);

  if (slow) {
    return (
      <div style={{ width }}>
        <ErrorState part={part} title={C.ui.takingTooLong(part)} onRetry={onRetry} minHeight={height} />
      </div>
    );
  }
  if (rows) {
    return (
      <div className="ui-skel ui-skel--rows" aria-busy="true" aria-label={`Loading ${part}`} role="status" style={{ width }}>
        <span className="ui-skel__head" />
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="ui-skel__row" style={{ height: rowHeight }}>
            <span className="ui-skel__line" />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="ui-skel" aria-busy="true" aria-label={`Loading ${part}`} role="status" style={{ width, height }}>
      {lines ? Array.from({ length: lines }, (_, i) => <span key={i} className="ui-skel__line" style={{ width: i === lines - 1 ? '60%' : '100%' }} />) : null}
    </div>
  );
}

/**
 * A row of KPI cards while their figures load. Renders the real card (KpiCard loading), so the
 * box, the two-line label slot and the padding are the loaded card's own. `cards` is how many
 * the loaded row will hold; `stated` adds the state-pill placeholder for judged cards.
 */
export function KpiRowSkeleton({ cards = 4, label = '', stated = false, minWidth }: { cards?: number; label?: string; stated?: boolean; minWidth?: number }) {
  return (
    <div className="ui-skel-kpis" style={minWidth ? ({ ['--kpi-min' as string]: `${minWidth}px` }) : undefined} aria-busy="true">
      {Array.from({ length: cards }, (_, i) => (
        <KpiCard key={i} loading label={label} state={stated ? 'nodata' : undefined} />
      ))}
    </div>
  );
}

/** A chart card while its data loads: the Frame's own card, a title-height bar, and the plot at `height` (Frame's default 260). */
export function ChartSkeleton({ part, height = 260 }: { part: string; height?: number }) {
  return (
    <section className="ck-frame ui-skel-chart" aria-busy="true">
      <header className="ck-head"><span className="ui-skel-chart__title" /></header>
      <div className="skel ck-skel" style={{ height }} role="status" aria-label={`Loading ${part}`} />
    </section>
  );
}
