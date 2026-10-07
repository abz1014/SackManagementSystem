/**
 * CSS-026 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: in the Line
 * machine list (and Product > Running) the station name sits a full line
 * higher than the product text beside it, and the row's bottom rule is drawn
 * under the name column only on the last row.
 * Runs without a session: every /api/* call is mocked (mockLine +
 * MACHINES_RUNNING_WITH_ROWS from ./support/mocks), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine, MACHINES_RUNNING_WITH_ROWS } from './support/mocks';

test('line machine rows @1366: the station name starts level with its row text and the last row carries no rule under the name only', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockLine(page);
  await page.route('**/api/machines/running**', (route) => route.fulfill({ json: MACHINES_RUNNING_WITH_ROWS }));
  await page.goto('/?s=line&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('tbody tr th[scope="row"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const textTop = (el: Element) => {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      return rg.getBoundingClientRect().top;
    };
    const rows = Array.from(document.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('th[scope="row"]'));
    const offsets = rows.map((tr) => Math.abs(textTop(tr.querySelector('th[scope="row"]')!) - textTop(tr.querySelector('td')!)));
    const last = rows[rows.length - 1]!;
    const bw = (el: Element) => parseFloat(getComputedStyle(el).borderBottomWidth);
    return { n: rows.length, offsets, thRule: bw(last.querySelector('th')!), tdRule: bw(last.querySelector('td')!) };
  });
  expect(m.n, 'machine rows found').toBeGreaterThan(0);
  expect(Math.max(...m.offsets), `station name text is ${Math.max(...m.offsets)}px away from the row text`).toBeLessThanOrEqual(1);
  expect(m.thRule, `last row: rule under the name ${m.thRule}px vs under the row text ${m.tdRule}px`).toBe(m.tdRule);
});
