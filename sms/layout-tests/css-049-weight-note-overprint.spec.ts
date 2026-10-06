/**
 * CSS-049 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on Weight's station table, a station that ran two
 * materials prints "No single target applies - 2 materials ran here." on one line in the narrow vs-target column,
 * and it runs over the trend sparkline, the Rejects % and the status text next to it, hiding those figures.
 * Runs without a session: every /api/* call is mocked (mockAuth + weight fixtures from ./support/mocks), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeWeightTable, measureStationTable } from './support/css-049.fixtures';

test('CSS-049 vs-target note overprints no neighbouring cell at 1366x768@1', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await primeWeightTable(page, 1);
  const m = await page.evaluate(measureStationTable);
  expect(m.overprint, `cells overprinted: ${m.overprint.join(' ; ')}`).toEqual([]);
});
