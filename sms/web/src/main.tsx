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
import './app.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
