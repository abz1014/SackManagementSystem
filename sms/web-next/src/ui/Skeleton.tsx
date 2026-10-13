import { useEffect, useState } from 'react';
import { C } from '../copy';
import { ErrorState } from './ErrorState';
import './components/Skeleton.css';

export interface SkeletonProps {
  /** Which part is loading, for the timeout message. */
  part: string;
  /** Give the same box as the content it replaces, so nothing shifts. */
  width?: number | string;
  height?: number | string;
  /** Text-line rows instead of one block. */
  lines?: number;
  /** Default 10 000 ms (DESIGN-SYSTEM 6.15). */
  timeoutMs?: number;
  onRetry?: () => void;
}

export function Skeleton({ part, width = '100%', height = 96, lines, timeoutMs = 10_000, onRetry }: SkeletonProps) {
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
  return (
    <div className="ui-skel" aria-busy="true" aria-label={`Loading ${part}`} role="status" style={{ width, height }}>
      {lines ? Array.from({ length: lines }, (_, i) => <span key={i} className="ui-skel__line" style={{ width: i === lines - 1 ? '60%' : '100%' }} />) : null}
    </div>
  );
}
