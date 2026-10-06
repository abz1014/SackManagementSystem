/**
 * CSS-058 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: a keyboard user tabbing through a segmented toggle
 * (Weight's views, Readings, Product tabs, Desk/Wall) cannot see which button has focus: the focus ring is clipped
 * by the toggle's own overflow:hidden, so nothing visibly changes. Measured as pixels that change when a button gets focus.
 * Runs without a session: every /api/* call is mocked (mockAuth + weight fixtures from ./support/mocks), synthetic data only.
 */
import { inflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockWeight } from './support/mocks';

/** Minimal 8-bit non-interlaced PNG decoder (Playwright screenshots are RGB or RGBA) so the spec needs no image library. */
function decodePng(buf: Buffer): { w: number; h: number; bpp: number; px: Buffer } {
  let o = 8; let w = 0; let h = 0; let ct = 0; const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * stride + x] = r & 255;
    }
  }
  return { w, h, bpp, px };
}

function changedPixels(a: Buffer, b: Buffer): number {
  const p = decodePng(a); const q = decodePng(b);
  let n = 0;
  for (let i = 0; i < p.w * p.h; i++) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(p.px[i * p.bpp + k]! - q.px[i * q.bpp + k]!) > 64) { n++; break; }
    }
  }
  return n;
}

for (const which of ['unselected', 'selected'] as const) {
  test(`CSS-058 keyboard focus on the ${which} toggle button changes at least 40 pixels at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockWeight(page);
    await page.goto('/?s=weight&p=pick&from=2026-09-01&to=2026-09-07');
    const toggle = page.locator('main .toggle').first();
    await toggle.waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const idx = await page.evaluate((w) => {
      const btns = Array.from(document.querySelector('main .toggle')!.querySelectorAll('button'));
      const i = btns.findIndex((b) => b.classList.contains('on') === (w === 'selected'));
      btns[i]!.setAttribute('data-probe', '1');
      return i;
    }, which);
    expect(idx, 'a button of this kind exists').toBeGreaterThanOrEqual(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Page coordinates, so a scroll caused by Tab cannot move the clip; fullPage screenshots are page-relative.
    const box = await page.evaluate(() => {
      const r = document.querySelector('main .toggle')!.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    });
    const clip = { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 };
    await page.mouse.move(0, 0);
    const before = await page.screenshot({ clip, fullPage: true });
    let focused = false;
    for (let i = 0; i < 120 && !focused; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement?.getAttribute('data-probe') === '1');
    }
    expect(focused, 'Tab reached the button').toBe(true);
    const after = await page.screenshot({ clip, fullPage: true });
    const n = changedPixels(before, after);
    expect(n, 'pixels that change by more than 64 in any channel when the button takes focus').toBeGreaterThanOrEqual(40);
  });
}
