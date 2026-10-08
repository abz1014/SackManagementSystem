/**
 * CSS-022 (Phase 2 CSS defect loop, 7 Oct 2026). User impact: while a screen's first panel is still loading, its
 * skeleton is shorter than the real figures that replace it, so everything below jumps down by 46-49px as the data
 * lands (README acceptance check 9: no block changes height as it lands).
 * Runs without a session: every /api/* call is mocked and delayed 800ms in the browser, synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine, mockReport, mockSacks, mockWeight } from './support/mocks';
import { sackSummaryAllFlagged, weightStationsRetiredTarget } from './support/css-022.fixtures';

async function delayAll(page: Page) {
  await page.route('**/api/**', async (route) => {
    if (route.request().url().includes('/api/auth/me')) return route.fallback();
    await new Promise((r) => setTimeout(r, 800));
    return route.fallback();
  });
}

const SCREENS: Array<{ name: string; url: string; mock: (p: Page) => Promise<void>; scale?: number }> = [
  { name: 'Line', url: '/?s=line&p=today', mock: mockLine },
  { name: 'Sacks', url: '/?s=sacks&p=today', mock: async (p) => { await mockSacks(p); await p.route('**/api/sacks/summary**', (r) => r.fulfill({ json: sackSummaryAllFlagged() })); } },
  { name: 'Weight', url: '/?s=weight&p=today', mock: mockWeight },
  // Recovery-stage rework (8 Oct 2026): the Report coverage line, and the Wall text size where notes wrap further.
  { name: 'Report', url: '/?s=report&rt=daily&p=pick&from=2026-09-01&to=2026-09-07', mock: async (p) => { await mockReport(p, 'daily'); } },
  { name: 'Weight at 1.3 text size', url: '/?s=weight&p=today', mock: async (p) => { await mockWeight(p); await p.route('**/api/weight-stations**', (r) => r.fulfill({ json: weightStationsRetiredTarget() })); }, scale: 1.3 },
];

for (const s of SCREENS) {
  test(`${s.name} @1366x768: the first block changes height by at most 8px as its data lands`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    if (s.scale) await page.addInitScript((sc) => { try { localStorage.setItem('sms.uiScale', String(sc)); } catch { /* none */ } }, s.scale);
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await s.mock(page);
    await delayAll(page);
    await page.goto(s.url, { waitUntil: 'commit' });
    const firstBlock = page.locator('main section.block').first();
    await firstBlock.locator('.skel').first().waitFor({ state: 'attached', timeout: 15_000 });
    const skeleton = await firstBlock.evaluate((el) => el.getBoundingClientRect().height);
    await page.waitForFunction(() => !document.querySelector('main section.block .skel'), null, { timeout: 20_000 });
    await page.waitForTimeout(300);
    const loaded = await page.locator('main section.block').first().evaluate((el) => el.getBoundingClientRect().height);
    const growth = Math.abs(loaded - skeleton);
    expect(growth, `first block ${skeleton.toFixed(1)}px as skeleton, ${loaded.toFixed(1)}px loaded (${growth.toFixed(1)}px shift)`).toBeLessThanOrEqual(8);
  });
}
