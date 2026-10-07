/**
 * CSS-035 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: in the IFL report tables the text of a cell touches the vertical
 * gridlines (about half a pixel clear), so adjacent numbers and words read as joined to the line and to each other.
 * Runs without a session: every /api/* call is mocked (mockReport), synthetic fixtures only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, type ReportKind } from './support/mocks';

for (const kind of ['rejected-cones', 'rejected-sacks'] as ReportKind[]) {
  test(`CSS-035 ${kind} @1366x768: text keeps >= 4px from the vertical gridlines`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
    await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
    await page.locator('table.ifl-table tbody td').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const bad: { cell: string; left: number; right: number }[] = [];
      let n = 0; let minGap = 999;
      for (const c of Array.from(document.querySelectorAll('table.ifl-table th, table.ifl-table td')) as HTMLElement[]) {
        if (!(c.textContent ?? '').trim()) continue;
        const r = c.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(c);
        const rects = Array.from(range.getClientRects());
        if (!rects.length) continue;
        const left = Math.min(...rects.map((x) => x.left)) - r.left;
        const right = r.right - Math.max(...rects.map((x) => x.right));
        n++; minGap = Math.min(minGap, left, right);
        if (left < 4 || right < 4) bad.push({ cell: (c.textContent ?? '').trim().slice(0, 14), left: Math.round(left * 10) / 10, right: Math.round(right * 10) / 10 });
      }
      return { n, bad, minGap };
    });
    expect(res.n, 'cells measured').toBeGreaterThan(10);
    expect(res.bad.length, `${res.bad.length}/${res.n} cells have text within 4px of a gridline (smallest gap ${res.minGap}px): ${JSON.stringify(res.bad.slice(0, 3))}`).toBe(0);
  });
}
