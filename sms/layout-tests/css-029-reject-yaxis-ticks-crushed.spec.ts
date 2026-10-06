/**
 * CSS-029 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on the Rejects
 * trend the y axis is labelled 1-4 % only, 12-14 px apart, while the line
 * runs to 14.6 %, so the high days (the ones that matter) have no scale and
 * the labels nearly touch.
 * Runs without a session: every /api/* call is mocked (mockRejects plus a
 * synthetic reject-spc series with a 14.6 % peak), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, META } from './support/mocks';

const envelope = <T,>(data: T) => ({ data, metadata: META });

function series(days: number, peak: number) {
  const buckets = Array.from({ length: days }, (_, i) => ({
    bucketTs: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    generation: 3,
    produced: 4000,
    inspected: 4100,
    rejects: 100,
    rate: (i === Math.floor(days / 2) ? peak : 2 + (i % 4) * 0.5) / 100,
    ucl: 3.5 / 100,
    lcl: 0.5 / 100,
    outOfControl: false,
  }));
  return envelope({
    bucketSize: 'day', rejectTypeFilter: 'all', totalProduced: 132_000, totalRejects: 3600, pBar: 0.0216,
    spansGenerations: false, generations: [], outOfControlCount: 0, buckets, episodes: [],
  });
}

for (const [days, peak, width] of [[34, 14.6, 1366], [34, 14.6, 375], [2, 14.6, 1366]] as const) {
  test(`Rejects trend ${days} days peak ${peak}% @${width}: y axis labels reach the data and are >= 16px apart`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockRejects(page);
    await page.route('**/api/reject-spc**', (route) => route.fulfill({ json: series(days, peak) }));
    await page.goto('/?s=rejects&p=today');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const svg = Array.from(document.querySelectorAll('.chart-frame svg')).find((s) => s.getAttribute('aria-label')?.includes('Reject rate'));
      if (!svg) return { found: false } as const;
      const sr = svg.getBoundingClientRect();
      const ticks = Array.from(svg.querySelectorAll('text'))
        .filter((t) => t.getAttribute('text-anchor') === 'end' && /^\d+(\.\d+)?%$/.test((t.textContent ?? '').trim()) && t.getBoundingClientRect().left - sr.left < 80)
        .map((t) => { const r = t.getBoundingClientRect(); return { v: parseFloat((t.textContent ?? '').trim()), y: (r.top + r.bottom) / 2 }; })
        .sort((a, b) => a.v - b.v);
      return { found: true, ticks } as const;
    });
    expect(res.found, 'the reject trend chart is drawn').toBe(true);
    if (!res.found) return;
    const t = res.ticks;
    expect(t.length, 'y tick labels found').toBeGreaterThan(1);
    const gapsPx = t.slice(1).map((x, i) => t[i]!.y - x.y);
    const gapsVal = t.slice(1).map((x, i) => x.v - t[i]!.v);
    expect(Math.min(...gapsPx), `adjacent labelled ticks (${t.map((x) => x.v).join(', ')}%) px apart`).toBeGreaterThanOrEqual(16);
    const top = t[t.length - 1]!.v;
    expect(peak - top, `highest labelled tick ${top}% vs data max ${peak}%: unlabelled stretch must be no taller than one tick step (${Math.max(...gapsVal)})`).toBeLessThanOrEqual(Math.max(...gapsVal));
  });
}
