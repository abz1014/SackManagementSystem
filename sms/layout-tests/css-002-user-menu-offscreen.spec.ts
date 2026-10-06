/**
 * CSS-002 (Phase 2 CSS defect loop, 5 Oct 2026) - the user menu opens off the left edge of the window.
 *
 * USER IMPACT: when the right-hand group of the top bar wraps, the user menu (anchored to its right edge) opens up to
 * 107px past the LEFT edge of the window, so "Sign out", "Change password" and the text-size switch are cut off and
 * the reader cannot sign out or change the text size.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts) and the signed-in user is a synthetic name
 * (a short one and a 30-character one: the menu position must not depend on the name). The server only serves the
 * built static app.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

const CELLS = [
  { w: 375, h: 812, scale: 1, url: '/?s=line&p=today' },
  { w: 375, h: 812, scale: 1, url: '/?s=line&p=pick&from=2026-09-01&to=2026-09-07' },
  { w: 600, h: 900, scale: 1, url: '/?s=line&p=today' },
  { w: 1050, h: 900, scale: 1, url: '/?s=line&p=pick&from=2026-09-01&to=2026-09-07' },
  { w: 1575, h: 900, scale: 1, url: '/?s=line&p=today' },
  { w: 1366, h: 768, scale: 1.3, url: '/?s=line&p=pick&from=2026-09-01&to=2026-09-07' },
  { w: 1920, h: 1080, scale: 1.3, url: '/?s=line&p=today' },
] as const;

const NAMES = ['Ali Khan', 'Muhammad Abdullah Sajid Al-Rehman K'] as const;

async function prime(page: Page, scale: number, url: string, displayName: string) {
  await mockCatchAll(page);
  await mockAuth(page);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user: { username: 'layout-test', displayName, role: 'manager' } } }),
  );
  await mockCommon(page);
  await mockLine(page);
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  await page.goto(url);
  await page.locator('.icon-btn.initials').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

for (const c of CELLS) {
  for (const name of NAMES) {
    test(`CSS-002 user menu fully on screen at ${c.w}x${c.h}@${c.scale} ${c.url.includes('pick') ? 'pick' : 'today'} (${name.length}-char name)`, async ({ page }) => {
      await page.setViewportSize({ width: c.w, height: c.h });
      await prime(page, c.scale, c.url, name);
      await page.locator('.icon-btn.initials').click();
      const menu = page.locator('.menu[role="menu"]');
      await menu.waitFor({ state: 'visible' });
      const m = await page.evaluate(() => {
        const box = (el: Element | null) => { const r = el!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const menuEl = document.querySelector('.menu[role="menu"]');
        const out = Array.from(document.querySelectorAll('.menu .menu-item')).find((b) => /sign out/i.test(b.textContent ?? ''));
        const pw = Array.from(document.querySelectorAll('.menu .menu-item')).find((b) => /password/i.test(b.textContent ?? ''));
        const toggle = document.querySelector('.menu .menu-row .toggle');
        return { menu: box(menuEl), signOut: box(out ?? null), password: box(pw ?? null), toggle: box(toggle), vw: document.documentElement.clientWidth };
      });
      expect(m.menu.left, `menu left edge ${m.menu.left} must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(m.menu.right, `menu right edge ${m.menu.right} must be <= viewport ${m.vw}`).toBeLessThanOrEqual(m.vw);
      for (const k of ['signOut', 'password', 'toggle'] as const) {
        expect(m[k].left, `${k} left edge on screen`).toBeGreaterThanOrEqual(0);
        expect(m[k].right, `${k} right edge on screen`).toBeLessThanOrEqual(m.vw);
      }
    });
  }
}
