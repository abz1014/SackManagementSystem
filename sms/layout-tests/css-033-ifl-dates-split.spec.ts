/**
 * CSS-033 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: in the IFL report tables the date in the first column breaks
 * across two lines ("2026-09-" / "03"), so every row is double height and a date cannot be read or copied as one value.
 * Runs without a session: every /api/* call is mocked (mockReport), synthetic fixtures only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, type ReportKind } from './support/mocks';

const KINDS: ReportKind[] = ['rejected-sacks', 'shift-production', 'sack-weight-summary', 'sps-packing'];

for (const kind of KINDS) {
  test(`CSS-033 ${kind} @1366x768: first-column dates are one line and the table fits`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
    await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
    await page.locator('table.ifl-table').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const dateRe = /^\d{2}-\d{2}-\d{4}/;
      const cells = (Array.from(document.querySelectorAll('table.ifl-table tbody td:first-child')) as HTMLElement[])
        .filter((c) => dateRe.test((c.textContent ?? '').trim()));
      const split = cells.filter((c) => {
        const range = document.createRange(); range.selectNodeContents(c);
        const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        return lines.size > 1;
      }).length;
      const tables = Array.from(document.querySelectorAll('table.ifl-table')).map((t) => {
        let box: HTMLElement | null = t.parentElement;
        while (box && box !== document.body && !['auto', 'scroll', 'hidden'].includes(getComputedStyle(box).overflowX)) box = box.parentElement;
        return { tableW: (t as HTMLElement).getBoundingClientRect().width, cw: box ? box.clientWidth : -1, sw: box ? box.scrollWidth : -1 };
      });
      return { dates: cells.length, split, tables };
    });
    expect(res.dates, `${kind}: date cells in the first column`).toBeGreaterThan(0);
    expect(res.split, `${kind}: ${res.split}/${res.dates} date cells wrap onto more than one line`).toBe(0);
    for (const t of res.tables) expect(t.sw, `${kind}: table ${Math.round(t.tableW)}px in a ${t.cw}px box`).toBeLessThanOrEqual(t.cw + 1);
  });
}
