/**
 * CSS-036 (Phase 2 CSS recovery, owner decision 6 Oct 2026, option B). User impact: the machine-by-shift matrix on the
 * machine-product report has plain white header cells while every other IFL report table (and IFL's own sheets) has the
 * light-blue header, so the matrix reads as a different kind of table and its pinned header does not stand out from the
 * rows that scroll under it. Owner chose: IFL light-blue header, opaque while pinned.
 * Runs without a session: every /api/* call is mocked (./support/css-040.fixtures), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeMachineProduct } from './support/css-040.fixtures';

const IFL_BLUE: [number, number, number] = [173, 216, 230]; // #ADD8E6, the literal .ifl-table th already uses

function lum(c: number[]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
}

for (const [w, h, scale] of [[375, 812, 1], [768, 1024, 1], [1366, 768, 1], [1920, 1080, 1], [1366, 768, 1.3]] as const) {
  test(`CSS-036 matrix header cells are IFL blue, readable, and opaque over scrolled rows at ${w}@${scale}`, async ({ page }) => {
    await primeMachineProduct(page, w, h, scale);
    const m = await page.evaluate(() => {
      const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      const ths = Array.from(document.querySelectorAll('.mp-scroll thead th'));
      return ths.map((th) => { const cs = getComputedStyle(th); return { bg: parse(cs.backgroundColor), fg: parse(cs.color), opacity: cs.opacity }; });
    });
    expect(m.length, 'header cells exist').toBeGreaterThan(2);
    for (const [i, c] of m.entries()) {
      expect(c.bg.slice(0, 3), `header cell ${i} background`).toEqual(IFL_BLUE);
      expect(c.bg.length === 3 || c.bg[3] === 1, `header cell ${i} background is opaque`).toBe(true);
      const [a, b] = [lum(c.bg), lum(c.fg)];
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `header cell ${i} text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    // Scroll the box down and right; no body cell may be hit-testable at the centre of a pinned header cell.
    await page.evaluate(() => { const b = document.querySelector('.mp-scroll') as HTMLElement; b.scrollTop = 400; b.scrollLeft = 300; });
    await page.waitForTimeout(200);
    const covered = await page.evaluate(() => {
      const box = document.querySelector('.mp-scroll') as HTMLElement;
      const bb = box.getBoundingClientRect();
      const bad: string[] = [];
      for (const th of Array.from(document.querySelectorAll('.mp-scroll thead th'))) {
        const r = th.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, bb.left + 2), bb.right - 2); const y = r.top + r.height / 2;
        if (y < 0 || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && !th.contains(hit) && hit.closest('.mp-scroll thead') == null && hit.closest('.mp-scroll') != null) bad.push(hit.tagName + ':' + (hit.textContent ?? '').slice(0, 20));
      }
      return bad;
    });
    expect(covered, 'body cells hit-testable under a pinned header cell').toEqual([]);
  });
}
