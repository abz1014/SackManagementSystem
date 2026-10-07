/**
 * CSS-031 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: a multi-page
 * printout of the Readings register (or any non-report screen) carries no
 * "Page X of Y", so loose sheets cannot be put in order or checked for
 * completeness; Report printouts already carry it and must keep exactly one
 * footer per page.
 * Runs without a session: every /api/* call is mocked (./support/mocks),
 * synthetic rows only; the PDF is made by page.pdf() and read with pdftotext.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, META } from './support/mocks';
import { readingRows, pdfPages } from './support/css-031.fixtures';

async function pdfOf(page: Page) {
  await page.emulateMedia({ media: 'print' });
  return page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
}
const footers = (pages: string[]) => pages.map((t) => (t.match(/Page \d+ of \d+/g) ?? []).length);

test('Readings register print: every page carries one "Page X of Y"', async ({ page }) => {
  await page.setViewportSize({ width: 1017, height: 1400 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  const rows = readingRows(60);
  await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows, total: rows.length, page: 1, pageSize: 50 }, metadata: META } }));
  await page.goto('/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('table tbody tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  const pages = pdfPages(await pdfOf(page));
  expect(pages.length, 'the register prints on several pages').toBeGreaterThan(1);
  const n = footers(pages);
  expect(n, `"Page N of ${pages.length}" count on each of ${pages.length} pages`).toEqual(pages.map(() => 1));
  expect(pages[0], 'first page is numbered 1').toContain(`Page 1 of ${pages.length}`);
});

test('Daily report print: still exactly one "Page X of Y" per page', async ({ page }) => {
  await page.setViewportSize({ width: 1123, height: 794 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  await mockReport(page, 'daily');
  await page.goto('/?s=report&rt=daily&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('.verdict').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  const pages = pdfPages(await pdfOf(page));
  expect(footers(pages), `footers per page over ${pages.length} pages`).toEqual(pages.map(() => 1));
});
