/**
 * CSS-012 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on a tablet in
 * portrait (621-850px) the Report's Print/Export/verdict column refuses to
 * shrink, so the headline sentence is squeezed into a ~260px column (six
 * lines at 768px) and, at the narrow end, the whole page scrolls sideways.
 * Runs without a session: every /api/* call is mocked (mockAuth + a daily
 * report fixture with a realistic short operator name), synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './support/mocks';
import { dailyReportBy } from './support/css-012.fixtures';

async function prime(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, 'daily');
  await page.route('**/api/reports/daily**', (route) => route.fulfill({ json: dailyReportBy('ibrahim') }));
  await page.goto('/?s=report&rt=daily&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('.head-row h1').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.verdict').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const width of [621, 650, 700, 768, 850]) {
  test(`daily report @${width}: the page does not scroll sideways`, async ({ page }) => {
    await prime(page, width);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sw, `scrollWidth ${m.sw} vs clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw);
  });
}

test('daily report @768: the headline keeps a readable column (>= 340px or <= 3 lines)', async ({ page }) => {
  await prime(page, 768);
  const m = await page.evaluate(() => {
    const h = document.querySelector('.head-row h1') as HTMLElement;
    const r = h.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.2;
    return { w: r.width, lines: Math.round(r.height / lh) };
  });
  expect(m.w >= 340 || m.lines <= 3, `headline is ${Math.round(m.w)}px wide over ${m.lines} lines`).toBe(true);
});

// Recovery-stage rework (8 Oct 2026): letting the actions shrink moved the squeeze onto the verdict box (146-195px, a word per
// line, the head 100+px taller). At 900px and below the head row stacks instead, so the verdict box keeps its natural width.
for (const width of [650, 768, 850]) {
  test(`daily report @${width}: the verdict box is not squeezed`, async ({ page }) => {
    await prime(page, width);
    const m = await page.evaluate(() => {
      const v = document.querySelector('.verdict') as HTMLElement;
      const row = document.querySelector('.head-row') as HTMLElement;
      const cs = getComputedStyle(row);
      const content = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const saved = v.style.width; v.style.width = 'max-content';
      const natural = v.getBoundingClientRect().width; v.style.width = saved;
      return { w: v.getBoundingClientRect().width, natural, content };
    });
    const want = Math.min(m.natural, m.content) - 1;
    expect(m.w, `verdict box is ${Math.round(m.w)}px wide, its natural width is ${Math.round(m.natural)}px (room ${Math.round(m.content)}px)`).toBeGreaterThanOrEqual(want);
  });
}
