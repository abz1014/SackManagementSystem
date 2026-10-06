/**
 * CSS-009 (Phase 2 CSS defect loop, 5 Oct 2026).
 *
 * User impact: on Product > Catalogue at a narrow window (about 698px and
 * below) the "Product limits" history grid sizes its single implicit column to
 * the widest table inside it, so the grid is wider than its block and the
 * limits history runs off the right edge of the page.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts,
 * synthetic data only), the same approach as charts.spec.ts.
 *
 * Measures: the limits grid's scrollWidth must not exceed its parent's
 * clientWidth. (The whole-document overflow at 375 also has an unrelated
 * cause, CSS-007, so it is deliberately not asserted here.)
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockProductCatalogue } from './support/mocks';

const version = (id: number, sp: number) => ({
  versionId: id,
  setpointG: sp,
  offsetMinusG: -40,
  offsetPlusG: 40,
  effectiveFromUtc: '2026-09-01T06:00:00Z',
  effectiveFromPlant: '2026-09-01T11:00:00Z',
  effectiveIsLowerBound: id % 2 === 0,
  source: 'sms_local',
  changedBy: 'synthetic.engineer.with.a.long.name',
  reason: 'Synthetic reason with a_long_unbroken_token_that_forces_the_table_wider_than_a_phone_screen_0123456789',
  recordedAtUtc: '2026-09-01T06:00:00Z',
  label: `${sp} ± 40 g`,
});

async function prime(page: Page) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockProductCatalogue(page);
  // Registered after the helper's own empty history so it wins (last route first).
  await page.route('**/api/products/limits/history**', (route) =>
    route.fulfill({
      json: {
        products: [
          { productId: 11, label: 'Synthetic product A', activeFlag: true, versions: [version(3, 1970), version(2, 1960), version(1, 1950)] },
          { productId: 12, label: 'Synthetic product B', activeFlag: true, versions: [version(6, 1980), version(5, 1975)] },
        ],
      },
    }),
  );
  await page.goto('/?s=product&pt=catalogue');
  await page.getByText('Synthetic product A').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const width of [375, 600, 621]) {
  test(`Product limits grid fits its block at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prime(page);
    const r = await page.evaluate(() => {
      const grid = Array.from(document.querySelectorAll<HTMLElement>('main div')).find(
        (d) => d.style.display === 'grid' && d.style.gap === '18px',
      );
      if (!grid) return null;
      const parent = grid.parentElement!;
      return { gridScroll: grid.scrollWidth, gridClient: grid.clientWidth, parentClient: parent.clientWidth };
    });
    expect(r, 'limits grid (display:grid; gap:18px) not found').not.toBeNull();
    expect(r!.gridScroll, `grid scrollWidth ${r!.gridScroll} vs parent clientWidth ${r!.parentClient}`).toBeLessThanOrEqual(r!.parentClient);
  });
}
