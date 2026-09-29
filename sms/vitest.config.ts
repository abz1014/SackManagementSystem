import { defineConfig } from 'vitest/config';

/**
 * Environment-by-extension split, keyed on FILE EXTENSION (`*.test.tsx`),
 * never on directory (e.g. `web/src/**`). The reason is concrete, not
 * stylistic: `web/src/App.test.ts:18-28` assigns `globalThis.window` itself
 * and then DELETES it in its own `afterEach` (it stubs just enough of
 * `window` — `location.search` — to exercise `parseRoute()`/`readAsOf()`
 * outside a real DOM). A directory glob such as `['web/src/**', 'jsdom']`
 * would drop that file into the jsdom environment too: jsdom already defines
 * `window` and `document` as a matched pair, and `App.test.ts`'s `afterEach`
 * deleting only `window` would leave `document` behind as jsdom's while
 * `window` reverted to undefined — a broken, half-swapped global no test in
 * this suite expects. Keying on `.test.tsx` instead means only an actual
 * React-component test opts into jsdom; `.test.ts` files (including
 * `App.test.ts`) keep running in the plain `node` environment they were
 * written for.
 *
 * Migrated off `environmentMatchGlobs` (Vitest 2/4 top-level config option,
 * removed in Vitest 5 — verified: zero hits for `environmentMatchGlobs` or
 * `MatchGlob` anywhere in the installed `vitest` package, 5.0.2) to Vitest
 * 5's `test.projects` — its supported replacement for a workspace file /
 * multi-environment split within one config — with two projects
 * distinguished only by `include`, each keeping the SAME two globs this file
 * always used (`.test.ts` → node, `.test.tsx` → jsdom). No test file moved,
 * no glob changed, only the mechanism that routes a glob to an environment.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['**/src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'jsdom',
          include: ['**/src/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
