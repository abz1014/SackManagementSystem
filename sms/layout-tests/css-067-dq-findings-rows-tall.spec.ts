/**
 * CSS-067 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on Health the
 * DQ findings table lets the unbreakable check name ("raw_read_without_write")
 * hold ~150 px, squeezing the two prose columns, so every row is ~244 px tall and
 * 33 findings run ~7,400 px down the page.
 * Runs without a session: every /api/* call is mocked (mockAuth + a synthetic
 * /api/operations from ./support/css-067.fixtures).
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, META } from './support/mocks';
import { operationsWithFindings, healthReport, reconciliation } from './support/css-067.fixtures';

for (const width of [1366, 1920]) {
  test(`Health DQ findings @${width}: prose columns get the room, rows shorter, table inside its box`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await page.route('**/api/health', (route) => route.fulfill({ json: healthReport() }));
    await page.route('**/api/system-history**', (route) => route.fulfill({ json: { data: { generations: [], rebuilds: [], verifyRuns: [] }, metadata: META } }));
    await page.route('**/api/reconciliation**', (route) => route.fulfill({ json: reconciliation() }));
    await page.route('**/api/operations**', (route) => route.fulfill({ json: operationsWithFindings(10) }));
    await page.goto('/?s=health');
    const sum = page.locator('details > summary', { hasText: /data quality findings/i }).first();
    await sum.waitFor({ state: 'visible', timeout: 15_000 });
    await sum.click();
    await page.locator('details[open] table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(250);
    const res = await page.evaluate(() => {
      const table = Array.from(document.querySelectorAll('details[open] table')).find((t) => (t.textContent ?? '').includes('Source row')) as HTMLTableElement;
      const ths = Array.from(table.querySelectorAll('thead th'));
      const ci = ths.findIndex((th) => (th.textContent ?? '').trim() === 'Check');
      const checkW = ths[ci].getBoundingClientRect().width;
      const hs = Array.from(table.querySelectorAll('tbody tr')).map((r) => r.getBoundingClientRect().height).sort((a, b) => a - b);
      const box = table.closest('.tw') as HTMLElement;
      return { checkW, median: hs[Math.floor(hs.length / 2)], rows: hs.length, over: table.scrollWidth - box.clientWidth };
    });
    expect(res.rows, 'findings rows rendered').toBe(10);
    expect(res.checkW, 'Check column width (px): an unbreakable name must not hold the room the prose needs').toBeLessThanOrEqual(110);
    expect(res.median, 'median findings row height (px)').toBeLessThanOrEqual(215);
    expect(res.over, 'table wider than its box by (px)').toBeLessThanOrEqual(1);
  });
}
