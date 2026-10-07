/**
 * CSS-024 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on a phone the
 * Rejects "reasons" list gives each reason name a ~65px column, so a name
 * like "Code 10/1 — not yet named" breaks one word per line (four to five
 * lines) and every row is twice as tall as it needs to be.
 * Runs without a session: every /api/* call is mocked (./support/css-024.fixtures
 * over mockRejects), synthetic reasons only.
 */
import { test, expect } from '@playwright/test';
import { primeRejectsLongReasons } from './support/css-024.fixtures';

for (const [width, scale] of [[375, 1], [320, 1], [620, 1], [375, 1.3]] as const) {
  test(`rejects reasons @${width} scale ${scale}: names wrap to at most 3 lines and the count stays on one line`, async ({ page }) => {
    await primeRejectsLongReasons(page, width, scale);
    const rows = await page.evaluate(() => {
      const lines = (el: Element) => {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        return Math.round(el.getBoundingClientRect().height / lh);
      };
      return Array.from(document.querySelectorAll('.bars div')).map((d) => {
        const name = d.querySelector('button.linkish') as HTMLElement;
        const count = d.querySelector('em') as HTMLElement;
        return { name: name.textContent, nameW: Math.round(name.getBoundingClientRect().width), nameLines: lines(name), countLines: lines(count) };
      });
    });
    const tooTall = rows.filter((r) => r.nameLines > 3);
    expect(tooTall, `names over 3 lines: ${tooTall.map((r) => `${r.name} (${r.nameLines} lines in ${r.nameW}px)`).join('; ')}`).toEqual([]);
    const wrapped = rows.filter((r) => r.countLines > 1);
    expect(wrapped.map((r) => r.name), 'count cells that wrap onto a second line').toEqual([]);
    expect(Math.min(...rows.map((r) => r.nameW)), 'narrowest name column').toBeGreaterThanOrEqual(110);
  });
}
