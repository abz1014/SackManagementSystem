/**
 * CSS-060 follow-up (Stage 3, 12 Oct 2026). User impact: the sheet's head is now pinned so Close stays in reach, but pressing
 * Shift+Tab up through a long sheet (the Rejects reason sheet) moved keyboard focus to rows hidden behind the pinned head, so a
 * keyboard reader could not see where focus was. The browser scrolls the focused row just into the sheet's edge, not past the head.
 * Runs without a session: every /api/* call is mocked (reason-sheet fixture from ./support/css-051.fixtures), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeReasonSheet } from './support/css-051.fixtures';

for (const c of [{ w: 1366, h: 768 }, { w: 375, h: 812 }]) {
  test(`CSS-060b Shift+Tab up a long sheet never leaves focus under the pinned head at ${c.w}x${c.h}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await primeReasonSheet(page, 200);
    await page.evaluate(() => {
      const s = document.querySelector('.sheet') as HTMLElement;
      s.scrollTop = Math.round(s.scrollHeight / 2);
      const f = Array.from(s.querySelectorAll<HTMLElement>('tr.click,a,button')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.top > innerHeight * 0.45 && r.top < innerHeight * 0.7;
      })[0];
      f?.focus();
    });
    const worst: { covered: number; h: number; step: number }[] = [];
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(60);
      const m = await page.evaluate(() => {
        const s = document.querySelector('.sheet') as HTMLElement;
        const a = document.activeElement as HTMLElement | null;
        if (!a || !s.contains(a) || a === s) return null;
        const hd = s.querySelector('.sheet-head')!.getBoundingClientRect();
        const r = a.getBoundingClientRect();
        const covered = Math.max(0, Math.min(hd.bottom, r.bottom) - Math.max(hd.top, r.top));
        return { covered: Math.round(covered), h: Math.round(r.height), inHead: !!a.closest('.sheet-head') };
      });
      if (m && !m.inHead) worst.push({ covered: m.covered, h: m.h, step: i });
    }
    expect(worst.length, 'focus moved through rows of the sheet').toBeGreaterThan(4);
    const bad = worst.filter((w) => w.covered > 2);
    expect(bad, `steps where the focused row is hidden behind the pinned head: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
  });
}
