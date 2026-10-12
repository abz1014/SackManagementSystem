/**
 * CSS-036 follow-up (Stage 3, 12 Oct 2026). User impact: the machine matrix header now has IFL's light-blue background, but the small
 * "open" arrow in each machine header cell kept its pale grey (2.06:1 on the blue, it was 3.14:1 on white), so the arrow that says
 * "this column opens" faded out. Runs without a session: every /api/* call is mocked (./support/css-040.fixtures), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeMachineProduct } from './support/css-040.fixtures';

function lum(c: number[]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
}

for (const [w, h, scale] of [[375, 812, 1], [768, 1024, 1], [1366, 768, 1], [1920, 1080, 1], [1366, 768, 1.3]] as const) {
  test(`CSS-036b matrix header arrows keep 3:1 contrast on the blue header at ${w}@${scale}`, async ({ page }) => {
    await primeMachineProduct(page, w, h, scale);
    const m = await page.evaluate(() => {
      const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      return Array.from(document.querySelectorAll('.mp-scroll thead th .chev')).map((g) => {
        const th = g.closest('th')!;
        return { fg: parse(getComputedStyle(g).color), bg: parse(getComputedStyle(th).backgroundColor) };
      });
    });
    expect(m.length, 'machine header cells with an open arrow exist').toBeGreaterThan(0);
    const worst = Math.min(...m.map((c) => { const [a, b] = [lum(c.bg), lum(c.fg)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    expect(worst, `lowest arrow contrast over ${m.length} header cells`).toBeGreaterThanOrEqual(3);
  });
}
