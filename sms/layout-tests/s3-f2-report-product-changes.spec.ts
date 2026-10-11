/**
 * F-2 (owner, 7 Oct 2026). User impact: the daily and IFL shift-production reports said nothing about product changes, so a
 * manager could not see that a winder changed product at the start of the period. Each report now shows a "Product changes" block
 * (screen only); on paper the same facts are printed once, through the report's notes.
 * Runs without a session: every /api/* call is mocked; payloads are synthetic (two changes shaped like the measured winders 3 and 4).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, reportEnvelope, type ReportKind } from './support/mocks';
import { machineProductEnvelope } from './support/css-040.fixtures';

const L3 = 'Winder 3: 205-IL0-SD #21 to 205-IL0-SD #1021, first cone of the new product 17:20, 11 Aug 2026.';
const L4 = 'Winder 4: 205-IL0-SD #21 to 205-IL0-SD #1021, first cone of the new product 20:03, 11 Aug 2026.';
const TIME = 'Each change is timed at the first cone of the new product on that winder, not at the moment the panel selection was made.';
const change = (station: number, firstUtc: string, before: boolean) => ({
  station, machineName: `M${station}`, day: '2026-08-11', shift: 'evening', fromMaterialId: 21, fromProductName: '205-IL0-SD',
  toMaterialId: 1021, toProductName: '205-IL0-SD', firstUtc, kind: 'between_shifts', fromBeforePeriod: before,
});

function envelope(kind: ReportKind): unknown {
  const env = JSON.parse(JSON.stringify(reportEnvelope(kind)));
  env.data.report.productChanges = [change(3, '2026-08-11T17:20:14.290Z', true), change(4, '2026-08-11T20:03:28.827Z', false)];
  env.data.report.productChangeLabels = { '21': '205-IL0-SD #21', '1021': '205-IL0-SD #1021' };
  env.data.header.reportNotes = [...(env.data.header.reportNotes ?? []), TIME, L3, L4];
  return env;
}

async function open(page: Page, kind: ReportKind, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
  // registered after mockReport, so it wins for this type
  await page.route(`**/api/reports/${kind}**`, (route) => route.fulfill({ json: envelope(kind) }));
  await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-08-11&to=2026-08-11`);
  await page.locator('table.ifl-table').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const count = (page: Page, text: string) => page.evaluate((t) => (document.body.innerText.split(t).length - 1), text);

for (const kind of ['daily', 'shift', 'shift-production'] as const) {
  for (const [w, h] of [[1366, 768], [375, 812]] as const) {
    test(`${kind} @${w}x${h}: the Product changes block shows both changes with its heading and the time rule`, async ({ page }) => {
      await open(page, kind, w, h);
      const heads = (await page.locator('table.ifl-table thead th').allInnerTexts()).map((t) => t.trim());
      expect(heads).toContain('First cone of the new product');
      await expect(page.getByText('(before this period)')).toHaveCount(1);
      await expect(page.getByText('not at the moment the panel selection was made').first()).toBeVisible();
      expect(await noHScroll(page), 'page horizontal scroll').toBe(true);
    });
  }

  test(`${kind} print: the block is hidden and each change is printed exactly once, in the notes`, async ({ page }) => {
    await open(page, kind, 1366, 768);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);
    expect(await count(page, 'First cone of the new product'), 'table heading on paper').toBe(0);
    expect(await count(page, L3), 'winder 3 sentence on paper').toBe(1);
    expect(await count(page, L4), 'winder 4 sentence on paper').toBe(1);
  });
}

test('machine-product print: its changes table stays on paper once, headed "First cone of the new product", and no sentence is added beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, 'daily');
  const env = machineProductEnvelope() as { data: { header: Record<string, unknown>; report: Record<string, unknown> } };
  env.data.report.changes = [change(3, '2026-08-11T17:20:14.290Z', true)];
  env.data.report.labels = { '21': '205-IL0-SD #21', '1021': '205-IL0-SD #1021' };
  env.data.header.reportNotes = ['Synthetic fixture.', TIME];
  await page.route('**/api/reports/machine-product**', (route) => route.fulfill({ json: env }));
  await page.goto('/?s=report&rt=machine-product&p=pick&from=2026-08-05&to=2026-08-16');
  await page.locator('.mp-scroll thead th.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(200);
  expect(await count(page, 'First cone of the new product'), 'table heading on paper').toBe(1);
  expect(await count(page, '(before this period)'), 'the change row on paper').toBe(1);
  expect(await count(page, 'Winder 3:'), 'no per-change sentence beside the table').toBe(0);
  expect(await count(page, 'not at the moment the panel selection was made'), 'time rule on paper').toBe(1);
});
