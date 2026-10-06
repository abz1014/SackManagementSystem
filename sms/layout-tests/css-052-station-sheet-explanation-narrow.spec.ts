/**
 * CSS-052 (Phase 2 CSS loop, 6 Oct 2026). User impact: in the station sheet's
 * "Flagged days" table the date and mean columns hold fixed widths, so the rule
 * explanation (the part the reader came for) is squeezed into a 170 px strip and
 * wraps onto several lines. Runs without a session: mocked API, synthetic days.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockStationSheet, weightStations } from './support/mocks';

test('Flagged days table gives the explanation room and keeps dates on one line', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockStationSheet(page);
  const payload = weightStations() as { data: { stations: { days: { nelson: number[] }[] }[] } };
  for (const s of payload.data.stations) s.days.slice(0, 5).forEach((d) => { d.nelson = [1, 4]; });
  await page.route('**/api/weight-stations**', (r) => r.fulfill({ json: payload }));
  await page.goto('/?s=line&p=today&sheet=station:5');
  await page.locator('.sheet table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const tbl = Array.from(document.querySelectorAll('.sheet table')).find((t) => !t.querySelector('thead') && t.querySelectorAll('tr').length === 5) as HTMLTableElement;
    const rows = Array.from(tbl.querySelectorAll('tr'));
    const lines = (c: Element) => { const r = document.createRange(); r.selectNodeContents(c); return new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top))).size; };
    const expl = Math.round(rows[0].children[2].getBoundingClientRect().width);
    const dateH = rows.map((r) => lines(r.children[0]));
    return { expl, maxDateLines: Math.max(...dateH), rowH: rows.map((r) => Math.round(r.getBoundingClientRect().height)) };
  });
  expect(m.expl, `explanation column ${m.expl}px, row heights ${m.rowH.join(',')}`).toBeGreaterThanOrEqual(220);
  expect(m.maxDateLines, 'date cell line count').toBe(1);
});
