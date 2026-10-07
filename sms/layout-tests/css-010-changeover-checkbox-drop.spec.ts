/**
 * CSS-010 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on Product > Changeover at phone width the "Retire" checklist rows
 * wrap (a flex row with flex-wrap), so for a long product name the checkbox drops onto its own line ABOVE the text it
 * belongs to and the reader cannot tell which box goes with which name. Runs without a session: every /api/* call is
 * mocked (mockProductChangeover plus a synthetic product list), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockProductChangeover } from './support/mocks';

const products = {
  products: Array.from({ length: 12 }, (_, i) => ({
    productId: 300 + i, description: `20${i}-IH0-SD long retired product description number ${i}`, lotCode: null, setpointG: 1960,
    blend: `Blend ${String.fromCharCode(65 + i)}`, countText: `${20 + i}`, tubeType: 'std', tubeWeightG: 45,
    weightOffsetMinusG: 20, weightOffsetPlusG: 20, activeFlag: true, color: `COLOUR-${i}`,
  })),
};

for (const w of [375, 480]) {
  test(`CSS-010 Changeover retire checkboxes sit beside the first line of their label at ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 812 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockProductChangeover(page);
    await page.route('**/api/products', (r) => r.fulfill({ json: products }));
    await page.goto('/?s=product&pt=changeover&p=today');
    await page.locator('label.row input[type=checkbox]').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => Array.from(document.querySelectorAll('label.row:has(input[type=checkbox])')).map((l) => {
      const cb = l.querySelector('input[type=checkbox]')!.getBoundingClientRect();
      const span = l.querySelector('span')!;
      const range = document.createRange(); range.selectNodeContents(span);
      const first = range.getClientRects()[0]!;
      const cy = cb.top + cb.height / 2;
      return { cy, top: first.top, bottom: first.bottom, text: span.textContent!.slice(0, 24) };
    }));
    expect(res.length, 'retire rows rendered').toBeGreaterThanOrEqual(12);
    const dropped = res.filter((r) => r.cy < r.top - 1 || r.cy > r.bottom + 1);
    expect(dropped.length, `${dropped.length}/${res.length} checkboxes are not beside their label's first line: ${JSON.stringify(dropped.slice(0, 2))}`).toBe(0);
  });
}
