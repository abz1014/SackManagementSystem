import type { ReactNode } from 'react';
import { C } from '../copy';
import { U } from './strings';
import './components/ErrorState.css';

export interface ErrorStateProps {
  /** The failed part in plain words: "the reject chart". Rendered as "Couldn't load the reject chart." */
  part: string;
  /** Cause in user terms (second line). Default: the server did not answer. */
  cause?: ReactNode;
  /** Overrides the first line (used by Skeleton's timeout). */
  title?: ReactNode;
  onRetry?: () => void;
  /** Consecutive failures so far. From 2 on, a link to Diagnostics is added. */
  attempts?: number;
  diagnosticsHref?: string;
  /** Keeps the box the failed content had, so nothing jumps. */
  minHeight?: number | string;
}

export function ErrorState({ part, cause, title, onRetry, attempts = 1, diagnosticsHref = U.diagnosticsHref, minHeight }: ErrorStateProps) {
  return (
    <div className="ui-error" role="alert" style={minHeight !== undefined ? { minHeight } : undefined}>
      <p className="ui-error__title">
        <span className="ui-error__glyph" aria-hidden="true" />
        {title ?? C.couldntLoad(part)}
      </p>
      <p className="ui-error__cause">{cause ?? U.serverSilent}</p>
      <div className="ui-error__actions">
        {onRetry && (
          <button type="button" className="ui-btn" onClick={onRetry}>
            {C.tryAgain}
          </button>
        )}
        {attempts >= 2 && (
          <a className="ui-link" href={diagnosticsHref}>
            {U.checkDiagnostics}
          </a>
        )}
      </div>
    </div>
  );
}
