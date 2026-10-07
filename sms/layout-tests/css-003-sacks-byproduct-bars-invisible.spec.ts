/**
 * CSS-003 (Phase 2 CSS defect loop, 5 Oct 2026). User impact: on Sacks at
 * phone width the "By product" bar charts reserve a fixed 330/420 px label
 * gutter, so the bars shrink to 1 px and the value labels run off the chart:
 * the comparison the chart exists for cannot be seen.
 * Runs without a session: every /api/* call is mocked (mockSacks), synthetic data.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockSacks } from './support/mocks';

for (const [width, scale] of [[320, '1'], [375, '1'], [500, '1'], [530, '1'], [375, '1.3']] as const) {
  test(`Sacks @${width} scale ${scale}: By-product bars are visible and their value labels stay inside the chart`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 900 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockSacks(page);
    await page.goto('/?s=sacks&p=today');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const out: { aria: string; widest: number; overshoot: number }[] = [];
      for (const svg of Array.from(document.querySelectorAll('.chart-frame svg'))) {
        const aria = svg.getAttribute('aria-label') ?? '';
        if (!/product/i.test(aria)) continue;
        const sr = svg.getBoundingClientRect();
        const widest = Math.max(0, ...Array.from(svg.querySelectorAll('rect')).map((r) => r.getBoundingClientRect().width));
        const over = Math.max(-999, ...Array.from(svg.querySelectorAll('text')).map((t) => t.getBoundingClientRect().right - sr.right));
        out.push({ aria, widest, overshoot: over });
      }
      return out;
    });
    expect(res.length, 'By-product charts are drawn').toBeGreaterThanOrEqual(1);
    for (const c of res) {
      expect(c.widest, `${c.aria}: widest bar`).toBeGreaterThanOrEqual(40);
      expect(c.overshoot, `${c.aria}: right-most text overshoots the svg by`).toBeLessThanOrEqual(0.5);
    }
  });
}
