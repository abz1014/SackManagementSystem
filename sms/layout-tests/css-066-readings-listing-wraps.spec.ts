/**
 * CSS-066 (Phase 2 CSS loop, 6 Oct 2026). User impact: between 600 and 810 px
 * wide the Readings listing wraps every cell onto two lines (rows ~70 px), so a
 * screenful holds a third fewer readings. Runs without a session: mocked API,
 * synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, META } from './support/mocks';

const rows = Array.from({ length: 12 }, (_, i) => ({
  event_id: 900000 + i, source_row_id: 5000 + i, source_epoch: 9, source_epoch_label: 'Sample - cones',
  reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 2, reject_label: null,
  production_ts_utc: `2026-09-03T0${(i % 9)}:1${i % 6}:2${i % 9}Z`, shift_code: 'A', shift_date: '2026-09-03', shift_code_legacy: null,
  weight_g: 1950 + i, weight_kg: null, in_range: true, state: 'within', product_name: '205-IL0-SD',
}));

for (const width of [700, 760]) {
  test(`Readings rejected listing rows stay on one line at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
    await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows, total: rows.length, page: 1, pageSize: 50 }, metadata: META } }));
    await page.goto('/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07');
    await page.locator('table tbody tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    const h = await page.evaluate(() => Array.from(document.querySelectorAll('table tbody tr.click')).map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(h.length).toBeGreaterThan(5);
    expect(Math.max(...h), `row heights at ${width}: ${h.join(',')}`).toBeLessThanOrEqual(50);
  });
}
