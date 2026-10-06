/**
 * CSS-001 (Phase 2 CSS defect loop, 5 Oct 2026) - the top bar's nav links.
 *
 * USER IMPACT: on a narrow window (phone, or a desktop window dragged narrow,
 * or the Wall text size on a ~900px window) the nav row wraps onto several
 * lines but the nav box keeps a fixed 40px height, so the period strip that
 * follows it is painted over Rejects / Sacks / Product / Report / Health: the
 * reader cannot see or tap five of the eight screens.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts), the
 * server only serves the built static app. Synthetic fixtures only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

const CELLS = [
  { w: 375, h: 812, scale: 1, url: '/?s=line&p=today' },
  { w: 320, h: 700, scale: 1, url: '/?s=line&p=today' },
  { w: 600, h: 900, scale: 1, url: '/?s=line&p=today' },
  { w: 820, h: 900, scale: 1, url: '/?s=line&p=today' },
  { w: 375, h: 812, scale: 1, url: '/?s=line&p=pick&from=2026-09-01&to=2026-09-07' },
  { w: 900, h: 900, scale: 1.3, url: '/?s=line&p=today' },
] as const;

async function prime(page: Page, scale: number, url: string) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockLine(page);
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  await page.goto(url);
  await page.locator('.nav-link').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

for (const c of CELLS) {
  test(`CSS-001 nav links are hit-testable and clear of the period strip at ${c.w}x${c.h}@${c.scale} ${c.url.includes('pick') ? 'pick' : 'today'}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await prime(page, c.scale, c.url);
    const res = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll<HTMLElement>('.nav-link'));
      const btns = Array.from(document.querySelectorAll<HTMLElement>('.period button')).map((b) => b.getBoundingClientRect());
      return links.map((l) => {
        const r = l.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const hitOk = !!hit && (hit === l || l.contains(hit));
        const hitsPeriod = btns.some((b) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
        return { text: l.textContent, hitOk, hitsPeriod, y: Math.round(r.top + window.scrollY) };
      });
    });
    expect(res.length, 'all 8 nav links render').toBe(8);
    const covered = res.filter((r) => !r.hitOk);
    expect(covered, `nav links whose centre is covered by something else: ${JSON.stringify(covered)}`).toEqual([]);
    const overlapping = res.filter((r) => r.hitsPeriod);
    expect(overlapping, `nav links whose box intersects a period button: ${JSON.stringify(overlapping)}`).toEqual([]);
  });
}
