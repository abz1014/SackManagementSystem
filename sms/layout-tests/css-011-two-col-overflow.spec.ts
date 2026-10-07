/**
 * CSS-011 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: below 1100px the report's two-column blocks (by shift / by day)
 * collapse to one column of width "1fr", which cannot shrink under its table, so the page scrolls sideways at phone width.
 * Runs without a session: every /api/* call is mocked (mockReport), synthetic fixtures only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, type ReportKind } from './support/mocks';

for (const kind of ['daily', 'sack'] as ReportKind[]) {
  for (const w of [400, 480]) {
    test(`CSS-011 ${kind} report @${w}x800: the page does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
      await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
      await page.locator('.two-col .tw table').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));
      expect(m.sw, `${kind} @${w}: scrollWidth ${m.sw} vs clientWidth ${m.vw}`).toBeLessThanOrEqual(m.vw);
    });
  }
}
