/**
 * CSS-013 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: the column headings of IFL's eight report tables are
 * grey (--muted) on IFL's light-blue header fill, 3.86:1, below the 4.5:1 needed to read small bold text comfortably.
 * Runs without a session: every /api/* call is mocked (mockAuth + report fixtures from ./support/mocks), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, IFL_REPORT_KINDS } from './support/mocks';

for (const kind of IFL_REPORT_KINDS) {
  test(`CSS-013 ${kind}: every table heading has contrast of at least 4.5:1 on its fill at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockReport(page, kind);
    await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
    await page.locator('.ifl-table th').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(250);
    const res = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const out: { text: string; ratio: number }[] = [];
      for (const th of Array.from(document.querySelectorAll('.ifl-table th'))) {
        const r = th.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || !(th.textContent ?? '').trim()) continue;
        const cs = getComputedStyle(th);
        const a = lum(parse(cs.color)); const b = lum(parse(cs.backgroundColor));
        out.push({ text: (th.textContent ?? '').trim().slice(0, 24), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
      }
      return out;
    });
    expect(res.length, 'table headings found').toBeGreaterThan(0);
    const worst = res.reduce((m, x) => (x.ratio < m.ratio ? x : m));
    expect(worst.ratio, `lowest heading contrast: "${worst.text}"`).toBeGreaterThanOrEqual(4.5);
  });
}
