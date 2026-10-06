/**
 * CSS-065 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on the Sacks stock ledger the Closing column is cut by a few
 * pixels at tablet width in kg mode (the table is wider than its box, so the last digits of every Closing figure need an
 * unmarked sideways scroll); at the Wall text size (1.3) on a desktop width it was cut too before CSS-064 widened the box.
 * Runs without a session: every /api/* call is mocked (mockSacks fixture scaled to plant magnitudes), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockSacks } from './support/mocks';
import { bigSackStock } from './support/css-065.fixtures';

const CELLS = [
  { w: 768, h: 1024, scale: 1, extra: '&su=kg' },
  { w: 1366, h: 768, scale: 1.3, extra: '' },
  { w: 1366, h: 768, scale: 1.3, extra: '&su=kg' },
] as const;

for (const c of CELLS) {
  test(`Sacks ledger @${c.w}x${c.h} scale ${c.scale}${c.extra}: table fits its box, Closing column inside`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* none */ } }, c.scale);
    await page.setViewportSize({ width: c.w, height: c.h });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockSacks(page);
    await page.route('**/api/sacks/stock**', (r) => r.fulfill({ json: bigSackStock(100) }));
    await page.goto('/?s=sacks&p=pick&from=2026-08-05&to=2026-09-07' + c.extra);
    await page.locator('tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const t = document.querySelector('tr.click')!.closest('table') as HTMLElement;
      const box = t.closest('.tw') as HTMLElement;
      const last = t.querySelector('thead th:last-child')!.getBoundingClientRect();
      return { sw: box.scrollWidth, cw: box.clientWidth, closingRight: last.right, boxRight: box.getBoundingClientRect().right };
    });
    expect(m.sw, `ledger scrollWidth ${m.sw} vs box ${m.cw}`).toBeLessThanOrEqual(m.cw + 1);
    expect(m.closingRight, 'Closing column right edge vs box right').toBeLessThanOrEqual(m.boxRight + 1);
  });
}
