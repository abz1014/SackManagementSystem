import { useEffect, useState } from 'react';
import { C } from '../copy';
const A11Y = C.a11y;
import { UI_SCALE_KEY, parseUiScale, readUiScale } from './uiScale';

/**
 * Desk / Wall text size (CSS-063). The same saved key the old app wrote (sms.uiScale: "1" Desk, "1.3" Wall), so a screen
 * that was set to Wall stays Wall. Applied as --ui-scale on <html>; shell.css turns that into a page zoom, and the Wall
 * board reads the key itself (uiScale.ts wallScale). Storage is in try/catch: private mode just means the choice does not persist.
 */
const CHOICES = [
  { value: 1, label: A11Y.desk },
  { value: 1.3, label: A11Y.wall },
] as const;

export function applyUiScale(scale: number): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(scale));
  root.dataset.uiScale = String(scale);
}

export function saveUiScale(scale: number): void {
  try {
    localStorage.setItem(UI_SCALE_KEY, String(parseUiScale(String(scale))));
  } catch {
    /* the choice simply will not persist */
  }
}

/** The current scale, applied to the page for as long as the shell is mounted. */
export function useUiScale(): [number, (n: number) => void] {
  const [scale, setScale] = useState<number>(() => readUiScale());
  useEffect(() => {
    applyUiScale(scale);
  }, [scale]);
  return [
    scale,
    (n) => {
      saveUiScale(n);
      setScale(n);
    },
  ];
}

export function TextSizeControl({ scale, onChange }: { scale: number; onChange: (n: number) => void }) {
  return (
    <div className="sh-textsize" role="group" aria-label={A11Y.textSize}>
      <span className="sh-textsize-label" aria-hidden="true">
        {A11Y.textSize}
      </span>
      <div className="sh-textsize-opts">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="menuitemradio"
            aria-checked={scale === c.value}
            className="sh-textsize-opt"
            onClick={() => onChange(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
