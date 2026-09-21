/**
 * React Testing Library integration for this project's component tests —
 * `render` + `act` wired for React 18's concurrent renderer, which is what
 * RTL's own `render`/`act` already give: hand-rolling `createRoot` and `act`
 * around `usePolling`'s async `setState` (`lib/live.tsx:98,102-108`) is what
 * produces flaky tests, per the brief this file was built from.
 *
 * `vitest.config.ts`'s `test` block does not set `globals: true`, so RTL's
 * own automatic per-test `afterEach(cleanup)` (which relies on globals being
 * on, or on a setup file registering it) does NOT fire on its own here.
 * Registering it once, at THIS module's top level, means every test file
 * that imports anything from `testkit/render.tsx` gets it for free — a
 * leaked screen would otherwise keep polling into the next test forever
 * (`usePolling` reschedules its own timer on every tick, `lib/live.tsx:98`),
 * which is a much harder failure to diagnose than "helper unmounts nothing".
 *
 * UX Phase 8 Brief A (21 Sep 2026).
 */
import { afterEach } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { LiveProvider } from '../lib/live';
import { App } from '../App';
import type { Meta } from '../api';
import { installDomStubs } from './domStubs';
import { installFakeFetch, type Routes } from './fetchRouter';
import { LIVE_FIXTURE } from './fixtures';

installDomStubs();

afterEach(() => {
  cleanup();
});

export { render };

/**
 * Mount `node` inside `<LiveProvider>` (`lib/live.tsx:156-182`) — required
 * by anything that calls `useLive()`, which throws outside it
 * (`lib/live.tsx:184-188`). The caller is responsible for installing a
 * fake fetch (`installFakeFetch`) that answers `/api/live` before rendering;
 * this helper does not install one itself; `renderApp` below does, because
 * it drives the whole app rather than one component tree.
 */
export function renderWithLive(
  node: ReactElement,
  opts?: { asOf?: string | null; onMeta?: (m: Meta) => void },
): RenderResult {
  return render(
    <LiveProvider asOf={opts?.asOf ?? null} onMeta={opts?.onMeta}>
      {node}
    </LiveProvider>,
  );
}

/**
 * Mount the real `<App/>` (`../App`) signed in as `role`, with a fake fetch
 * answering `/api/auth/me` and `/api/live` (from `fixtures.ts`'s
 * `LIVE_FIXTURE`) so `App`'s own session bootstrap and the `LiveProvider` it
 * mounts internally both resolve without a network. Extra `routes` are
 * layered on top for whatever a screen under test additionally calls — a
 * route a test also supplies overrides the default (object spread order),
 * so a test can substitute its own `/api/live` fixture wholesale.
 */
export function renderApp(opts: { role: string; displayName?: string | null; routes?: Routes }): RenderResult {
  installFakeFetch({
    '/api/auth/me': { user: { username: 'test-user', displayName: opts.displayName ?? 'Test User', role: opts.role } },
    '/api/live': LIVE_FIXTURE,
    ...opts.routes,
  });
  return render(<App />);
}
