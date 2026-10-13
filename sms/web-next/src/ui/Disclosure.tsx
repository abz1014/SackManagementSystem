import { useState, type ReactNode } from 'react';
import { C } from '../copy';
import './components/Disclosure.css';

export interface DisclosureProps {
  /** Stable id of the section; the open state is remembered under it, per viewer. */
  id: string;
  /** Summary text. Default "How this is calculated"; use U.aboutFigures for "About these figures". */
  label?: string;
  children: ReactNode;
}

const key = (id: string) => `sms.disclosure.${id}`;

function read(id: string): boolean {
  try {
    return window.localStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}
function write(id: string, open: boolean) {
  try {
    window.localStorage.setItem(key(id), open ? '1' : '0');
  } catch {
    /* storage blocked: the page works without memory */
  }
}

export function Disclosure({ id, label = C.howCalculated, children }: DisclosureProps) {
  const [open, setOpen] = useState(() => read(id));
  return (
    <details className="ui-disc" open={open}>
      <summary
        className="ui-disc__sum"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          const next = !open;
          setOpen(next);
          write(id, next);
        }}
      >
        {label}
        <svg className="ui-disc__chev" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </summary>
      <div className="ui-disc__body">{children}</div>
    </details>
  );
}
