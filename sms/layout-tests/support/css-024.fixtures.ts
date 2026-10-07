/** CSS-024 fixture: a reject Pareto with realistic reason names (unnamed codes read "Code 10/1 — not yet named"), counts up to five digits. Synthetic only. */
import { META, mockCatchAll, mockAuth, mockCommon, mockRejects } from './mocks';
import type { Page } from '@playwright/test';

const ROWS: Array<[number, string | null, string, number | null, number | null, number]> = [
  [1, null, 'quality', 10, 1, 12840],
  [2, 'Bad tube', 'quality', 3, 5, 9210],
  [3, null, 'quality', 12, 4, 4120],
  [4, null, 'weight', null, null, 2650],
  [5, null, 'quality', 7, 2, 1180],
  [6, 'Yarn break at the guide', 'quality', 8, 9, 640],
  [7, null, 'quality', null, null, 210],
];

export async function primeRejectsLongReasons(page: Page, width: number, scale = 1) {
  const total = ROWS.reduce((s, r) => s + r[5], 0);
  let cum = 0;
  const reasons = ROWS.map(([id, label, type, tube, mat, count]) => {
    cum += count;
    return { rejectCodeId: id, rejectType: type, tubeCode: tube, materialCode: mat, label, displayLabel: label ?? `code:${id}`, count, pct: (100 * count) / total, cumulativePct: (100 * cum) / total };
  });
  await page.setViewportSize({ width, height: 812 });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* storage may be blocked */ } }, scale);
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockRejects(page);
  await page.route('**/api/rejects**', (route) => {
    if (route.request().url().includes('by-day-code')) return route.fulfill({ json: { data: { rows: [] }, metadata: META } });
    return route.fulfill({ json: { data: { total, reasons }, metadata: META } });
  });
  await page.goto('/?s=rejects&p=pick&from=2026-08-05&to=2026-09-07');
  await page.locator('.bars div').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}
