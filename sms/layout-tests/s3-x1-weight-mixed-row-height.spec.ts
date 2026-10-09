/**
 * S3 X-1 (Stage 3, 9 Oct 2026). User impact: on Weight's station table, a station that ran two products prints a
 * whole sentence in the narrow vs-target column, which wraps to about seven lines (about 200 px at 1280) and makes
 * that row several times taller than its neighbours. The fix is a short "2 products" marker in the column and the
 * full sentence once, under the table.
 * Runs without a session: every /api/* call is mocked (mockAuth + weight fixtures from ./support/mocks), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeWeightTable, measureStationTable } from './support/css-049.fixtures';

const WIDTHS: Array<{ w: number; h: number; scale: number }> = [
  { w: 375, h: 812, scale: 1 },
  { w: 1100, h: 800, scale: 1 },
  { w: 1280, h: 800, scale: 1 },
  { w: 1366, h: 768, scale: 1 },
  { w: 1920, h: 1080, scale: 1 },
  { w: 1366, h: 768, scale: 1.3 },
];

/** In-page: heights of mixed and plain station rows, text lines in each mixed vs-target cell, and the full-sentence count. */
function measureRows() {
  const table = document.querySelector('table.station-tbl') as HTMLElement;
  const rows = Array.from(table.querySelectorAll('tbody tr')) as HTMLElement[];
  const mixed: number[] = []; const plain: number[] = []; const cellLines: number[] = [];
  for (const tr of rows) {
    const cell = tr.children[4] as HTMLElement;
    const h = tr.getBoundingClientRect().height;
    if (cell.classList.contains('wrap')) {
      mixed.push(h);
      const tops = new Set<number>();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent ?? '').trim() || n.parentElement?.closest('.sr-only')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        for (const r of Array.from(rg.getClientRects())) if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top));
      }
      cellLines.push(tops.size);
    } else plain.push(h);
  }
  const sorted = [...plain].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const text = (document.querySelector('main') ?? document.body).innerText.toLowerCase();
  const needle = 'no single target applies';
  const count = text.split(needle).length - 1;
  const tableBottom = table.getBoundingClientRect().bottom;
  let sentenceTop = -1;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if ((n.textContent ?? '').toLowerCase().includes(needle)) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      sentenceTop = rg.getBoundingClientRect().top; break;
    }
  }
  return { mixedCount: mixed.length, mixedMax: Math.max(0, ...mixed), median, cellLines, sentenceCount: count, sentenceTop, tableBottom };
}

for (const v of WIDTHS) {
  test(`X-1 mixed-product rows stay one line tall at ${v.w}x${v.h}@${v.scale}`, async ({ page }) => {
    await page.setViewportSize({ width: v.w, height: v.h });
    await primeWeightTable(page, v.scale, 5);
    const r = await page.evaluate(measureRows);
    const m = await page.evaluate(measureStationTable);
    expect(r.mixedCount, 'five stations are mixed in the fixture').toBe(5);
    expect(r.mixedMax, `tallest mixed row ${r.mixedMax}px against median plain row ${r.median}px`).toBeLessThanOrEqual(r.median * 1.25);
    expect(r.cellLines, `text lines in each mixed vs-target cell: ${r.cellLines.join(',')}`).toEqual([1, 1, 1, 1, 1]);
    expect(m.overprint, `cells overprinted: ${m.overprint.join(' ; ')}`).toEqual([]);
    expect(m.minGap, `closest gap ${m.minGap}px at ${m.where}`).toBeGreaterThanOrEqual(4);
    expect(m.scrollW, 'no sideways page scroll').toBeLessThanOrEqual(m.clientW);
    expect(r.sentenceCount, 'the full sentence is printed once').toBe(1);
    expect(r.sentenceTop, 'and it sits below the table').toBeGreaterThanOrEqual(r.tableBottom - 1);
  });
}
