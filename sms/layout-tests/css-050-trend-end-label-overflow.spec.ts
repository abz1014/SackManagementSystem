/**
 * CSS-050 (Phase 2 CSS defect loop, 5 Oct 2026). User impact: on Rejects,
 * when one reason is followed ("Code 2/1 - not yet named"), the trend
 * chart's end-of-line label is wider than the fixed right gutter, so it runs
 * out of the chart and over the reason list beside it.
 * Runs without a session: every /api/* call is mocked (mockRejects plus a
 * synthetic reason with no name), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, META } from './support/mocks';

const envelope = <T,>(data: T) => ({ data, metadata: META });

const REASONS = envelope({
  total: 3600,
  reasons: [
    { rejectCodeId: 7, rejectType: 'quality', tubeCode: 2, materialCode: 1, label: null, displayLabel: 'Code 2/1 — not yet named', count: 1500, pct: 41.7, cumulativePct: 41.7 },
    { rejectCodeId: 2, rejectType: 'weight', tubeCode: null, materialCode: null, label: null, displayLabel: 'weight:0:0', count: 2100, pct: 58.3, cumulativePct: 100 },
  ],
});

for (const [width, scale] of [[320, '1'], [375, '1'], [375, '1.3'], [768, '1'], [1366, '1'], [1366, '1.3']] as const) {
  test(`Rejects followed reason @${width} scale ${scale}: trend end label stays inside the chart svg`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 900 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockRejects(page);
    await page.route('**/api/rejects**', (route) => {
      if (route.request().url().includes('by-day-code')) return route.fulfill({ json: envelope({ rows: [] }) });
      return route.fulfill({ json: REASONS });
    });
    await page.goto('/?s=rejects&p=today&jc=2-1');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const svg = Array.from(document.querySelectorAll('.chart-frame svg')).find((s) => s.getAttribute('aria-label')?.includes('Reject rate'));
      if (!svg) return { found: false } as const;
      const texts = Array.from(svg.querySelectorAll('text')).filter((t) => /Code 2\/1.*%$/.test((t.textContent ?? '').trim()) || /not yet named.*%$/.test((t.textContent ?? '').trim()) || /…\s*[\d.]+%$/.test((t.textContent ?? '').trim()));
      const end = texts[texts.length - 1];
      if (!end) return { found: false } as const;
      const sr = svg.getBoundingClientRect();
      const er = end.getBoundingClientRect();
      // x-axis labels (bottom row, not a % label): RV-W1-b found a wider gutter overprinted them at 375.
      const all = Array.from(svg.querySelectorAll('text')).map((t) => ({ t, r: t.getBoundingClientRect() })).filter((o) => o.r.width > 0);
      const maxY = Math.max(...all.map((o) => (o.r.top + o.r.bottom) / 2));
      const row = all.filter((o) => Math.abs((o.r.top + o.r.bottom) / 2 - maxY) < 4 && !/%$/.test((o.t.textContent ?? '').trim())).sort((a, b) => a.r.left - b.r.left);
      const xGaps = row.slice(1).map((o, i) => o.r.left - row[i]!.r.right);
      const xLabels = row.map((o) => (o.t.textContent ?? '').trim());
      const list = Array.from(document.querySelectorAll('main .two-col > div')).filter((d) => !d.contains(svg));
      const hit = list.filter((d) => {
        const r = d.getBoundingClientRect();
        return er.left < r.right && er.right > r.left && er.top < r.bottom && er.bottom > r.top && er.right > sr.right;
      }).length;
      return { found: true, text: (end.textContent ?? '').trim(), overshoot: er.right - sr.right, listHits: hit, xGaps, xLabels } as const;
    });
    expect(res.found, 'the followed-reason end label is drawn').toBe(true);
    if (res.found) {
      expect(res.overshoot, `end label "${res.text}" overshoots the svg right edge by this many px`).toBeLessThanOrEqual(0.5);
      expect(res.listHits, 'end label runs over the reason list').toBe(0);
      expect(Math.min(0, ...res.xGaps), `gap between x labels ${JSON.stringify(res.xLabels)} (px)`).toBeGreaterThanOrEqual(0);
    }
  });
}
