/**
 * CSS-073 (Phase 2 CSS recovery, owner decision 6 Oct 2026, option A). User impact: on a phone a listing table wider than its box
 * scrolls sideways inside it with no sign that there is more to the right (or, once scrolled, to the left), so a reader takes the
 * visible columns for the whole table. Owner chose: keep the scroll, add an edge fade cue on scrollable tables.
 * Runs without a session: every /api/* call is mocked, synthetic rows only. The cue is measured as pixels: with the cell text and
 * rules made transparent (so only the box's own background can show), the strip along an edge is darker when that edge has hidden
 * content than when it does not.
 */
import { inflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, META } from './support/mocks';

function mean(buf: Buffer, x0: number, x1: number, y0: number, y1: number): number {
  let o = 8, w = 0, h = 0, ct = 0; const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat)); const stride = w * bpp; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0; const b = y > 0 ? px[(y - 1) * stride + x]! : 0; const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * stride + x] = r & 255;
    }
  }
  let s = 0, n = 0;
  for (let y = y0; y < Math.min(y1, h); y++) for (let x = x0; x < Math.min(x1, w); x++) { const i = y * stride + x * bpp; s += (px[i]! + px[i + 1]! + px[i + 2]!) / 3; n++; }
  return s / n;
}

const rows = Array.from({ length: 12 }, (_, i) => ({
  event_id: 900000 + i, source_row_id: 5000 + i, source_epoch: 9, source_epoch_label: 'Sample - cones',
  reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 2, reject_label: null,
  production_ts_utc: `2026-09-03T0${(i % 9)}:1${i % 6}:2${i % 9}Z`, shift_code: 'A', shift_date: '2026-09-03', shift_code_legacy: null,
  weight_g: 1950 + i, weight_kg: null, in_range: true, state: 'within', product_name: '205-IL0-SD',
}));

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows, total: rows.length, page: 1, pageSize: 50 }, metadata: META } }));
  await page.goto('/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07');
  await page.locator('table tbody tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // Only the box's own background may show: no text, rules or row fills.
  await page.addStyleTag({ content: '.tw table, .tw table * { color: transparent !important; border-color: transparent !important; background: transparent !important; box-shadow: none !important; } .tw .chev { display: none !important; }' });
  await page.waitForTimeout(250);
}

async function strips(page: Page, scrollTo: 'start' | 'end') {
  const box = page.locator('.tw').filter({ has: page.locator('tr.click') }).first();
  await box.evaluate((el, to) => { (el as HTMLElement).scrollLeft = to === 'end' ? (el as HTMLElement).scrollWidth : 0; }, scrollTo);
  await page.waitForTimeout(200);
  const bb = await box.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
  const clip = { x: Math.round(bb.x), y: Math.round(bb.y), width: Math.round(bb.width), height: Math.round(bb.height) };
  const png = await page.screenshot({ clip, fullPage: true });
  const w = clip.width, h = Math.max(4, clip.height - 4);
  return { left: mean(png, 0, 6, 2, h), right: mean(png, w - 6, w, 2, h) };
}

test('CSS-073 a phone-width listing that overflows fades its edges where content is hidden', async ({ page }) => {
  await open(page, 375);
  const m = await page.evaluate(() => { const el = Array.from(document.querySelectorAll('.tw')).find((e) => e.querySelector('tr.click')) as HTMLElement; return { sw: el.scrollWidth, cw: el.clientWidth }; });
  expect(m.sw, 'the listing is wider than its box at 375').toBeGreaterThan(m.cw);
  const start = await strips(page, 'start');
  const end = await strips(page, 'end');
  expect(end.right - start.right, `right edge strip: at the start ${start.right.toFixed(1)}, at the end ${end.right.toFixed(1)} (hidden content on the right must show a fade)`).toBeGreaterThanOrEqual(8);
  expect(start.left - end.left, `left edge strip: at the start ${start.left.toFixed(1)}, at the end ${end.left.toFixed(1)} (hidden content on the left must show a fade)`).toBeGreaterThanOrEqual(8);
});

test('CSS-073 a listing that fits its box at 1366 shows no fade', async ({ page }) => {
  await open(page, 1366);
  const m = await page.evaluate(() => { const el = Array.from(document.querySelectorAll('.tw')).find((e) => e.querySelector('tr.click')) as HTMLElement; return { sw: el.scrollWidth, cw: el.clientWidth }; });
  expect(m.sw, 'the listing fits its box at 1366').toBeLessThanOrEqual(m.cw);
  const s = await strips(page, 'start');
  expect(s.left, `left edge strip ${s.left.toFixed(1)}`).toBeGreaterThanOrEqual(252);
  expect(s.right, `right edge strip ${s.right.toFixed(1)}`).toBeGreaterThanOrEqual(252);
});
