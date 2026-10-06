/**
 * CSS-038 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: after reading a
 * chart with the arrow keys, tabbing away leaves its tooltip hanging over the
 * chart (and stale when the reader scrolls back); only Escape or a pointer
 * gesture removed it.
 * Runs without a session: every /api/* call is mocked (mockWeight), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockWeight } from './support/mocks';

test('Weight @1366: keyboard-pinned chart tooltip is gone once focus leaves the chart', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockWeight(page);
  await page.goto('/?s=weight&p=today');
  const body = page.locator('.chart-frame-body').first();
  await body.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
  await body.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.chart-tip'), 'arrow key shows the tooltip').toHaveCount(1);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect(await page.locator('.chart-tip').count(), 'tooltips still shown after Tab moved focus off the chart').toBe(0);
  // The keyboard still pins it again when focus comes back, and Escape still clears it.
  await body.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.chart-tip')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.chart-tip')).toHaveCount(0);
});
