/**
 * CSS-048 (Phase 2 CSS defect loop, 7 Oct 2026). User impact: on Line the four
 * KPI figures sit at different heights (the three clickable ones centre in
 * grid cells stretched to the wrapping fourth), so the row reads as ragged
 * numbers instead of one baseline.
 * Runs without a session: every /api/* call is mocked (mockLine), synthetic data.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

for (const [width, scale] of [[1366, '1'], [1366, '1.3'], [1920, '1']] as const) {
  test(`Line @${width} scale ${scale}: the KPI figure values share one top (within 2px)`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 768 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockLine(page);
    await page.goto('/?s=line&p=today');
    await page.locator('.figs .fig-val').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    const tops = await page.evaluate(() => {
      const row = document.querySelector('.figs');
      return Array.from(row?.querySelectorAll('.fig-val') ?? []).map((e) => Math.round(e.getBoundingClientRect().top * 10) / 10);
    });
    expect(tops.length, 'figure count').toBeGreaterThanOrEqual(3);
    const spread = Math.max(...tops) - Math.min(...tops);
    expect(spread, `figure tops ${JSON.stringify(tops)} differ by ${spread}px`).toBeLessThanOrEqual(2);
  });
}
