/**
 * CSS-059 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: with Windows high-contrast / forced colours on, the selected
 * toggle button, report chip and period button look exactly like the unselected ones (the ink fill that marks them is
 * overridden), so the reader cannot tell which view, report or period is chosen. Measured two ways: computed style of the
 * selected vs unselected sibling, and pixels that change when the selected state is switched off in place.
 * Runs without a session: every /api/* call is mocked (mockAuth + mocks), synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, META } from './support/mocks';
import { changedPixels } from './support/css-059.fixtures';

const rows = Array.from({ length: 6 }, (_, i) => ({
  event_id: 900000 + i, source_row_id: 5000 + i, source_epoch: 9, source_epoch_label: 'Sample - cones',
  reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 2, reject_label: null,
  production_ts_utc: `2026-09-03T0${i}:10:20Z`, shift_code: 'A', shift_date: '2026-09-03', shift_code_legacy: null,
  weight_g: 1950 + i, weight_kg: null, in_range: true, state: 'within', product_name: '205-IL0-SD',
}));

async function setup(page: Page, url: string, kind: 'readings' | 'report') {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ forcedColors: 'active' });
  await mockCatchAll(page); await mockAuth(page); await mockCommon(page);
  if (kind === 'readings') await page.route('**/api/events**', (r) => r.fulfill({ json: { data: { rows, total: rows.length, page: 1, pageSize: 50 }, metadata: META } }));
  else await mockReport(page, 'daily');
  await page.goto(url);
}

const TARGETS = [
  { name: 'Readings toggle', url: '/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07', kind: 'readings' as const, sel: 'main .toggle button' },
  { name: 'Report type chip', url: '/?s=report&rt=daily&p=pick&from=2026-09-01&to=2026-09-07', kind: 'report' as const, sel: 'button.chip[aria-pressed]' },
  { name: 'Period button', url: '/?s=readings&rl=inspectionRejects&p=pick&from=2026-09-01&to=2026-09-07', kind: 'readings' as const, sel: '.period button' },
];

for (const t of TARGETS) {
  test(`CSS-059 forced colours: ${t.name} selected differs from unselected`, async ({ page }) => {
    await setup(page, t.url, t.kind);
    await page.locator(`${t.sel}[aria-pressed="true"]`).first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const props = await page.evaluate((sel) => {
      const all = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      const on = all.find((b) => b.getAttribute('aria-pressed') === 'true')!;
      const off = all.find((b) => b.getAttribute('aria-pressed') === 'false')!;
      const g = (e: HTMLElement) => { const c = getComputedStyle(e); return { border: c.borderTopColor, outline: c.outlineStyle, bg: c.backgroundColor, deco: c.textDecorationLine, color: c.color }; };
      return { on: g(on), off: g(off) };
    }, t.sel);
    const differing = (['border', 'outline', 'bg', 'deco'] as const).filter((k) => props.on[k] !== props.off[k]);
    expect(differing, `computed styles of selected ${JSON.stringify(props.on)} vs unselected ${JSON.stringify(props.off)}`).not.toHaveLength(0);

    // Pixels: screenshot the selected button (page coordinates), switch its selected state off in place, screenshot again.
    const btn = page.locator(`${t.sel}[aria-pressed="true"]`).first();
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
    const clip = { x: Math.max(0, box.x - 2), y: Math.max(0, box.y - 2), width: box.width + 4, height: box.height + 4 };
    await page.mouse.move(0, 0);
    const a = await page.screenshot({ clip, fullPage: true });
    await btn.evaluate((e) => { e.classList.remove('on'); e.setAttribute('aria-pressed', 'false'); });
    await page.mouse.move(0, 0);
    const b = await page.screenshot({ clip, fullPage: true });
    const n = changedPixels(a, b);
    expect(n, `${t.name}: pixels that change when the selected state is removed`).toBeGreaterThanOrEqual(30);
  });
}
