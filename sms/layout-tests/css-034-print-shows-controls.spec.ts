/**
 * CSS-034 (Phase 2 CSS loop, 6 Oct 2026). User impact: the printed Rejects page
 * carries interactive-only "Name it" buttons (one per unnamed reason) that mean
 * nothing on paper. Runs without a session: mocked API, synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, META } from './support/mocks';

const reasons = Array.from({ length: 8 }, (_, i) => ({
  rejectCodeId: 10 + i, rejectType: 'quality', tubeCode: i, materialCode: 5,
  label: null, displayLabel: `quality:${i}:5`, count: 400 - i * 30, pct: 12 - i, cumulativePct: 12 + i * 10,
}));
reasons.push({ rejectCodeId: 99, rejectType: 'weight', tubeCode: 0, materialCode: 0, label: 'Bad tube' as unknown as null, displayLabel: 'Bad tube', count: 900, pct: 40, cumulativePct: 40 });

test('printed Rejects has no "Name it" buttons and still shows its figures', async ({ page }) => {
  await page.setViewportSize({ width: 794, height: 1123 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockRejects(page);
  await page.route('**/api/rejects?**', (r) => r.fulfill({ json: { data: { total: 3600, reasons }, metadata: META } }));
  await page.route(/\/api\/rejects(\?|$)/, (r) => r.fulfill({ json: { data: { total: 3600, reasons }, metadata: META } }));
  await page.goto('/?s=rejects&p=pick&from=2026-09-01&to=2026-09-07');
  await page.getByText('Bad tube').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.emulateMedia({ media: 'print' });
  const m = await page.evaluate(() => {
    const vis = (e: Element) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };
    const nameIt = Array.from(document.querySelectorAll('button')).filter((b) => /^\s*Name it\s*$/.test(b.textContent ?? '') && vis(b)).length;
    const badTube = Array.from(document.querySelectorAll('button, span, div, p')).filter((e) => (e.textContent ?? '').trim() === 'Bad tube' && vis(e)).length;
    return { nameIt, badTube };
  });
  expect(m.badTube, 'a reason name (a figure label) is still visible in print').toBeGreaterThan(0);
  expect(m.nameIt, `visible "Name it" buttons in print: ${m.nameIt}`).toBe(0);
});
