/**
 * CSS-069 (Phase 2 CSS defect loop, 5 Oct 2026). User impact: on the
 * Calibration and Station reports at phone widths, the chart's legend line
 * ("Zero line · Flag threshold") hangs below the fixed-height chart body and
 * is drawn over the table's header row, hiding column headings.
 * Runs without a session: every /api/* call is mocked (mockAuth + report
 * fixtures from ./support/mocks), synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, type ReportKind } from './support/mocks';

async function prime(page: Page, kind: ReportKind, width: number) {
  await page.setViewportSize({ width, height: 812 });
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, kind);
  await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const kind of ['calibration', 'station'] as const) {
  for (const width of [320, 375, 600, 730]) {
    test(`${kind} @${width}: chart legend overlaps no table header and stays inside its chart frame`, async ({ page }) => {
      await prime(page, kind, width);
      const legend = page.locator('.chart-frame p.mut', { hasText: /·/ }).first();
      await expect(legend, 'a legend line is drawn at this width').toBeVisible();
      const res = await page.evaluate(() => {
        const lg = Array.from(document.querySelectorAll('.chart-frame p.mut')).find((p) => (p.textContent ?? '').includes('·'))!;
        const lr = lg.getBoundingClientRect();
        const fr = lg.closest('.chart-frame')!.getBoundingClientRect();
        const hidden = Array.from(document.querySelectorAll('th')).filter((th) => {
          const r = th.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return lr.left < r.right && lr.right > r.left && lr.top < r.bottom && lr.bottom > r.top;
        }).map((th) => (th.textContent ?? '').trim());
        return { overhang: lr.bottom - fr.bottom, hidden };
      });
      expect(res.hidden, `legend covers table headers: ${res.hidden.join(', ')}`).toEqual([]);
      expect(res.overhang, 'legend bottom is below its own chart frame by this many px').toBeLessThanOrEqual(0.5);
    });
  }
}
