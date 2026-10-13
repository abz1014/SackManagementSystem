/**
 * Playwright config for the web-next (redesign) layout specs (fix-wave T6).
 *
 * Run:  SMS_NEXT_URL=http://127.0.0.1:<port> npx playwright test -c playwright.next.config.ts
 *       (or `npm run test:layout:next` from sms/)
 *
 * SMS_NEXT_URL is REQUIRED and there is no default: a default would be :5173 or :4000, the owner's ports, and
 * these specs must never touch either. The config throws when the variable is unset or names one of them.
 * The server only has to serve the built web-next under /next/ (a scratch build behind a static server or the
 * audit harness); every /api/* call is answered by page.route mocks (layout-tests/next/support/mock.ts).
 * No login, no cookie, no database. `npx vitest run` never picks these files up (they are *.spec.ts under
 * layout-tests/, outside vitest's include globs).
 */
import { defineConfig, devices } from '@playwright/test';

const raw = process.env.SMS_NEXT_URL;
if (!raw) {
  throw new Error('SMS_NEXT_URL is required (the URL of a served web-next build, never :4000 or :5173). Refusing to guess.');
}
let url: URL;
try {
  url = new URL(raw);
} catch {
  throw new Error(`SMS_NEXT_URL is not a URL: ${raw}`);
}
const port = url.port || (url.protocol === 'https:' ? '443' : '80');
if (port === '4000' || port === '5173') {
  throw new Error(`SMS_NEXT_URL points at port ${port}, which belongs to the owner's running app. Serve the build on another port.`);
}

export default defineConfig({
  testDir: './layout-tests/next',
  testMatch: '**/*.spec.ts',
  outputDir: './layout-tests/.output/next-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['json', { outputFile: './layout-tests/.output/next-report.json' }]],
  use: {
    baseURL: url.origin,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }],
});
