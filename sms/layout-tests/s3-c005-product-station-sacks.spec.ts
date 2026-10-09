/**
 * C-005 (owner option A, 7 Oct 2026; DEFECTS.md D-181). User impact: a Product report narrowed to one winder printed the
 * whole line's sack figures beside that winder's cones; it must show no Sacks column and one sentence saying why.
 * Runs without a session: every /api/* call is mocked, payloads are synthetic (support/s3-c005.fixtures.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './support/mocks';
import { productReportEnvelope } from './support/s3-c005.fixtures';

async function open(page: Page, stationFiltered: boolean, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, 'station');
  // registered after mockReport, so it wins for the product type
  await page.route('**/api/reports/product**', (route) => route.fulfill({ json: productReportEnvelope(stationFiltered) }));
  await page.goto(`/?s=report&rt=product&p=pick&from=2026-09-01&to=2026-09-07${stationFiltered ? '&st=4' : ''}`);
  await page.locator('table.ifl-table').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

for (const [w, h] of [[1366, 768], [375, 812]] as const) {
  test(`product report, station filter @${w}x${h}: no Sacks column, the reason is visible once`, async ({ page }) => {
    await open(page, true, w, h);
    const heads = (await page.locator('table.ifl-table thead th').allInnerTexts()).map((t) => t.trim());
    expect(heads, 'column headings').not.toContain('Sacks');
    await expect(page.getByText('the sack scale records no winder')).toHaveCount(1);
    await expect(page.getByText('the sack scale records no winder')).toBeVisible();
    expect(await noHScroll(page), 'page horizontal scroll').toBe(true);
  });
  test(`product report, no station filter @${w}x${h}: the Sacks column is there, no reason printed`, async ({ page }) => {
    await open(page, false, w, h);
    const heads = (await page.locator('table.ifl-table thead th').allInnerTexts()).map((t) => t.trim());
    expect(heads).toContain('Sacks');
    await expect(page.getByText('the sack scale records no winder')).toHaveCount(0);
    expect(await noHScroll(page), 'page horizontal scroll').toBe(true);
  });
}
