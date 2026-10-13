import { C } from '../copy';
import '../components/state.css';

/** The four server-decided states (stationStatus.ts uses 'nodata'). Never computed in the client. */
export type UiState = 'ok' | 'watch' | 'act' | 'nodata';

export const STATE_GLYPH: Record<UiState, string> = { ok: '●', watch: '▲', act: '■', nodata: '○' };
export const STATE_WORD: Record<UiState, string> = {
  ok: C.state.ok,
  watch: C.state.watch,
  act: C.state.act,
  nodata: C.state.noData,
};

export interface StatusPillProps {
  state: UiState;
  /** Optional short noun: "Act: 3 stations". */
  noun?: string;
  /** Glyph only with a text tooltip; use only where a word sits adjacent. */
  compact?: boolean;
  className?: string;
}

export function StatusPill({ state, noun, compact, className }: StatusPillProps) {
  const word = STATE_WORD[state];
  const text = noun ? `${word}: ${noun}` : word;
  if (compact) {
    return (
      <span className={`pill pill-compact pill-${state} ${className ?? ''}`} title={text} role="img" aria-label={text}>
        <span className="pill-glyph" aria-hidden="true">{STATE_GLYPH[state]}</span>
      </span>
    );
  }
  return (
    <span className={`pill pill-${state} ${className ?? ''}`} data-state={state}>
      <span className="pill-glyph" aria-hidden="true">{STATE_GLYPH[state]}</span>
      <span className="pill-word">{text}</span>
    </span>
  );
}
