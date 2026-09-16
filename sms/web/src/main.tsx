import React from 'react';
import { createRoot } from 'react-dom/client';

/**
 * ONE typeface: Instrument Sans, variable, weights 400-700, in a single
 * self-hosted woff2 at public/fonts/InstrumentSans-Variable.woff2.
 *
 * The @font-face lives in app.css rather than here because the whole ramp —
 * including the 600 display cut the wall figures use — comes from that one
 * file. THE PLANT PC HAS NO INTERNET: a Google Fonts <link> would silently
 * fall back to Segoe UI on the one machine that matters, so the file is
 * vendored into the repository and served from the app itself.
 */

import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './app.css';

/**
 * The net under the net. `ErrorBoundary` (wrapped around `<App />` below, and
 * again around the screen area inside `App.tsx`) catches throws during
 * React's own render — that covers almost everything a screen does, since
 * screens render from data. It does NOT catch a throw from a plain event
 * handler, a `setTimeout` callback, or a rejected promise with nobody
 * awaiting it — React boundaries are documented to skip those on purpose.
 * `window.onerror` and `unhandledrejection` are the two handlers below,
 * catching what the boundary structurally cannot.
 *
 * Neither swallows anything: both log with enough to diagnose from the
 * console alone (message, source file, line/column, stack — or the promise's
 * rejection reason) and then let the browser's own default handling continue
 * (`onerror` returns false; the rejection event is not `preventDefault`ed),
 * so nothing here hides a failure that used to be visible. No reporting
 * endpoint is added — this plant is air-gapped, so there is nowhere to send
 * one, and the console is the whole record.
 */
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[window.onerror]', { message, source, lineno, colno }, error?.stack ?? error);
  return false;
};

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as unknown;
  const stack = reason instanceof Error ? reason.stack : undefined;
  console.error('[unhandledrejection]', reason, stack);
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="SMS">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
