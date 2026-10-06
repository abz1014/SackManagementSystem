/**
 * CSS-063 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: at the Wall text size (1.3) the user menu is narrower than its
 * own "Text size" row, so the Wall button reads "Wa" and the label wraps. Runs without a session: every /api/* call is mocked
 * and the signed-in user has a SHORT synthetic name (the menu width must not depend on a long name).
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

for (const [w, h] of [[1366, 768], [1920, 1080]] as const) {
  test(`user menu @${w}x${h} scale 1.3: Wall button not clipped, label one line, menu on screen`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('sms.uiScale', '1.3'); } catch { /* none */ } });
    await page.setViewportSize({ width: w, height: h });
    await mockCatchAll(page); await mockAuth(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: { user: { username: 'ak', displayName: 'Ali K', role: 'manager' } } }));
    await mockCommon(page); await mockLine(page);
    await page.goto('/?s=line&p=today');
    await page.locator('.icon-btn.initials').waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.icon-btn.initials').click();
    await page.locator('.menu[role="menu"]').waitFor({ state: 'visible' });
    const m = await page.evaluate(() => {
      const wall = Array.from(document.querySelectorAll('.menu .toggle button')).find((b) => /wall/i.test(b.textContent ?? '')) as HTMLElement;
      const label = document.querySelector('.menu .menu-row > span:first-child') as HTMLElement;
      const lh = parseFloat(getComputedStyle(label).lineHeight) || label.getBoundingClientRect().height;
      const menu = document.querySelector('.menu[role="menu"]')!.getBoundingClientRect();
      return { wallSw: wall.scrollWidth, wallCw: wall.clientWidth, labelLines: Math.round(label.getBoundingClientRect().height / lh), left: menu.left, right: menu.right, vw: document.documentElement.clientWidth };
    });
    expect(m.wallSw, `Wall button text ${m.wallSw}px in a ${m.wallCw}px button`).toBeLessThanOrEqual(m.wallCw);
    expect(m.labelLines, 'Text size label lines').toBe(1);
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(m.vw);
  });
}
