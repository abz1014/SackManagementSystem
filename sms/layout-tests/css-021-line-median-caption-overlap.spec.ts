/**
 * CSS-021 (Phase 2 CSS defect loop, 5 Oct 2026). User impact: on Line at
 * phone width the "row median" legend caption sits over station tile 1's
 * label, so the first station's name is unreadable.
 * Runs without a session: every /api/* call is mocked (mockLine), synthetic data.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine } from './support/mocks';

for (const [width, scale] of [[320, '1'], [375, '1'], [390, '1'], [460, '1.3'], [470, '1.3']] as const) {
  test(`Line @${width} scale ${scale}: the "row median" caption overlaps no station tile text`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 812 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockLine(page);
    await page.goto('/?s=line&p=today');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const cap = Array.from(document.querySelectorAll('p, span, div')).filter((e) => e.children.length === 0 && (e.textContent ?? '').includes('row median'))[0];
      if (!cap) return { found: false, overlaps: [] as string[] };
      const c = cap.getBoundingClientRect();
      const out: string[] = [];
      // Every other text-bearing leaf element that is not the caption itself.
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (el === cap || el.contains(cap) || cap.contains(el)) continue;
        if (el.closest('svg')) continue;
        if (el.children.length > 0) continue;
        const t = (el.textContent ?? '').trim();
        if (!t) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const ox = Math.min(c.right, r.right) - Math.max(c.left, r.left);
        const oy = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
        if (ox > 0.5 && oy > 0.5) out.push(`${t.slice(0, 30)} (${ox.toFixed(1)}x${oy.toFixed(1)})`);
      }
      return { found: true, overlaps: out };
    });
    expect(res.found, '"row median" caption is rendered').toBe(true);
    expect(res.overlaps, `caption overlaps: ${res.overlaps.join('; ')}`).toEqual([]);
  });
}
