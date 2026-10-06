/**
 * CSS-051 (Phase 2 CSS loop, 2 Oct 2026). User impact: the reason sheet's table
 * is wider than the sheet, so the Record column (the row id the reader needs)
 * is cut off at the sheet edge or only reachable by scrolling sideways.
 * Runs without a session: every /api call is mocked, synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { primeReasonSheet } from './support/css-051.fixtures';

const CELLS = [
  { w: 1366, h: 768, scale: '1' },
  { w: 1366, h: 768, scale: '1.3' },
  { w: 375, h: 812, scale: '1' },
] as const;

for (const c of CELLS) {
  test(`reason sheet table fits the sheet at ${c.w}@${c.scale}`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* */ } }, c.scale);
    await page.setViewportSize({ width: c.w, height: c.h });
    await primeReasonSheet(page, 20);
    const m = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet') as HTMLElement;
      const sr = sheet.getBoundingClientRect();
      const ths = [...sheet.querySelectorAll('th')].map((t) => t.getBoundingClientRect().right);
      return { sw: sheet.scrollWidth, cw: sheet.clientWidth, sheetRight: sr.right, maxThRight: Math.max(...ths) };
    });
    expect(m.sw, `sheet scrollWidth ${m.sw} vs clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw);
    expect(m.maxThRight, 'every th box inside the sheet').toBeLessThanOrEqual(m.sheetRight + 0.5);
  });
}
