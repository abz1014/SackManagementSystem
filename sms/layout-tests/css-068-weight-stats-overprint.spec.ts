/**
 * CSS-068 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on Weight's station table the Average, Median and SD
 * columns (and their headers) touch or print over each other at phone width and at the Wall's 1.3 scale, so the
 * figures cannot be read apart. The table may scroll inside its own box, but the page itself must not scroll sideways.
 * Runs without a session: every /api/* call is mocked (mockAuth + weight fixtures from ./support/mocks), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeWeightTable, measureStationTable } from './support/css-049.fixtures';

const CELLS = [
  { w: 375, h: 812, scale: 1 },
  { w: 768, h: 1024, scale: 1 },
  { w: 1100, h: 800, scale: 1.3 },
  { w: 1366, h: 768, scale: 1.3 },
  { w: 1920, h: 1080, scale: 1.3 },
] as const;

for (const c of CELLS) {
  test(`CSS-068 station table cells keep a gap of at least 4px and the page does not scroll at ${c.w}x${c.h}@${c.scale}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await primeWeightTable(page, c.scale);
    const m = await page.evaluate(measureStationTable);
    expect(m.overprint, `cells overprinted: ${m.overprint.join(' ; ')}`).toEqual([]);
    expect(m.minGap, `smallest gap between neighbouring cell texts (${m.where})`).toBeGreaterThanOrEqual(4);
    expect(m.scrollW, 'page scrollWidth must not exceed clientWidth').toBeLessThanOrEqual(m.clientW);
  });
}
