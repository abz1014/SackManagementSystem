/**
 * CSS-008 (Phase 2 CSS loop, 2 Oct 2026). User impact: at phone widths the
 * Rejects "By day and reason" table pushes the whole page sideways (page-level
 * horizontal scroll). Runs without a session: mocked API, synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, META } from './support/mocks';

const rows = Array.from({ length: 35 }, (_, i) => ({
  day: `2026-09-0${1 + Math.floor(i / 5)}`, rejectType: i % 2 ? 'weight' : 'quality',
  tubeCode: i % 5, materialCode: 5, rejectCodeId: i, label: null,
  displayLabel: `quality:${i % 5}:5`, isPass: false, count: 120 + i, cones: 9800 + i,
  inspected: 9900 + i, ratePct: 1.23,
}));

test('Rejects by-day table does not widen the page at 440', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 900 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockRejects(page);
  await page.route('**/api/rejects/by-day-code**', (r) => r.fulfill({ json: { data: { dayBasis: 'production_day', rows }, metadata: META } }));
  await page.goto('/?s=rejects&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('table tbody tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const tbl = document.querySelector('table tr.click')!.closest('table') as HTMLElement;
    let el: HTMLElement | null = tbl.parentElement; let scroller = false;
    while (el && el !== document.body) { const o = getComputedStyle(el).overflowX; if (o === 'auto' || o === 'scroll') { scroller = true; break; } el = el.parentElement; }
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth, scroller, tblRight: tbl.getBoundingClientRect().right };
  });
  expect(m.scroller, 'by-day table sits in an overflow-x auto/scroll element').toBe(true);
  expect(m.sw, `page scrollWidth ${m.sw} vs clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw);
});
