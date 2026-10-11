/**
 * F-1 (owner, 7 Oct 2026). User impact: on Product > Running a winder that is not running showed no product, so
 * nobody could see what it last produced. Each such winder must now say its last stamped product and the time of
 * that cone, in at most three lines of text, and the thresholds are stated once.
 * Runs without a session: every /api/* call is mocked; the payload below is synthetic (shaped like winders 7, 14, 3).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockProductRunning, MACHINES_RUNNING_WITH_ROWS } from './support/mocks';

const base = (MACHINES_RUNNING_WITH_ROWS as { data?: unknown; metadata?: unknown });
const quiet = (station: number, extra: object) => ({
  station, stationName: null, machineName: `M${station}`, materialId: null, productName: null, productActive: null,
  cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false, quiet: true, ...extra,
});
function payload() {
  const d = (base.data ?? base) as Record<string, unknown>;
  const machines = [
    (d.machines as unknown[])[0],
    quiet(7, { lastSeenUtc: '2026-09-07T03:47:21Z', state: 'quiet', lastMaterialId: 12, lastProductName: '201-IH0-SD', lastProductActive: true, lastStampedUtc: '2026-09-07T03:47:21Z' }),
    quiet(14, { lastSeenUtc: '2026-09-03T13:55:55Z', state: 'stale', lastMaterialId: 12, lastProductName: '201-IH0-SD', lastProductActive: true, lastStampedUtc: '2026-09-03T13:55:55Z' }),
    quiet(3, { lastSeenUtc: '2026-08-20T08:24:19Z', state: 'silent', lastMaterialId: null, lastProductName: null, lastProductActive: null, lastStampedUtc: null }),
  ];
  const inner = { ...d, machines };
  return base.data ? { ...(base as object), data: inner } : inner;
}

async function open(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockProductRunning(page);
  await page.route('**/api/machines/running**', (route) => route.fulfill({ json: payload() }));
  await page.goto('/?s=product&pt=running&p=pick&from=2026-09-01&to=2026-09-07');
  await page.getByText('Not currently running').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const [w, h] of [[1366, 768], [375, 812]] as const) {
  test(`product running, winders not running @${w}x${h}: last product sentence shown, short rows, thresholds once`, async ({ page }) => {
    await open(page, w, h);
    await expect(page.getByText('Last product it stamped')).toHaveCount(2);
    await expect(page.getByText('No product recorded on its cones')).toHaveCount(1);
    await expect(page.getByText('Running means a cone within 2 hours')).toHaveCount(1);
    const rows = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('table')).find((x) => (x.textContent ?? '').includes('Last product it stamped'))!;
      return Array.from(t.querySelectorAll('tbody tr')).map((tr) => {
        const sp = tr.querySelector('td span.sm')!;
        const lh = parseFloat(getComputedStyle(sp).lineHeight) || parseFloat(getComputedStyle(sp).fontSize) * 1.4;
        return { lines: Math.round(sp.getBoundingClientRect().height / lh), h: tr.getBoundingClientRect().height };
      });
    });
    expect(rows.length, 'not-running rows').toBe(3);
    for (const r of rows) expect(r.lines, `last-product text is ${r.lines} lines (row ${r.h}px)`).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'page horizontal scroll').toBe(true);
  });
}
