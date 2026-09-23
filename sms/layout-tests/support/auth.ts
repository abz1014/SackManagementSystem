/**
 * Session bootstrap for the Playwright layout harness (WS-PW, 23 Sep 2026).
 *
 * THE RULE THIS FILE ENFORCES: this harness never creates, resets, or
 * guesses a login (see `feedback-no-agent-created-accounts` — three agent
 * workers made unasked accounts on 16 Sep 2026, and the WS-PW brief repeats
 * the constraint explicitly). It also never reuses the session cookie
 * already sitting in some other, already-signed-in browser (that cookie is
 * `httpOnly` — `api/src/auth.ts`'s `setSessionCookie` — specifically so a
 * page script, or a tool driving one, cannot read it back out; treating that
 * as an invitation to extract it a different way would defeat the same
 * protection through a side door).
 *
 * The only way in is the same one a real user has: a username and password,
 * supplied here as `SMS_TEST_USERNAME` / `SMS_TEST_PASSWORD` environment
 * variables. They are unset on this machine today — the owner is creating
 * rank-1/rank-2 accounts separately (per the WS-PW brief) — so every spec
 * that needs a session calls `signIn()` and gets back `{ ok: false, reason }`
 * rather than a page, and reports that as a Playwright `test.skip()` with the
 * reason printed, not as a silent pass.
 *
 * Once credentials exist, set the two env vars before `npm run test:layout`
 * and this file logs in through the real `LoginScreen` form (never a
 * back-door token) and caches the resulting storage state at
 * `layout-tests/.auth/state.json` (gitignored) for the rest of that run.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'state.json');

export type SignInResult = { ok: true; context: BrowserContext } | { ok: false; reason: string };

/**
 * Returns a browser context carrying a signed-in session, or a reason it
 * could not — never throws, so callers can turn the failure into a clean
 * `test.skip()` instead of a red, misleading failure.
 */
export async function signIn(browser: Browser, baseURL: string): Promise<SignInResult> {
  const username = process.env.SMS_TEST_USERNAME;
  const password = process.env.SMS_TEST_PASSWORD;

  if (!username || !password) {
    return {
      ok: false,
      reason:
        'SMS_TEST_USERNAME / SMS_TEST_PASSWORD are not set. This harness will not create, ' +
        'reset, or guess a login (WS-PW constraint) — the owner is creating rank-1/rank-2 ' +
        'accounts separately. Set both env vars and re-run to exercise authenticated screens.',
    };
  }

  mkdirSync(AUTH_DIR, { recursive: true });

  // Reuse a cached session from earlier in this same run/day rather than
  // logging in again for every spec file — cheap, and the app-owned session
  // TTL (see api/src/auth.ts) outlives a single test run either way.
  if (existsSync(STORAGE_STATE_PATH)) {
    const context = await browser.newContext({ storageState: STORAGE_STATE_PATH, baseURL });
    if (await hasLiveSession(context, baseURL)) return { ok: true, context };
    await context.close();
  }

  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/');

  // If a stale cached state elsewhere still left the app signed in, don't
  // re-submit the form.
  if (!(await page.getByLabel('Username').isVisible().catch(() => false))) {
    await page.close();
    await context.storageState({ path: STORAGE_STATE_PATH });
    return { ok: true, context };
  }

  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // The form's own two-message error model (see Login.tsx) — either the
  // login form is gone (success) or the alert text is now on screen.
  const result = await Promise.race([
    page
      .getByLabel('Username')
      .waitFor({ state: 'detached', timeout: 8000 })
      .then(() => 'signed-in' as const),
    page
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => 'rejected' as const),
  ]).catch(() => 'timeout' as const);

  if (result !== 'signed-in') {
    const alertText = await page
      .getByRole('alert')
      .textContent()
      .catch(() => null);
    await page.close();
    await context.close();
    return {
      ok: false,
      reason:
        result === 'rejected'
          ? `Login with SMS_TEST_USERNAME was rejected by the server: "${alertText ?? '(no message read)'}"`
          : 'Login attempt timed out waiting for a response from /api/auth/login.',
    };
  }

  await page.close();
  await context.storageState({ path: STORAGE_STATE_PATH });
  return { ok: true, context };
}

async function hasLiveSession(context: BrowserContext, baseURL: string): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(baseURL + '/');
    const stillOnLogin = await page.getByLabel('Username').isVisible().catch(() => false);
    return !stillOnLogin;
  } finally {
    await page.close();
  }
}

/** Convenience for specs: a signed-in page, or null plus the reason to skip on. */
export async function signedInPage(
  browser: Browser,
  baseURL: string,
): Promise<{ page: Page; context: BrowserContext } | { page: null; reason: string }> {
  const r = await signIn(browser, baseURL);
  if (!r.ok) return { page: null, reason: r.reason };
  const page = await r.context.newPage();
  return { page, context: r.context };
}
