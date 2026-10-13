import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Icon } from './Icon';
import './components/write.css';

export interface WriteGateProps {
  rank: number;
  minRank: number;
  /** The server's disabledReason, printed verbatim. null/undefined = writes are on. */
  disabledReason?: string | null;
  /** One control element; it receives disabled + aria-describedby when writes are off. */
  children: ReactNode;
}

/** Below rank: nothing at all. At rank, writes off: the control disabled, a lock, the server's own sentence. */
export function WriteGate({ rank, minRank, disabledReason, children }: WriteGateProps) {
  const id = useId();
  if (rank < minRank) return null;
  if (disabledReason == null || disabledReason === '') return <>{children}</>;
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ disabled?: boolean; 'aria-describedby'?: string }>, { disabled: true, 'aria-describedby': id })
    : children;
  return (
    <span className="wr-gate">
      {child}
      <span id={id} className="wr-gate__reason">
        <Icon name="lock" size={16} />
        <span>{disabledReason}</span>
      </span>
    </span>
  );
}
