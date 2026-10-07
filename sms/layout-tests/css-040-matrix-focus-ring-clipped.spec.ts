/**
 * CSS-040 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on the
 * machine-product report, when a machine column header is reached with the
 * keyboard its focus ring is cut off on the top edge (and on the right edge
 * for the last machine), because the scrolling matrix box clips it; the
 * reader sees a ring with missing sides.
 * Runs without a session: every /api/* call is mocked (./support/css-040.fixtures),
 * synthetic data only. The ring is measured as pixels that change, in the
 * band around one edge of the header, when the header gains keyboard focus.
 */
import { test, expect, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { primeMachineProduct } from './support/css-040.fixtures';

type Clip = { x: number; y: number; width: number; height: number };

async function tabTo(page: Page, selector: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector);
    if (hit) return;
  }
  throw new Error(`Tab never reached ${selector}`);
}

/** Minimal PNG decoder (8-bit RGB/RGBA, as Playwright writes) so the pixel comparison needs no dependency and no page-side image loading. */
function decodePng(buf: Buffer) {
  let o = 8, w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * stride + x] = r & 255;
    }
  }
  return { w, h, bpp, px };
}

/** Changed pixels (any channel differs by > 64) inside one band of two same-size screenshots. */
function changedInBand(a: Buffer, b: Buffer, band: { x0: number; x1: number; y0: number; y1: number }) {
  const A = decodePng(a), B = decodePng(b);
  let n = 0;
  for (let y = band.y0; y < band.y1; y++) for (let x = band.x0; x < band.x1; x++) {
    const i = (y * A.w + x) * A.bpp;
    if (Math.max(Math.abs(A.px[i]! - B.px[i]!), Math.abs(A.px[i + 1]! - B.px[i + 1]!), Math.abs(A.px[i + 2]! - B.px[i + 2]!)) > 64) n++;
  }
  return n;
}

async function ringPixels(page: Page, which: 'first' | 'last', edge: 'top' | 'right') {
  const th = page.locator('.mp-scroll thead th.click')[which]();
  await th.scrollIntoViewIfNeeded();
  const box = (await th.boundingBox())!;
  const clip: Clip = { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.width + 8, height: box.height + 8 };
  const offX = box.x - clip.x, offY = box.y - clip.y; // where the th box starts inside the clip
  await page.mouse.move(2, 2);
  const before = await page.screenshot({ clip });
  const sel = '.mp-scroll thead th.click';
  await tabTo(page, `${sel}:${which === 'first' ? 'nth-of-type(2)' : 'last-of-type'}`);
  await page.mouse.move(2, 2);
  const after = await page.screenshot({ clip });
  // The 8px band straddling the th box edge under test (4px outside, 4px inside; corners excluded): wherever the ring is drawn, it falls in here.
  const band = edge === 'top'
    ? { x0: Math.round(offX + 4), x1: Math.round(offX + box.width - 4), y0: Math.round(offY - 4), y1: Math.round(offY + 4) }
    : { x0: Math.round(offX + box.width - 4), x1: Math.round(offX + box.width + 4), y0: Math.round(offY + 4), y1: Math.round(offY + box.height - 4) };
  return changedInBand(before, after, band);
}

for (const [w, h, scale] of [[1366, 768, 1], [375, 812, 1], [1920, 1080, 1.3]] as const) {
  test(`machine-product @${w} scale ${scale}: the focus ring of the first machine header shows its top edge`, async ({ page }) => {
    await primeMachineProduct(page, w, h, scale);
    const px = await ringPixels(page, 'first', 'top');
    expect(px, `focus-ring pixels on the top edge of the header box: ${px}`).toBeGreaterThanOrEqual(20);
  });
}

test('machine-product @1366: the focus ring of the last machine header shows its right edge', async ({ page }) => {
  await primeMachineProduct(page, 1366, 768, 1);
  const px = await ringPixels(page, 'last', 'right');
  expect(px, `focus-ring pixels on the right edge of the last header box: ${px}`).toBeGreaterThanOrEqual(20);
});
