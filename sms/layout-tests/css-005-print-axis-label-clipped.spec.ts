/**
 * CSS-005 (Phase 2 CSS defect loop, 5 Oct 2026) - printed deviation chart: "+10.0 g" axis label clipped at the page edge.
 *
 * USER IMPACT: in print the page container has zero left padding, so the left-most y-axis label of the deviation
 * chart ("+10.0 g") starts a few pixels left of the printable area and its "+" is cut off: the paper reads "-10.0 g"
 * for what is a positive deviation.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts; station report fixture, synthetic data), print
 * media is emulated, and the geometry (not the extracted text, which still contains the "+") is measured.
 * The reference edge is the printable area: print layout x = 0 is the left edge of the @page content box.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './support/mocks';

const CELLS = [
  { w: 1123, h: 794, rt: 'station' },   // A4 landscape @96dpi, how reports print
  { w: 1123, h: 794, rt: 'calibration' },
] as const;

async function prime(page: Page, rt: string) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, rt as never);
  await page.goto(`/?s=report&rt=${rt}&p=today`);
  await page.locator('.chart-frame svg').first().waitFor({ state: 'attached', timeout: 15_000 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // ResizeObserver settle after the media switch
}

for (const c of CELLS) {
  test(`CSS-005 printed chart axis labels start inside the printable area (${c.rt}, ${c.w}x${c.h} print)`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await prime(page, c.rt);
    const m = await page.evaluate(() => {
      const re = /^[+−-]?\d+(\.\d+)?\s?g?$/;
      const labels = Array.from(document.querySelectorAll<SVGTextElement>('.chart-frame svg text'))
        .filter((t) => re.test((t.textContent ?? '').trim()) && t.getBoundingClientRect().width > 0);
      let min = Infinity; let which = '';
      for (const t of labels) { const l = t.getBoundingClientRect().left; if (l < min) { min = l; which = (t.textContent ?? '').trim(); } }
      const page0 = document.querySelector('.page, .band > .page');
      const pr = page0?.getBoundingClientRect();
      const cs = page0 ? getComputedStyle(page0) : null;
      const plus = labels.filter((t) => (t.textContent ?? '').trim().startsWith('+')).map((t) => ({ text: (t.textContent ?? '').trim(), left: t.getBoundingClientRect().left }));
      return { n: labels.length, plus, min, which, pageLeft: pr?.left ?? null, padLeft: cs ? parseFloat(cs.paddingLeft) : null };
    });
    expect(m.n, 'the fixture must contain numeric y-axis labels').toBeGreaterThan(0);
    expect(m.plus.length, 'the fixture must contain a "+10.0 g" style positive tick').toBeGreaterThan(0);
    for (const p of m.plus) expect(p.left, `positive label "${p.text}" starts at x=${p.left}`).toBeGreaterThanOrEqual(0);
    expect(m.min, `left-most axis label "${m.which}" starts at x=${m.min} (printable area starts at 0; .page left ${m.pageLeft}, padding-left ${m.padLeft})`).toBeGreaterThanOrEqual(0);
  });
}
