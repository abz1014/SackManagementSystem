/**
 * CSS-017 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on Health the "Data batches" table is wider than its box
 * (1141px in 1036px), so "Registered by" and "Rows held" are reachable only by an unmarked sideways scroll of the box.
 * Runs without a session: every /api/* call is mocked (mockAuth + mockCommon + synthetic system-history fixture).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon } from './support/mocks';
import { systemHistory } from './support/css-017.fixtures';
import { operationsWithFindings, healthReport, reconciliation } from './support/css-067.fixtures';

async function prime(page: Page, width: number, scale: number) {
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* none */ } }, scale);
  await page.setViewportSize({ width, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  await page.route('**/api/system-history**', (r) => r.fulfill({ json: systemHistory() }));
  await page.route('**/api/health', (r) => r.fulfill({ json: healthReport() }));
  await page.route('**/api/reconciliation**', (r) => r.fulfill({ json: reconciliation() }));
  await page.route('**/api/operations**', (r) => r.fulfill({ json: operationsWithFindings(0) }));
  await page.goto('/?s=health');
  await page.locator('table.epoch-tbl tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

// 1.3 text size is recorded, not asserted: the two timestamp columns alone need more than the 1036px box there (owner call, box does not grow with text size).
for (const [w, s] of [[1366, 1], [1100, 1]] as const) {
  test(`Health Data batches @${w}x768 scale ${s}: the table fits its box and no identifier splits`, async ({ page }) => {
    await prime(page, w, s);
    const m = await page.evaluate(() => {
      const t = document.querySelector('table.epoch-tbl') as HTMLElement;
      const box = t.closest('.tw') as HTMLElement;
      const b = box.getBoundingClientRect();
      const ths = Array.from(t.querySelectorAll('th')).map((th) => { const r = th.getBoundingClientRect(); return { right: r.right, text: th.textContent }; });
      let splits = 0;
      for (const td of Array.from(t.querySelectorAll('tbody td'))) {
        const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const i = (n.textContent ?? '').indexOf('cli:epoch-accept');
          if (i < 0) continue;
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'cli:epoch-accept'.length);
          if (new Set(Array.from(r.getClientRects()).map((q) => Math.round(q.top))).size > 1) splits++;
        }
      }
      return { sw: box.scrollWidth, cw: box.clientWidth, tableW: t.getBoundingClientRect().width, boxRight: b.right, thsOut: ths.filter((x) => x.right > b.right + 0.5).map((x) => x.text), splits };
    });
    expect(m.tableW, `table ${m.tableW} wider than its box ${m.cw}`).toBeLessThanOrEqual(m.cw + 1);
    expect(m.sw, `box scrollWidth ${m.sw} > clientWidth ${m.cw}: sideways scroll needed`).toBeLessThanOrEqual(m.cw + 1);
    expect(m.thsOut, 'column headers outside the box').toEqual([]);
    expect(m.splits, 'cli:epoch-accept broken across lines mid-identifier').toBe(0);
  });
}
