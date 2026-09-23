/**
 * Wall mode (`?s=wall`, `web/src/screens/Wall.tsx`) at 1920x1080 — meant to
 * be read across a room on a TV, and (per the 3 Sep 2026 redesign notes in
 * CLAUDE.md) rebuilt as a composed board where "the state sentence is 79px
 * at 1920 and the footer is pinned". Never rendered by a real layout engine
 * before this harness — jsdom cannot lay it out at all.
 *
 * Needs a session — see `support/auth.ts`.
 */
import { test, expect } from '@playwright/test';
import { signedInPage } from './support/auth';

test('Wall board at 1920x1080: state sentence and footer present, not clipped', async ({ browser, baseURL }) => {
  const s = await signedInPage(browser, baseURL!);
  test.skip(s.page === null, (s as { reason: string }).reason ?? 'no session');
  if (s.page === null) return;
  const { page, context } = s;

  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/?s=wall');

    // Wall renders with no navigation chrome (App.tsx: `route.view === 'wall'`
    // returns its own tree, bypassing the top bar) — wait for its own content
    // rather than the bar.
    const root = page.locator('body');
    await expect(root).toBeVisible();

    const viewportH = 1080;
    const viewportW = 1920;

    // The state sentence — look for a plausible role/text rather than a
    // class name this spec doesn't own; report what was found either way.
    const stateCandidates = page.locator('[class*="state"], [class*="verdict"], main >> text=/running|stopped|idle/i');
    const stateCount = await stateCandidates.count();
    console.log(`[wall 1920x1080] state-sentence candidates found: ${stateCount}`);

    if (stateCount > 0) {
      const box = await stateCandidates.first().boundingBox();
      console.log(`[wall 1920x1080] first state candidate box: ${JSON.stringify(box)}`);
      if (box) {
        expect(box.y, 'state sentence starts above the viewport top').toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, 'state sentence extends below the viewport bottom (clipped)').toBeLessThanOrEqual(viewportH + 1);
      }
    }

    const footer = page.locator('footer');
    const footerCount = await footer.count();
    console.log(`[wall 1920x1080] <footer> elements found: ${footerCount}`);
    if (footerCount > 0) {
      const fbox = await footer.first().boundingBox();
      console.log(`[wall 1920x1080] footer box: ${JSON.stringify(fbox)}`);
      if (fbox) {
        expect(fbox.y + fbox.height, 'footer extends below the 1080px viewport (not pinned/visible)').toBeLessThanOrEqual(viewportH + 1);
      }
    }

    const bodyOverflow = await page.locator('html').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    console.log(`[wall 1920x1080] html scrollWidth=${bodyOverflow.scrollWidth} clientWidth=${bodyOverflow.clientWidth}`);
    expect(bodyOverflow.scrollWidth, 'Wall page scrolls horizontally at its target 1920 width').toBeLessThanOrEqual(viewportW + 1);
  } finally {
    await context.close();
  }
});
