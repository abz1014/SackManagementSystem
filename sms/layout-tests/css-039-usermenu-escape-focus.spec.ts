/**
 * CSS-039 (Phase 2 CSS loop, 2 Oct 2026). User impact: a keyboard user who
 * presses Escape inside the user menu loses their place (focus drops to the
 * page body) and has to Tab from the top of the page again.
 * Runs without a session: every /api call is mocked.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

test('Escape in the user menu returns focus to its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockLine(page);
  await page.goto('/?s=line&p=today');
  const trigger = page.locator('button[aria-haspopup="menu"]');
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await trigger.click();
  await page.locator('.menu .toggle button', { hasText: 'Wall' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
  const active = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return { tag: a?.tagName, haspopup: a?.getAttribute('aria-haspopup') };
  });
  expect(active, `activeElement after Escape: ${active.tag}`).toEqual({ tag: 'BUTTON', haspopup: 'menu' });
});
