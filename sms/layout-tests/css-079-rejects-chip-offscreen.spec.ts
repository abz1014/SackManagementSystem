/**
 * CSS-079 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: at phone width the Rejects Station / Product filter chip is wider
 * than its row (407px in 335px), so its select is cut off and the page scrolls sideways. Runs without a session: every /api/*
 * call is mocked (mockRejects + mockCommon, whose product list carries long names).
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, META } from './support/mocks';

for (const w of [375, 320]) {
  test(`Rejects filter chips @${w}: inside their row, no page scroll`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 812 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockRejects(page);
    await page.route('**/api/products', (r) => r.fulfill({ json: { products: [
      { productId: 12, description: '201-IH0-SD Super Soft Combed Cotton Yarn Parrot Green', lotCode: null, setpointG: 1960, blend: 'A', countText: '20', tubeType: 'std', tubeWeightG: 45, weightOffsetMinusG: 20, weightOffsetPlusG: 20, activeFlag: true, color: 'PARROT' },
    ] } }));
    await page.goto('/?s=rejects&p=pick&from=2026-09-01&to=2026-09-07');
    await page.locator('label.chip').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('label.chip')) as HTMLElement[];
      const de = document.documentElement;
      return {
        n: chips.length,
        bad: chips.map((c) => { const row = c.parentElement!.getBoundingClientRect(); return { w: Math.round(c.getBoundingClientRect().width), right: c.getBoundingClientRect().right, rowRight: row.right }; }).filter((x) => x.right > x.rowRight + 0.5),
        sw: de.scrollWidth, cw: de.clientWidth,
      };
    });
    expect(m.n, 'chips rendered').toBeGreaterThan(0);
    expect(m.bad, 'chips extending past their row').toEqual([]);
    expect(m.sw, `page scrollWidth ${m.sw} vs ${m.cw}`).toBeLessThanOrEqual(m.cw);
  });
}

// [CSS-079 rework, 7 Oct 2026] The first version of the fix also constrained every `.row` that holds a filter chip. The Readings row
// that holds the "What to list" tab group and the station chip is such a row, so at 375 its tab "Rejected by inspection" was cut down
// to "Reject". Every tab button of that group must show its whole label, inside the viewport.
for (const w of [375, 320]) {
  test(`Readings listing tabs @${w}: every tab shows its full text`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 812 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
    await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows: [], total: 0, page: 1, pageSize: 50 }, metadata: META } }));
    await page.goto('/?s=readings&p=pick&from=2026-09-01&to=2026-09-07');
    await page.locator('main .toggle').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const tg = Array.from(document.querySelectorAll('main .toggle')).find((t) => /inspection/i.test(t.textContent ?? ''));
      const btns = tg ? (Array.from(tg.querySelectorAll('button')) as HTMLElement[]) : [];
      return {
        n: btns.length,
        cut: btns.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > vw + 0.5 || b.getBoundingClientRect().left < -0.5)
          .map((b) => ({ text: (b.textContent ?? '').trim(), sw: b.scrollWidth, cw: b.clientWidth, right: Math.round(b.getBoundingClientRect().right) })),
        vw,
      };
    });
    expect(m.n, 'listing tabs rendered').toBe(4);
    expect(m.cut, `tab buttons cut off at ${m.vw}px`).toEqual([]);
  });
}
