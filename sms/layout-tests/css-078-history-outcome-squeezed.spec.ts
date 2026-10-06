/**
 * CSS-078 (Phase 2 CSS loop, 6 Oct 2026). User impact: on Product > History the
 * "Outcome" column, which carries PDAS's refusal sentence, is squeezed to under
 * 180 px so every row runs to 160 px tall. Runs without a session: mocked API,
 * synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon } from './support/mocks';

const entries = Array.from({ length: 6 }, (_, i) => ({
  changeId: 100 - i, productId: 12 + i, palletId: null, procName: 'CreateMaterial', operation: 'create',
  outcome: i % 2 ? 'ok' : 'pdas_error', pdasErrorCode: i % 2 ? null : -7001,
  message: 'Material already exists for this blend, count and tube combination, so PDAS refused to create a second one with it.',
  reason: 'Changeover for the new order', changedByName: 'Test Engineer',
  changedAtUtc: `2026-09-0${1 + i}T08:15:00Z`, effectiveFromUtc: null,
}));

test('History outcome column is wide enough to read at 1366', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  await page.route('**/api/product-changes**', (r) => r.fulfill({ json: { entries, nextBefore: null } }));
  await page.goto('/?s=product&pt=history');
  await page.locator('table tbody tr td', { hasText: 'Test Engineer' }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const th = Array.from(document.querySelectorAll('th')).find((t) => (t.textContent ?? '').trim() === 'Outcome')!;
    const tbl = th.closest('table')!;
    const idx = Array.from(th.parentElement!.children).indexOf(th);
    const heights = Array.from(tbl.querySelectorAll('tbody tr')).map((r) => Math.round(r.getBoundingClientRect().height)).sort((a, b) => a - b);
    return { w: Math.round(th.getBoundingClientRect().width), median: heights[Math.floor(heights.length / 2)], idx };
  });
  expect(m.w, `Outcome column width ${m.w}px, median row ${m.median}px`).toBeGreaterThanOrEqual(300);
  expect(m.median, `median row height ${m.median}px`).toBeLessThanOrEqual(120);
});
