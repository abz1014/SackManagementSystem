/**
 * CSS-004 (Phase 2 CSS defect loop, 5 Oct 2026) - Report > Calibration station table, numbers overprint.
 *
 * USER IMPACT: on a narrow window or a phone the ten-column station table is forced into a fixed layout narrower than
 * its own text, so the numbers in neighbouring columns are printed on top of each other (up to 70px of overprint at
 * 375px) and the reader cannot read the station figures.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts, the calibration fixture with 14 stations);
 * the server only serves the built static app. Synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './support/mocks';

const CELLS = [
  { w: 375, h: 812, scale: 1 },
  { w: 700, h: 900, scale: 1 },
  { w: 860, h: 900, scale: 1 },
  { w: 960, h: 900, scale: 1 },
  // 1366@1.3 (Wall text size) is NOT asserted: there the same two header words abut by 5px (S3, a different cause: the 12% column at the larger
  // font); it is recorded as a separate, unfixed S3 sub-case of CSS-004 rather than fixed with a desktop-wide layout change.
] as const;

async function prime(page: Page, scale: number) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, 'calibration');
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  await page.goto('/?s=report&rt=calibration&p=today');
  await page.locator('table.calib-tbl').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

for (const c of CELLS) {
  test(`CSS-004 calibration table cells do not overprint at ${c.w}x${c.h}@${c.scale}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await prime(page, c.scale);
    const m = await page.evaluate(() => {
      const table = document.querySelector('table.calib-tbl')!;
      let worst = Infinity; let where = '';
      let rows = 0;
      for (const tr of Array.from(table.querySelectorAll('tr'))) {
        const cells = Array.from(tr.children) as HTMLElement[];
        const rects = cells.map((cell) => {
          const rg = document.createRange(); rg.selectNodeContents(cell);
          return Array.from(rg.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        });
        rows++;
        for (let i = 0; i + 1 < cells.length; i++) {
          for (const a of rects[i]) for (const b of rects[i + 1]) {
            const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (vOverlap < 3) continue;
            const gap = b.left - a.right;
            if (gap < worst) { worst = gap; where = `${tr.parentElement?.tagName} row ${rows} col ${i + 1}/${i + 2} "${cells[i].textContent}" | "${cells[i + 1].textContent}"`; }
          }
        }
      }
      return { worst, where, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
    });
    expect(m.worst, `worst gap between adjacent cells' text is ${m.worst}px (negative = overprint) at ${m.where}`).toBeGreaterThanOrEqual(0);
    expect(m.scrollW, `page scrollWidth ${m.scrollW} vs clientWidth ${m.clientW}`).toBeLessThanOrEqual(m.clientW);
  });
}
