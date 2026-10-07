/**
 * CSS-075 (Phase 2 CSS defect loop, 7 Oct 2026). User impact: on Report the Print/Export buttons sit flush on the black
 * verdict box (0px gap), so the bottom of a keyboard focus ring (4px below the button) merges into the box's black fill.
 * Runs without a session: every /api/* call is mocked (mockReport daily), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './support/mocks';

for (const [width, scale] of [[1366, '1'], [768, '1'], [375, '1'], [1366, '1.3']] as const) {
  test(`Report daily @${width} scale ${scale}: at least 6px between the lowest action button and the verdict box`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 768 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, 'daily');
    await page.goto('/?s=report&rt=daily&p=pick&from=2026-09-01&to=2026-09-07');
    await page.locator('.head-actions .row .btn').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.verdict').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.head-actions .row .btn')).map((b) => b.getBoundingClientRect().bottom);
      const v = document.querySelector('.verdict')!.getBoundingClientRect().top;
      return { n: btns.length, gap: v - Math.max(...btns) };
    });
    expect(m.n, 'action buttons present').toBeGreaterThanOrEqual(2);
    expect(m.gap, `gap between the lowest button and the verdict box is ${m.gap}px`).toBeGreaterThanOrEqual(6);
  });
}
