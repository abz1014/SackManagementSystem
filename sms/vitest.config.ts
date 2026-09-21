import { defineConfig } from 'vitest/config';

/**
 * `environmentMatchGlobs` is keyed on FILE EXTENSION (`*.test.tsx`), never on
 * directory (e.g. `web/src/**`) — verified against the installed vitest
 * (2.1.9, `node_modules/vitest/package.json`) rather than assumed, and
 * proved with a real run (`web/src/ui/ErrorBoundary.test.tsx`, UX Phase 8
 * Brief A). The reason is concrete, not stylistic:
 * `web/src/App.test.ts:18-28` assigns `globalThis.window` itself and then
 * DELETES it in its own `afterEach` (it stubs just enough of `window` —
 * `location.search` — to exercise `parseRoute()`/`readAsOf()` outside a real
 * DOM). A directory glob such as `['web/src/**', 'jsdom']` would drop that
 * file into the jsdom environment too: jsdom already defines `window` and
 * `document` as a matched pair, and `App.test.ts`'s `afterEach` deleting only
 * `window` would leave `document` behind as jsdom's while `window` reverted
 * to undefined — a broken, half-swapped global no test in this suite expects.
 * Keying on `.test.tsx` instead means only an actual React-component test
 * opts into jsdom; `.test.ts` files (including `App.test.ts`) keep running in
 * the plain `node` environment they were written for.
 */
export default defineConfig({
  test: {
    include: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
  },
});
