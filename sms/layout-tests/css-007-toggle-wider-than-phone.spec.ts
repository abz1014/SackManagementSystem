/**
 * CSS-007 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: a segmented toggle (Readings' listing, Product's tabs and
 * history views) is wider than a phone, so it runs off the right edge and the whole page scrolls sideways. Runs without a
 * session: every /api/* call is mocked, synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockProductRunning, mockReport, META } from './support/mocks';

const fixtureRows = Array.from({ length: 6 }, (_, i) => ({
  event_id: 900000 + i, source_row_id: 5000 + i, source_epoch: 9, source_epoch_label: 'Sample - cones',
  reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 2, reject_label: null,
  production_ts_utc: `2026-09-03T0${i}:10:20Z`, shift_code: 'A', shift_date: '2026-09-03', shift_code_legacy: null,
  weight_g: 1950 + i, weight_kg: null, in_range: true, state: 'within', product_name: '205-IL0-SD',
}));
const rows = fixtureRows;

const SCREENS = [
  { name: 'Readings', url: '/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07' },
  { name: 'Product Running', url: '/?s=product&pt=running&p=today' },
  { name: 'Product History', url: '/?s=product&pt=history&p=today' },
];

for (const w of [320, 375]) {
  for (const s of SCREENS) {
    test(`CSS-007 ${s.name} @${w}: every toggle stays inside the viewport and the page does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 812 });
      await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockProductRunning(page);
      await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows, total: rows.length, page: 1, pageSize: 50 }, metadata: META } }));
      await page.goto(s.url);
      await page.locator('main .toggle').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({
        vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
        toggles: Array.from(document.querySelectorAll('.toggle')).map((t) => Math.round((t as HTMLElement).getBoundingClientRect().right)),
      }));
      expect(m.sw, `${s.name} @${w}: scrollWidth ${m.sw} vs clientWidth ${m.vw}`).toBeLessThanOrEqual(m.vw);
      for (const r of m.toggles) expect(r, `toggle right edge ${r} vs viewport ${m.vw}`).toBeLessThanOrEqual(m.vw);
    });
  }
}

// [CSS-007 rework, 7 Oct 2026] The first version of the fix made `.tw` position: relative, and a positioned table that follows a chart
// painted over the 6px of the chart's resize handle that hang below it: on the Station and Calibration reports only about 30 % of the
// handle could be grabbed. Every sample point along the handle must hit-test to the handle itself.
for (const kind of ['station', 'calibration', 'daily'] as const) {
  test(`CSS-007 Report ${kind} @1366: the chart resize handle is the hit-test target along its whole width`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
    await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
    const handle = page.locator('.chart-resize').first();
    await handle.waitFor({ state: 'attached', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await handle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const h = document.querySelector('.chart-resize') as HTMLElement;
      const r = h.getBoundingClientRect();
      let hit = 0; let tot = 0; const covered = new Set<string>();
      for (let y = Math.ceil(r.top); y < r.bottom; y++) {
        for (let x = Math.ceil(r.left) + 2; x < r.right; x += 8) {
          tot++;
          const e = document.elementFromPoint(x, y);
          if (e && (e === h || h.contains(e))) hit++; else if (e) covered.add(e.tagName + '.' + String((e as HTMLElement).className));
        }
      }
      const next = h.closest('.chart-frame')?.nextElementSibling;
      return { hit, tot, covered: [...covered].slice(0, 3), tableAfterChart: !!next && (next.matches('.tw') || !!next.querySelector('.tw')) };
    });
    expect(res.tot, `${kind}: sample points on the handle`).toBeGreaterThan(20);
    expect(res.hit, `${kind}: ${res.hit}/${res.tot} handle points reachable, covered by ${JSON.stringify(res.covered)}`).toBe(res.tot);
  });
}
