/**
 * X-2 (owner, 8 Oct 2026). User impact: "Custom range" and "Pick dates" started from the plant clock's today (8 Oct) while the data
 * ends 7 Sep, so the page went blank. They must start from the period already on screen.
 * Runs without a session: every /api/* call is mocked (plant clock 8 Oct 2026, data to 7 Sep), synthetic data only, GET-only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine, LIVE } from './support/mocks';

async function prime(page: Page) {
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockLine(page);
  const live = JSON.parse(JSON.stringify(LIVE));
  const line = live.data.lines[0];
  line.plantNowUtc = '2026-10-08T10:00:00Z';
  line.shift = { ...line.shift, code: 'morning', shiftDate: '2026-10-08', startUtc: '2026-10-08T06:00:00Z', endUtc: '2026-10-08T14:00:00Z' };
  line.dataAsOfUtc = '2026-09-07T16:41:00Z';
  await page.route('**/api/live**', (route) => route.fulfill({ json: live }));
}

for (const [w, h] of [[1366, 768], [375, 812]] as const) {
  test(`X-2 @${w}: Custom range from picked dates keeps those dates (not today)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await prime(page);
    await page.goto('/?s=line&p=pick&from=2026-09-01&to=2026-09-07');
    await page.getByRole('button', { name: 'Custom range' }).click();
    await expect(page).toHaveURL(/p=range/);
    const sp = new URL(page.url()).searchParams;
    expect(sp.get('from'), 'range starts at the picked first day, morning shift').toBe('2026-09-01.morning');
    expect(sp.get('to'), 'range ends at the picked last day, night shift').toBe('2026-09-07.night');
    await page.reload();
    expect(new URL(page.url()).searchParams.get('p'), 'a reload keeps the range').toBe('range');
  });

  test(`X-2 @${w}: Pick dates from a range keeps the range days (not the plant clock week)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await prime(page);
    await page.goto('/?s=line&p=range&from=2026-09-05.morning&to=2026-09-07.night');
    await page.getByRole('button', { name: 'Pick dates' }).click();
    await expect(page).toHaveURL(/p=pick/);
    const sp = new URL(page.url()).searchParams;
    expect(sp.get('from')).toBe('2026-09-05');
    expect(sp.get('to')).toBe('2026-09-07');
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('2026-09-05');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('2026-09-07');
  });
}
