/**
 * CSS-060 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: in a long side sheet (the Rejects reason sheet lists
 * hundreds of readings) the Close button scrolls out of sight with the content, so on a phone, where the scrim is
 * hidden, the only visible way out is to scroll a ~29,000px sheet back to the top.
 * Runs without a session: every /api/* call is mocked (mockAuth + the reason-sheet fixture from ./support/css-051.fixtures),
 * synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeReasonSheet } from './support/css-051.fixtures';

for (const c of [{ w: 375, h: 812 }, { w: 768, h: 1024 }, { w: 1366, h: 768 }]) {
  test(`CSS-060 sheet Close button is still on screen after scrolling to the bottom at ${c.w}x${c.h}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await primeReasonSheet(page, 200);
    const m = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet') as HTMLElement;
      sheet.scrollTop = sheet.scrollHeight;
      const btn = sheet.querySelector('.sheet-head button') as HTMLElement;
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { top: r.top, scrollH: sheet.scrollHeight, reachable: !!hit && (hit === btn || btn.contains(hit)) };
    });
    expect(m.scrollH, 'the sheet is long enough to need scrolling').toBeGreaterThan(c.h * 2);
    expect(m.top, 'Close button top after scrolling to the bottom').toBeGreaterThanOrEqual(0);
    expect(m.top, 'Close button top after scrolling to the bottom').toBeLessThanOrEqual(80);
    expect(m.reachable, 'the Close button is the element at its own position (nothing covers it)').toBe(true);
  });
}

// Recovery-stage rework (8 Oct 2026): `top: 0` held the head at the sheet's padding edge (y = 26), so scrolled rows showed
// through the 26px band above it. The head must pin flush to the sheet's top edge: nothing but the head (or the sheet's own
// background) may be hit-testable between the sheet's top edge and the head's top.
for (const c of [{ w: 375, h: 812 }, { w: 768, h: 1024 }, { w: 1366, h: 768 }]) {
  test(`CSS-060 no scrolled row shows above the pinned head at ${c.w}x${c.h}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await primeReasonSheet(page, 200);
    const m = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet') as HTMLElement;
      sheet.scrollTop = Math.round(sheet.scrollHeight / 2);
      const head = sheet.querySelector('.sheet-head') as HTMLElement;
      const sr = sheet.getBoundingClientRect();
      const hr = head.getBoundingClientRect();
      const bad: string[] = [];
      for (const fx of [0.1, 0.5, 0.9]) {
        const x = sr.left + sr.width * fx;
        for (let y = Math.ceil(sr.top) + 1; y < hr.top; y += 2) {
          const el = document.elementFromPoint(x, y);
          if (el && sheet.contains(el) && el !== sheet && !head.contains(el)) bad.push(`${el.tagName.toLowerCase()}.${el.className || ''}@y${y}`);
        }
      }
      return { gap: hr.top - sr.top, headBottom: hr.bottom - sr.top, bad: bad.slice(0, 5), n: bad.length };
    });
    expect(m.n, `rows hit-testable in the ${Math.round(m.gap)}px band above the pinned head: ${m.bad.join(', ')}`).toBe(0);
    expect(m.gap, 'the pinned head starts at (or above) the sheet top edge').toBeLessThanOrEqual(1);
    expect(m.headBottom, 'the pinned head is still on screen (its bottom edge is below the sheet top)').toBeGreaterThan(10);
  });
}
