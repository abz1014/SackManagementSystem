/**
 * CSS-025 (Phase 2 CSS loop, 2 Oct 2026). User impact: four Changeover text
 * fields (lot/description, PP colour, sack colour, reason) render as bare 21px
 * browser-default boxes while the number fields beside them are the app's
 * 39px styled inputs, so they read as not-editable and are hard to hit.
 * Runs without a session: every /api call is mocked.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockProductChangeover } from './support/mocks';

for (const w of [1366, 375]) {
  test(`Changeover text inputs match the styled inputs at ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockProductChangeover(page);
    await page.goto('/?s=product&pt=changeover&p=today');
    await page.locator('label.field input[type=number]').first().waitFor({ state: 'visible', timeout: 15_000 });
    const m = await page.evaluate(() => {
      const ins = [...document.querySelectorAll('label.field > input')] as HTMLInputElement[];
      const info = (i: HTMLInputElement) => { const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return { h: r.height, fs: cs.fontSize, type: i.type, label: i.parentElement!.textContent!.slice(0, 20) }; };
      const num = ins.find((i) => i.type === 'number')!;
      const texts = ins.filter((i) => i.type === 'text' || !i.hasAttribute('type'));
      return { ref: info(num), texts: texts.map(info) };
    });
    expect(m.texts.length, 'found the four text inputs').toBeGreaterThanOrEqual(4);
    for (const t of m.texts) {
      expect(Math.abs(t.h - m.ref.h), `"${t.label}" height ${t.h} vs number input ${m.ref.h}`).toBeLessThanOrEqual(1);
      expect(t.fs, `"${t.label}" font-size`).toBe(m.ref.fs);
    }
  });
}
