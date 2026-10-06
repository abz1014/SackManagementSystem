/**
 * CSS-028 (Phase 2 CSS defect loop, 5 Oct 2026) - Health link off-screen at the Wall text size.
 *
 * USER IMPACT: with the larger "Wall" text size on a window about 900-945px wide the nav row does not wrap, so the
 * Health link sits beyond the right edge and the whole page gains a sideways scrollbar; the reader sees "Healt" cut
 * off or has to scroll sideways on a dashboard to open the Health screen.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts); the server only serves the built static app.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

const WIDTHS = [901, 920, 945] as const;

async function prime(page: Page, url: string) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockLine(page);
  await page.addInitScript(() => { try { localStorage.setItem('sms.uiScale', '1.3'); } catch { /* ignore */ } });
  await page.goto(url);
  await page.locator('.nav-link').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

for (const w of WIDTHS) {
  for (const url of ['/?s=line&p=today', '/?s=health&p=today']) {
    test(`CSS-028 Health link fully on screen, no page scroll at ${w}x900@1.3 ${url.split('&')[0]}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await prime(page, url);
      const m = await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll<HTMLElement>('.nav-link')).find((l) => /health/i.test(l.textContent ?? ''))!;
        const r = link.getBoundingClientRect();
        const btns = Array.from(document.querySelectorAll<HTMLElement>('.period button')).map((b) => b.getBoundingClientRect());
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          left: r.left, right: r.right,
          covered: !(hit === link || (hit && link.contains(hit))),
          hitsPeriod: btns.some((b) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top),
        };
      });
      expect(m.scrollWidth, `page scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}`).toBeLessThanOrEqual(m.clientWidth);
      expect(m.left, 'Health link left edge on screen').toBeGreaterThanOrEqual(0);
      expect(m.right, `Health link right edge ${m.right} inside viewport ${w}`).toBeLessThanOrEqual(w);
      expect(m.covered, 'Health link centre covered by another element').toBe(false);
      expect(m.hitsPeriod, 'Health link box intersects a period button').toBe(false);
    });
  }
}
