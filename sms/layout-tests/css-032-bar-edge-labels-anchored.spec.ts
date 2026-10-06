/**
 * CSS-032 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on the Report
 * calibration bar chart the first and last station labels are anchored to
 * their edge instead of centred, so "Station 1" starts at its bar's centre
 * and "Station 14" ends at its bar's centre - each label sits half a word
 * away from the bar it names, next to the neighbouring bar.
 * Runs without a session: every /api/* call is mocked (mockReport,
 * calibration), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './support/mocks';

for (const [width, scale] of [[1366, '1'], [1366, '1.3'], [375, '1']] as const) {
  test(`Report calibration @${width} scale ${scale}: edge bar labels centred on their bars and inside the svg`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 768 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockReport(page, 'calibration');
    await page.goto('/?s=report&rt=calibration&p=pick&from=2026-09-01&to=2026-09-07');
    await page.locator('.chart-frame svg rect').first().waitFor({ state: 'attached', timeout: 15_000 });
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      for (const svg of Array.from(document.querySelectorAll('.chart-frame svg'))) {
        const bars = Array.from(svg.querySelectorAll('rect')).filter((r) => r.querySelector('title'));
        if (bars.length < 5) continue;
        const sr = svg.getBoundingClientRect();
        const centres = bars.map((b) => { const r = b.getBoundingClientRect(); return (r.left + r.right) / 2; });
        const labels = Array.from(svg.querySelectorAll('text')).filter((t) => /^Station \d+$/.test((t.textContent ?? '').trim()));
        const rows = labels.map((t) => {
          const r = t.getBoundingClientRect();
          const c = (r.left + r.right) / 2;
          const near = centres.reduce((b, x) => (Math.abs(x - c) < Math.abs(b - c) ? x : b), centres[0]!);
          return { text: (t.textContent ?? '').trim(), offset: Math.abs(c - near), outside: r.left < sr.left - 0.5 || r.right > sr.right + 0.5 };
        });
        return { found: true as const, bars: bars.length, rows };
      }
      return { found: false as const };
    });
    expect(res.found, 'the calibration bar chart is drawn').toBe(true);
    if (!res.found) return;
    expect(res.rows.length, 'category labels are drawn').toBeGreaterThan(1);
    expect(res.rows.filter((r) => r.outside).map((r) => r.text), 'labels extending outside the svg').toEqual([]);
    if (width >= 1366) {
      const edge = [res.rows[0]!, res.rows[res.rows.length - 1]!];
      for (const e of edge) {
        expect(e.offset, `"${e.text}" label centre vs its bar centre (px)`).toBeLessThanOrEqual(1);
      }
    }
  });
}
