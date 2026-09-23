/**
 * The one screen this harness can measure without a session: `LoginScreen`
 * (`web/src/screens/Login.tsx`) renders for `user === null` unconditionally
 * (`App.tsx`), before any API call needs a cookie. Every other spec in this
 * directory needs `SMS_TEST_USERNAME`/`SMS_TEST_PASSWORD` (see
 * `support/auth.ts`) and is unset on this machine today.
 *
 * This file carries the ONE deliberate-breakage proof required by the WS-PW
 * brief (see WS-PW-REPORT.md for the full before/after transcript): with
 * `.login form { max-width: 380px }` in `web/src/app.css` temporarily
 * widened past the 1366px viewport, this same assertion was observed to
 * fail, then the edit was reverted and `git diff` confirmed clean. That
 * exercise is NOT re-run by this file on every pass — it is a one-time,
 * hand-verified proof that the assertion below is a real regression check
 * and not one that always passes.
 */
import { test, expect } from '@playwright/test';
import { measureHorizontalOverflow } from './support/overflow';

test.describe('Login screen layout', () => {
  test('no horizontal overflow at 1366x768', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    await expect(page.getByLabel('Username')).toBeVisible();

    const m = await measureHorizontalOverflow(page.locator('html'));
    console.log(`[login-screen 1366x768] scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth} overflowPx=${m.overflowPx}`);
    expect(m.overflows, `page scrolls horizontally by ${m.overflowPx}px at 1366x768`).toBe(false);
  });

  test('no horizontal overflow at 1920x1080', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.getByLabel('Username')).toBeVisible();

    const m = await measureHorizontalOverflow(page.locator('html'));
    console.log(`[login-screen 1920x1080] scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth} overflowPx=${m.overflowPx}`);
    expect(m.overflows, `page scrolls horizontally by ${m.overflowPx}px at 1920x1080`).toBe(false);
  });
});
