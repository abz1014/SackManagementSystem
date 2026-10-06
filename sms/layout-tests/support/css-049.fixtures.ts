/**
 * Synthetic Weight station-table setup shared by CSS-049 / CSS-068 / CSS-076 (Phase 2 CSS loop, 6 Oct 2026).
 * Invented rows only. `mixedCount` stations are marked as having run two materials (targetBasis 'mixed'),
 * which makes the vs-target cell print the long "No single target applies" sentence.
 */
import type { Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockWeight, weightStations } from './mocks';

export async function primeWeightTable(page: Page, scale: number, mixedCount = 5) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockWeight(page);
  // Registered after mockWeight, so it wins: same payload with `mixedCount` stations on two materials.
  await page.route('**/api/weight-stations**', (route) => {
    const j = weightStations() as { data: { stations: Array<Record<string, unknown>> } };
    j.data.stations.slice(0, mixedCount).forEach((s) => { s.targetBasis = 'mixed'; s.materialsInWindow = 2; s.vsTargetG = null; });
    return route.fulfill({ json: j });
  });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  await page.goto('/?s=weight&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('table.station-tbl tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

/** In-page measurement over every row (head and body) of the station table: the content rects of each cell. */
export function measureStationTable() {
  const table = document.querySelector('table.station-tbl')!;
  let minGap = Infinity; let where = '';
  const overprint: string[] = [];
  const sparkOut: number[] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.children) as HTMLElement[];
    const rects = cells.map((cell) => {
      // Visible text only: skip the screen-reader-only labels (a 1px clipped box whose glyph rects stick out but are never drawn).
      const out: DOMRect[] = [];
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent ?? '').trim() || n.parentElement?.closest('.sr-only')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        out.push(...Array.from(rg.getClientRects()).filter((r) => r.width > 0 && r.height > 0));
      }
      const sv = cell.querySelector('svg.spark');
      if (sv) out.push(sv.getBoundingClientRect());
      return out;
    });
    cells.forEach((cell, i) => {
      const cr = cell.getBoundingClientRect();
      const svg = cell.querySelector('svg.spark');
      if (svg) sparkOut.push(Math.max(0, svg.getBoundingClientRect().right - cr.right));
      for (let j = i + 1; j < cells.length; j++) {
        for (const a of rects[i]) for (const b of rects[j]) {
          const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (vOverlap > 3 && hOverlap > 0.5) overprint.push(`${tr.parentElement?.tagName} "${cell.textContent?.slice(0, 20)}" over "${cells[j].textContent?.slice(0, 20)}" by ${hOverlap.toFixed(1)}px`);
          if (j === i + 1 && vOverlap > 3) {
            const gap = b.left - a.right;
            if (gap < minGap) { minGap = gap; where = `${tr.parentElement?.tagName} col ${i + 1}/${j + 1} "${cell.textContent?.slice(0, 20)}" | "${cells[j].textContent?.slice(0, 20)}"`; }
          }
        }
      }
    });
  }
  const tw = table.closest('.tw') as HTMLElement | null;
  return {
    minGap, where, overprint, maxSparkOverrun: Math.max(0, ...sparkOut),
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    twScroll: tw ? tw.scrollWidth - tw.clientWidth : 0,
  };
}
