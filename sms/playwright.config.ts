/**
 * WS-PW (23 Sep 2026) — Playwright layout/print harness.
 *
 * WHY THIS EXISTS: `vitest` + jsdom (see `vitest.config.ts`) is this repo's
 * only client test harness, and jsdom computes no layout at all. Every claim
 * about column overflow, table clipping, the Wall board's 1920x1080
 * composition, and print/PDF output has therefore never been verified by a
 * real render — only by viewport resize plus an injected stylesheet in a
 * browser DevTools session, cross-checked against scrollWidth/clientWidth by
 * hand. That is a simulation, not a render. This config adds a second,
 * DELIBERATELY SEPARATE harness that drives a real browser and can actually
 * lay a page out.
 *
 * KEPT OUT OF THE VITEST SUITE ON PURPOSE:
 *  - This file is `playwright.config.ts`, not `vitest.config.ts`, and Vitest
 *    is never pointed at it.
 *  - Every spec lives under `layout-tests/`, named `*.spec.ts`. Vitest's own
 *    `include` (`vitest.config.ts`) only matches `**\/src/**\/*.test.ts(x)`
 *    and `test/**\/*.test.ts` — `layout-tests/**\/*.spec.ts` matches neither
 *    the directory nor the `.test.ts` suffix, so `npx vitest run` cannot
 *    pick these files up even by accident. Proved in this pass by running
 *    `npx vitest run` before and after adding these files — see the WS-PW
 *    report for the exact counts (1782/4/0 both times).
 *  - `@playwright/test` is a ROOT devDependency only (`sms/package.json`),
 *    never added to any workspace's own `package.json`, so it cannot leak
 *    into `api`/`web`/`cli`/`sync-worker`'s own dependency graphs or builds.
 *
 * BROWSER: `channel: 'msedge'` drives the Edge already installed on this
 * machine (verified at
 * `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
 * 153.0.4234.48) instead of downloading a bundled Chromium. Two reasons,
 * both from this project's own constraints: the plant PC is air-gapped (the
 * PDF pipeline, `api/src/services/pdfRender.ts` and friends, already drives
 * installed Edge/Chromium through `puppeteer-core` rather than bundling a
 * browser, for the same reason), and a bundled-Chromium download was
 * unnecessary here since a real, current Chromium-based browser already sits
 * on disk. No `playwright install` download ever ran for this pass — `channel:
 * 'msedge'` finds the system install directly. If a future run ever needs a
 * download (e.g. this machine loses its Edge install), that becomes a
 * runtime dependency decision for the owner, not a default to reach for.
 *
 * AUTH: see `layout-tests/support/auth.ts`. In short — this harness NEVER
 * creates, resets, or guesses a login. It reads `SMS_TEST_USERNAME` /
 * `SMS_TEST_PASSWORD` from the environment (unset today; the owner is
 * creating rank-1/rank-2 accounts separately per the WS-PW brief) and skips,
 * with a clear reason, any spec that needs a signed-in session when they are
 * absent. Specs that don't need a session (today: the Login screen itself)
 * still run.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.SMS_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './layout-tests',
  testMatch: '**/*.spec.ts',
  outputDir: './layout-tests/.output/test-results',
  // Single worker: this drives the SAME dev server + SAME dev database every
  // other tab in this session is using. Nothing here should race another
  // client, and nothing here writes — every spec is a GET plus, where a
  // session is available, one POST /api/auth/login — but staying serial
  // keeps the timing predictable while `layout-tests/support/auth.ts` caches
  // a storage state file other workers would otherwise race to write.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: './layout-tests/.output/html-report', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
