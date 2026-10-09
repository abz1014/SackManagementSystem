/**
 * CSS-053 (Phase 2 CSS recovery, owner decision 6 Oct 2026, option B). User impact: after a reader clicks a chart mark to zoom the
 * whole page to that day or shift, the only way back is "Back to previous range" in the top bar, which has scrolled out of view
 * (the chart sits far down the page), so the reader sees the page change and has no visible way to undo it. Owner chose: after a
 * zoom, show a "Zoomed in · Back" control beside the chart that was zoomed.
 * Runs without a session: every /api/* call is mocked, synthetic data only; the GET-only mock never lets a non-GET through.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockWeight, mockRejects } from './support/mocks';

const CASES = [
  { name: 'Weight over time', url: '/?s=weight&wt=cone&wm=time&p=pick&from=2026-08-05&to=2026-09-07', setup: mockWeight },
  { name: 'Rejects trend', url: '/?s=rejects&p=pick&from=2026-08-05&to=2026-09-07', setup: mockRejects },
] as const;

async function zoomFromScrolled(page: Page, c: (typeof CASES)[number]) {
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await c.setup(page);
  await page.goto(c.url);
  const frames = page.locator('.chart-frame-body');
  await frames.first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
  // Try the charts in order until a click changes the page period (a zoomable mark).
  const n = await frames.count();
  const before = page.url();
  for (let i = 0; i < n; i++) {
    const body = frames.nth(i);
    await body.scrollIntoViewIfNeeded();
    const box = (await body.boundingBox())!;
    await body.click({ position: { x: box.width * 0.3, y: box.height / 2 } });
    await page.waitForTimeout(400);
    if (page.url() !== before) return i;
  }
  return -1;
}

for (const [w, h, scale] of [[1366, 768, 1], [768, 1024, 1], [1920, 1080, 1], [1366, 768, 1.3]] as const) {
  for (const c of CASES) {
    test(`CSS-053 ${c.name} @${w}x${h} scale ${scale}: a Back control is in view after a click-zoom and restores the period`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* none */ } }, scale);
      const urlBefore = (() => c.url)();
      const idx = await zoomFromScrolled(page, c);
      test.skip(idx < 0, 'no zoomable mark found on this mock');
      expect(new URL(page.url()).searchParams.get('p'), 'the click zoomed the page').toBe('range');
      const back = page.getByRole('button', { name: /zoomed in/i });
      await expect(back, 'a Zoomed-in Back control exists').toHaveCount(1);
      const r = await back.evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, vh: innerHeight, vw: innerWidth }; });
      expect(r.top, 'control top is inside the viewport').toBeGreaterThanOrEqual(0);
      expect(r.bottom, 'control bottom is inside the viewport').toBeLessThanOrEqual(r.vh);
      expect(r.right, 'control right edge is inside the viewport').toBeLessThanOrEqual(r.vw);
      await back.focus();
      expect(await page.evaluate(() => document.activeElement?.textContent ?? ''), 'keyboard focus reaches the control').toMatch(/zoomed in/i);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      expect(new URL(page.url()).searchParams.get('p'), 'activating it restores the previous period').toBe('pick');
      expect(new URL(page.url()).searchParams.get('from')).toBe('2026-08-05');
      await expect(page.getByRole('button', { name: /zoomed in/i }), 'the control is gone once the page is not zoomed').toHaveCount(0);
      void urlBefore;
    });
  }
}

test('CSS-053 no Back control on a page that was not zoomed', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockWeight(page);
  await page.goto(CASES[0].url);
  await page.locator('.chart-frame-body').first().waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByRole('button', { name: /zoomed in/i })).toHaveCount(0);
});
