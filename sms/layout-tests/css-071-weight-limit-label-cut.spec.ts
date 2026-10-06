/**
 * CSS-071 (Phase 2 CSS defect loop, 5 Oct 2026).
 *
 * User impact: on a phone-width screen the Weight > Over time chart draws its
 * "upper limit ... off scale" / "lower limit" labels in a right-hand gutter that
 * is capped at 30 % of the chart width, so the text runs past the svg edge and
 * the reader loses the value and the "this limit is off the chart" fact.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts, synthetic
 * data only), the same approach as charts.spec.ts.
 *
 * Measures the user-visible geometry: the right edge of every limit/target
 * label's rendered text box must be inside the svg and inside the viewport.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockWeight } from './support/mocks';

async function prime(page: Page) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockWeight(page);
  await page.goto('/?s=weight&p=today&wm=time');
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const width of [320, 375, 620]) {
  test(`Weight over-time limit labels stay inside the chart at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await prime(page);
    const r = await page.evaluate(() => {
      const svg = document.querySelector('.chart-frame svg.chart') as SVGSVGElement;
      const s = svg.getBoundingClientRect();
      const labels = Array.from(svg.querySelectorAll('text'))
        .filter((t) => /limit|target|upper|lower|off scale|[↑↓]/i.test(t.textContent ?? ''))
        .map((t) => {
          const b = t.getBoundingClientRect();
          return { text: (t.textContent ?? '').trim(), right: b.right };
        });
      return { svgRight: s.right, vw: window.innerWidth, labels };
    });
    expect(r.labels.length, 'no limit/target labels drawn').toBeGreaterThan(0);
    for (const l of r.labels) {
      expect(l.right, `label "${l.text}" right edge vs svg right edge ${r.svgRight}`).toBeLessThanOrEqual(r.svgRight + 0.5);
      expect(l.right, `label "${l.text}" right edge vs viewport ${r.vw}`).toBeLessThanOrEqual(r.vw + 0.5);
    }
  });
}
