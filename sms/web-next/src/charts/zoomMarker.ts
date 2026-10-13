/**
 * "This page is zoomed" marker (CSS-053). The reused ChartFrame shows its "Zoomed in - Back" control when
 * `history.state.zoomFrom` is set, the signal the old app's Back control also used. The redesigned period hook pushes
 * a plain entry, so the kit's Frame stamps the marker onto the entry a chart click just pushed. Back is history.back(),
 * so the chart-adjacent control and the top-bar control can never disagree.
 */
import { useEffect, useState } from 'react';

export const URL_CHANGED = 'sms-next:urlchange';

export function pageIsZoomed(): boolean {
  try {
    return (window.history.state as { zoomFrom?: unknown } | null)?.zoomFrom != null;
  } catch {
    return false;
  }
}

/** Call right after the zoom pushed its entry; `before` is the query string from before the click. */
export function stampZoom(before: string): void {
  try {
    if (window.location.search === before) return; /* no new period: nothing was zoomed */
    window.history.replaceState({ zoomFrom: before }, '');
    window.dispatchEvent(new Event(URL_CHANGED));
  } catch {
    /* no history API: the control simply does not appear */
  }
}

/** Wrap a zoom handler so a successful zoom is marked. */
export function markingZoom<P>(onZoom: (p: P) => void): (p: P) => void {
  return (p) => {
    const before = window.location.search;
    onZoom(p);
    stampZoom(before);
  };
}

export function useZoomed(): boolean {
  const [z, setZ] = useState(pageIsZoomed);
  useEffect(() => {
    const on = () => setZ(pageIsZoomed());
    window.addEventListener('popstate', on);
    window.addEventListener(URL_CHANGED, on);
    on();
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(URL_CHANGED, on);
    };
  }, []);
  return z;
}

export function zoomBack(): void {
  window.history.back();
}
