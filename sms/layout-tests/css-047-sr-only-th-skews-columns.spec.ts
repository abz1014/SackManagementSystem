/**
 * CSS-047 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: tables whose
 * header row is hidden for sighted users (Line machines, Product Running,
 * Catalogue, Changeover) still reserve a 1px-wide column hint per header
 * cell, which makes the browser split the table width unevenly: the product
 * name column takes over half the table and the limits "1,960 g · 1,910 g –
 * 2,010 g" breaks in the middle, so every Catalogue row is ~70px instead of
 * ~44px and the page is hundreds of px longer.
 * Runs without a session: every /api/* call is mocked (mockProductCatalogue
 * + 12 synthetic products), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockProductCatalogue } from './support/mocks';

const PRODUCTS = {
  products: Array.from({ length: 12 }, (_, i) => ({
    productId: 200 + i, description: `20${i}-IH${i % 3}-SD`, lotCode: null, setpointG: 1960 + i,
    blend: 'A', countText: '20', tubeType: 'std', tubeWeightG: 45,
    weightOffsetMinusG: 50, weightOffsetPlusG: 50, activeFlag: i < 10, color: 'PARROT',
  })),
};

test('Catalogue @1366: product rows are one line tall and the limits range does not break', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  await mockProductCatalogue(page);
  await page.route('**/api/products', (route) => route.fulfill({ json: PRODUCTS }));
  await page.goto('/?s=product&pt=catalogue');
  await page.locator('tbody tr th[scope="row"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr')).filter((tr) => /g · /.test(tr.textContent ?? ''));
    const hs = rows.map((r) => r.getBoundingClientRect().height).sort((a, b) => a - b);
    const wrapped = rows.filter((r) => {
      const td = Array.from(r.querySelectorAll('td')).find((c) => /g · /.test(c.textContent ?? ''))!;
      const rg = document.createRange(); rg.selectNodeContents(td);
      return rg.getClientRects().length > 1;
    }).length;
    return { n: rows.length, median: hs[Math.floor(hs.length / 2)]!, wrapped };
  });
  expect(m.n, 'product rows found').toBeGreaterThanOrEqual(10);
  expect(m.median, `median product row ${Math.round(m.median)}px`).toBeLessThanOrEqual(50);
  expect(m.wrapped, `${m.wrapped} of ${m.n} limits cells break across lines`).toBe(0);
});
