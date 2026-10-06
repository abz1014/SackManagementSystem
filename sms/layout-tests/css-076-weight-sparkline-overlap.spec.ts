/**
 * CSS-076 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on Weight's station table at phone widths the 96px trend
 * sparkline is wider than its column and its line runs through the Rejects % figure and the "What the data shows" text.
 * Runs without a session: every /api/* call is mocked (mockAuth + weight fixtures from ./support/mocks), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeWeightTable, measureStationTable } from './support/css-049.fixtures';

for (const w of [320, 375, 600, 768]) {
  test(`CSS-076 sparkline stays inside its own cell and clear of its neighbours at ${w}x812@1`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 812 });
    await primeWeightTable(page, 1);
    const m = await page.evaluate(measureStationTable);
    expect(m.maxSparkOverrun, 'sparkline right edge beyond its own cell, px').toBeLessThanOrEqual(0.5);
    expect(m.overprint.filter((o) => !o.includes('Trend')), `sparkline over neighbours: ${m.overprint.join(' ; ')}`).toEqual([]);
  });
}
