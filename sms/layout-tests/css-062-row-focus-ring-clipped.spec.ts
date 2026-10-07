/**
 * CSS-062 (Phase 2 CSS defect loop, 7 Oct 2026). User impact: a keyboard user tabbing through the Readings register
 * sees the focus ring of the row clipped on its left and right edges (the row is as wide as its scroll wrapper, which
 * clips an outside outline), so the focused row looks only half outlined. Measured as pixels that change within 3px of
 * each side edge of the row when it takes focus.
 * Runs without a session: every /api/* call is mocked (mockAuth + a synthetic register), synthetic data only.
 */
import { inflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, META } from './support/mocks';

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

const rows = Array.from({ length: 12 }, (_, i) => ({
  event_id: 900000 + i, source_row_id: 5000 + i, source_epoch: 9, source_epoch_label: 'Sample - cones',
  reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 2, reject_label: null,
  production_ts_utc: `2026-09-03T0${(i % 9)}:1${i % 6}:2${i % 9}Z`, shift_code: 'A', shift_date: '2026-09-03', shift_code_legacy: null,
  weight_g: 1950 + i, weight_kg: null, in_range: true, state: 'within', product_name: '205-IL0-SD',
}));

for (const [width, scale] of [[1366, '1'], [1920, '1'], [1366, '1.3']] as const) {
  test(`CSS-062 Readings @${width} scale ${scale}: focus ring shows on the left and right edge of a clickable row`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 768 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
    await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows, total: rows.length, page: 1, pageSize: 50 }, metadata: META } }));
    await page.goto('/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07');
    await page.locator('table tbody tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.querySelector('table tbody tr.click')!.setAttribute('data-probe', '1'); (document.activeElement as HTMLElement | null)?.blur(); });
    const box = await page.evaluate(() => {
      const r = document.querySelector('[data-probe]')!.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    });
    const clip = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 };
    await page.mouse.move(0, 0);
    const before = await page.screenshot({ clip, fullPage: true });
    let focused = false;
    for (let i = 0; i < 150 && !focused; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-probe') ?? false);
    }
    expect(focused, 'Tab reached the first clickable row').toBe(true);
    const after = await page.screenshot({ clip, fullPage: true });
    const p = decodePng(before); const q = decodePng(after);
    // Row edges inside the clip (the clip starts 8px before the row; a scrolled page start may shorten that margin).
    const ox = Math.min(8, box.x); const oy = Math.min(8, box.y);
    const strip = (from: number, to: number) => {
      let n = 0;
      for (let y = Math.round(oy + 4); y < Math.round(oy + box.height - 4); y++) {
        for (let x = Math.max(0, Math.round(from)); x < Math.min(p.w, Math.round(to)); x++) {
          for (let k = 0; k < 3; k++) {
            if (Math.abs(p.px[(y * p.w + x) * p.bpp + k]! - q.px[(y * q.w + x) * q.bpp + k]!) > 64) { n++; break; }
          }
        }
      }
      return n;
    };
    const left = strip(ox - 3, ox + 3);
    const right = strip(ox + box.width - 3, ox + box.width + 3);
    expect(left, `changed pixels within 3px of the row's left edge: ${left}`).toBeGreaterThanOrEqual(10);
    expect(right, `changed pixels within 3px of the row's right edge: ${right}`).toBeGreaterThanOrEqual(10);
  });
}
