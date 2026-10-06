/**
 * CSS-080 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: keyboard focus on the "x" that clears a reason filter is
 * invisible, because its default dark focus ring is drawn on the dark ink chip. Runs without a session: every /api/* call is
 * mocked; the reason filter comes from the URL (jc) and the page shows its chip.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects } from './support/mocks';

test('Rejects reason chip: focusing the clear button changes pixels inside the chip', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockRejects(page);
  await page.goto('/?s=rejects&p=pick&from=2026-09-01&to=2026-09-07&jc=3-5');
  const x = page.locator('.chip.on button.x');
  await x.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  const bb = (await page.locator('.chip.on').boundingBox())!;
  const clip = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  await page.mouse.move(0, 0);
  const before = await page.screenshot({ clip });
  await page.keyboard.press('Tab');
  for (let i = 0; i < 80; i++) {
    if (await x.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  expect(await x.evaluate((el) => el === document.activeElement), 'clear button reached by keyboard').toBe(true);
  const after = await page.screenshot({ clip });
  const scratch = await page.context().newPage(); // data: images are not decoded in the app page (CSP), so diff in a blank page
  const changed = await scratch.evaluate(async ([a, b]) => {
    const load = (s: string) => new Promise<ImageData>((res) => {
      const i = new Image();
      i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d')!; g.drawImage(i, 0, 0); res(g.getImageData(0, 0, i.width, i.height)); };
      i.src = 'data:image/png;base64,' + s;
    });
    const [A, B] = await Promise.all([load(a), load(b)]);
    let n = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      if (Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])) > 64) n++;
    }
    return n;
  }, [before.toString('base64'), after.toString('base64')] as [string, string]);
  expect(changed, `pixels changed by focus inside the chip: ${changed}`).toBeGreaterThanOrEqual(30);
});
