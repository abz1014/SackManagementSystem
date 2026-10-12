/**
 * CSS-053 follow-up (Stage 3, 12 Oct 2026). User impact: on Line, clicking a day bar zooms the page to that day, and the page then draws
 * cones per shift instead of cones per day (a different chart). The "Zoomed in · Back" control was only kept for a chart with the
 * same id, so here it never appeared and the reader had to scroll up to the top bar to undo the zoom.
 * Runs without a session: every /api/* call is mocked, synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

for (const [w, h] of [[1366, 768], [375, 812]] as const) {
  test(`CSS-053b Line @${w}x${h}: the Back control shows beside the redrawn chart after a day bar is clicked`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockLine(page);
    await page.goto('/?s=line&p=pick&from=2026-08-05&to=2026-09-07');
    const bodies = page.locator('.chart-frame-body');
    await bodies.first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    const before = page.url();
    const body = bodies.first();
    await body.scrollIntoViewIfNeeded();
    const box = (await body.boundingBox())!;
    await body.click({ position: { x: box.width * 0.3, y: box.height / 2 } });
    await page.waitForTimeout(600);
    expect(page.url(), 'the click zoomed the page').not.toBe(before);
    expect(new URL(page.url()).searchParams.get('p')).toBe('range');
    const back = page.getByRole('button', { name: /zoomed in/i });
    await expect(back, 'a Zoomed-in Back control exists beside the redrawn chart').toHaveCount(1);
    const r = await back.evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight }; });
    expect(r.top, 'control top is inside the viewport').toBeGreaterThanOrEqual(0);
    expect(r.bottom, 'control bottom is inside the viewport').toBeLessThanOrEqual(r.vh);
    await back.click();
    await page.waitForTimeout(400);
    expect(new URL(page.url()).searchParams.get('p'), 'activating it restores the previous period').toBe('pick');
    await expect(page.getByRole('button', { name: /zoomed in/i })).toHaveCount(0);
  });
}
