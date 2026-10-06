/**
 * CSS-056 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on the Rejected
 * Unknown (Lifter) report the one-row "zeroed clock" table squeezes the
 * "Why listed" text into ~89 px, so the single row is ~299 px tall and its
 * date wraps onto three lines.
 * Runs without a session: every /api/* call is mocked (mockAuth + mockReport
 * fixture, which already carries one zeroed-clock row), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, reportEnvelope } from './support/mocks';

for (const width of [1366, 1920]) {
  test(`rejected-unknown-lifter zeroed-clock table @${width}: row short, date on one line`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockReport(page, 'rejected-unknown-lifter');
    // The shared fixture's zeroed-clock row lists one short reason; a real one lists several (no lifter, no winder, zero code, clock zeroed).
    const env = reportEnvelope('rejected-unknown-lifter') as { data: { report: { zeroedClock: { rows: Array<{ why: string[] }> } } } };
    env.data.report.zeroedClock.rows[0].why = ['No lifter recorded', 'No winder recorded', 'Reason code is zero', 'Clock zeroed (1970)'];
    await page.route('**/api/reports/rejected-unknown-lifter**', (route) => route.fulfill({ json: env }));
    await page.goto('/?s=report&rt=rejected-unknown-lifter&p=pick&from=2026-09-01&to=2026-09-07');
    const cell = page.locator('td', { hasText: 'Clock zeroed (1970)' }).first();
    await cell.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(250);
    const res = await page.evaluate(() => {
      const td = Array.from(document.querySelectorAll('td')).find((t) => (t.textContent ?? '').includes('Clock zeroed (1970)')) as HTMLElement;
      const tr = td.closest('tr') as HTMLElement;
      const date = tr.querySelector('td') as HTMLElement;
      const rg = document.createRange();
      rg.selectNodeContents(date);
      const tops = new Set(Array.from(rg.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      const dateLines = tops.size;
      return { row: tr.getBoundingClientRect().height, dateLines };
    });
    expect(res.row, 'zeroed-clock row height (px)').toBeLessThanOrEqual(120);
    expect(res.dateLines, 'date cell lines').toBe(1);
  });
}
