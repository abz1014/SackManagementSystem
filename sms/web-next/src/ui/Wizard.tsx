import type { ReactNode } from 'react';
import { C } from '../copy';
import { Icon } from './Icon';
import './components/write.css';

export interface WizardStep {
  id: string;
  label: string;
}

export interface WizardProps {
  steps: WizardStep[];
  /** Index of the current step. */
  current: number;
  onStep: (index: number) => void;
  /** Why Next is disabled; shown beside it. null/undefined = Next is enabled. */
  nextBlockedReason?: string | null;
  /** Replaces the Next button on the last step (the Execute control, normally inside a WriteGate). */
  finalAction?: ReactNode;
  nextLabel?: string;
  children: ReactNode;
}

/** Plan, Review, Execute. Completed steps can be revisited; later ones cannot be jumped to. */
export function Wizard({ steps, current, onStep, nextBlockedReason, finalAction, nextLabel = C.write.next, children }: WizardProps) {
  const last = current >= steps.length - 1;
  const blocked = !!nextBlockedReason;
  return (
    <div className="wr-wizard">
      <ol className="wr-steps" aria-label={C.write.stepsLabel}>
        {steps.map((s, i) => {
          const done = i < current;
          const here = i === current;
          return (
            <li key={s.id} className={`wr-step${here ? ' wr-step--current' : ''}${done ? ' wr-step--done' : ''}`}
              aria-current={here ? 'step' : undefined}>
              <button type="button" className="wr-step__btn" disabled={!done} onClick={() => onStep(i)}>
                <span className="wr-step__dot" aria-hidden="true">{done ? <Icon name="check" size={14} /> : i + 1}</span>
                <span className="wr-step__label">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="wr-wizard__panel" role="group" aria-label={C.write.stepOf(current + 1, steps.length)}>{children}</div>
      <div className="wr-wizard__nav">
        {current > 0 && <button type="button" className="wr-btn" onClick={() => onStep(current - 1)}>{C.write.back}</button>}
        <span className="wr-wizard__spacer" />
        {last ? finalAction : (
          <>
            {blocked && <span id="wr-next-reason" className="wr-wizard__reason">{nextBlockedReason}</span>}
            <button type="button" className="ui-btn" disabled={blocked} aria-describedby={blocked ? 'wr-next-reason' : undefined}
              onClick={() => onStep(current + 1)}>{nextLabel}</button>
          </>
        )}
      </div>
    </div>
  );
}
