import React from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Self-hosted fonts for the reworked interface — Archivo for prose, DM Mono for
 * every numeral. Imported (not linked from Google Fonts) because the plant PC is
 * air-gapped: a webfont link would simply never resolve there and the app would
 * silently fall back, which is exactly the kind of "worked on my machine" failure
 * this deployment cannot afford. @fontsource ships the woff2 files locally and
 * Vite fingerprints them into the bundle, so there is no runtime network call.
 *
 * Only the six weights the design actually specifies are imported. Pulling the
 * whole family would add ~60 unused font files to the build.
 */
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
