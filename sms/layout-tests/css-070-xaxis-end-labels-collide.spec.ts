/**
 * CSS-070 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: on a narrow
 * screen (or at the Wall text size on a phone) the two end dates of a chart's
 * time axis are drawn on top of each other ("Tue 22 SeTue 29 Sept") or run
 * together ("30 Aug7 Sept"), so neither date can be read.
 * Runs without a session: every /api/* call is mocked (mockRejects /
 * mockReport daily), synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, mockReport, mockWeight, spc, reportEnvelope, META } from './support/mocks';

const envelope = <T,>(data: T) => ({ data, metadata: META });

/** Eight days, 22-29 Sept: the two end labels are "Tue 22 Sept" and "Tue 29 Sept". */
function eightDays() {
  const buckets = Array.from({ length: 8 }, (_, i) => ({
    bucketTs: `2026-09-${String(22 + i).padStart(2, '0')}T00:00:00Z`,
    generation: 3, produced: 4000, inspected: 4100, rejects: 100,
    rate: (2 + (i % 4) * 0.5) / 100, ucl: 3.5 / 100, lcl: 0.5 / 100, outOfControl: false,
  }));
  return envelope({
    bucketSize: 'day', rejectTypeFilter: 'all', totalProduced: 32_000, totalRejects: 800, pBar: 0.025,
    spansGenerations: false, generations: [], outOfControlCount: 0, buckets, episodes: [],
  });
}

async function xLabelGaps(page: Page, ariaIncludes: string) {
  return page.evaluate((needle) => {
    const svg = Array.from(document.querySelectorAll('.chart-frame svg')).find((s) => (s.getAttribute('aria-label') ?? '').includes(needle));
    if (!svg) return { found: false } as const;
    const sr = svg.getBoundingClientRect();
    const all = Array.from(svg.querySelectorAll('text')).map((t) => ({ t, r: t.getBoundingClientRect() })).filter((o) => o.r.width > 0);
    const maxY = Math.max(...all.map((o) => (o.r.top + o.r.bottom) / 2));
    const row = all.filter((o) => Math.abs((o.r.top + o.r.bottom) / 2 - maxY) < 4 && !/%$/.test((o.t.textContent ?? '').trim())).sort((a, b) => a.r.left - b.r.left);
    const gaps = row.slice(1).map((o, i) => o.r.left - row[i]!.r.right);
    const outside = row.filter((o) => o.r.left < sr.left - 0.5 || o.r.right > sr.right + 0.5).map((o) => (o.t.textContent ?? '').trim());
    return { found: true, labels: row.map((o) => (o.t.textContent ?? '').trim()), gaps, outside } as const;
  }, ariaIncludes);
}

for (const [width, scale] of [[320, '1'], [353, '1'], [375, '1.3']] as const) {
  test(`Rejects trend @${width} scale ${scale}: x-axis labels do not overlap and stay inside the svg`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 700 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockRejects(page);
    await page.route('**/api/reject-spc**', (route) => route.fulfill({ json: eightDays() }));
    await page.goto('/?s=rejects&p=today');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    const res = await xLabelGaps(page, 'Reject rate');
    expect(res.found, 'the reject trend chart is drawn').toBe(true);
    if (!res.found) return;
    expect(res.labels.length, 'at least one x-axis label is shown').toBeGreaterThan(0);
    expect(Math.min(0, ...res.gaps), `gap between x labels ${JSON.stringify(res.labels)} (px)`).toBeGreaterThanOrEqual(0);
    expect(res.outside, 'x labels outside the svg').toEqual([]);
  });
}

for (const [width, scale] of [[375, '1'], [395, '1']] as const) {
  test(`Report daily @${width} scale ${scale}: end date labels are not run together`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 800 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockReport(page, 'daily');
    await page.route('**/api/reports/daily**', (route) => {
      const env = reportEnvelope('daily') as { data: { report: { byDay: Array<{ group: string }> } } };
      const base = env.data.report.byDay;
      const days = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
      env.data.report.byDay = days.map((d, i) => ({ ...base[i % base.length]!, group: d }));
      return route.fulfill({ json: env });
    });
    await page.goto('/?s=report&rt=daily&p=pick&from=2026-08-30&to=2026-09-07');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    const res = await xLabelGaps(page, '');
    expect(res.found, 'a chart is drawn').toBe(true);
    if (!res.found) return;
    expect(Math.min(6, ...res.gaps), `gap between x labels ${JSON.stringify(res.labels)} (px)`).toBeGreaterThanOrEqual(6);
  });
}

// Added in the recovery stage (R4, 7 Oct 2026): RV-W2-a found the same overprint
// on Weight's own cone time axis (320 wide at the Wall text size, -3.8 px).
test('Weight cone time axis @320 scale 1.3: x-axis labels do not overlap', async ({ page }) => {
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, '1.3');
  await page.setViewportSize({ width: 320, height: 800 });
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockWeight(page);
  // A multi-day period labels the ticks "5 Aug 12:30": spread the 40 subgroups over 5 Aug - 7 Sept.
  await page.route('**/api/spc**', (route) => {
    const env = spc('cone') as { data: { subgroups: Array<{ ts: string }> } };
    const t0 = Date.UTC(2026, 7, 5, 12, 30, 0);
    env.data.subgroups.forEach((g, i) => { g.ts = new Date(t0 + i * 20.9 * 3_600_000).toISOString(); });
    return route.fulfill({ json: env });
  });
  await page.goto('/?s=weight&wt=cone&wm=time&p=pick&from=2026-08-05&to=2026-09-07');
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('.chart-frame svg'));
    return svgs.map((svg) => {
      const all = Array.from(svg.querySelectorAll('text')).map((t) => ({ t, r: t.getBoundingClientRect() })).filter((o) => o.r.width > 0);
      if (all.length === 0) return null;
      const maxY = Math.max(...all.map((o) => (o.r.top + o.r.bottom) / 2));
      const row = all.filter((o) => Math.abs((o.r.top + o.r.bottom) / 2 - maxY) < 4).sort((a, b) => a.r.left - b.r.left);
      return { labels: row.map((o) => (o.t.textContent ?? '').trim()), gaps: row.slice(1).map((o, i) => o.r.left - row[i]!.r.right) };
    }).filter(Boolean) as Array<{ labels: string[]; gaps: number[] }>;
  });
  expect(res.length, 'a chart is drawn').toBeGreaterThan(0);
  for (const c of res) expect(Math.min(0, ...c.gaps), `gap between x labels ${JSON.stringify(c.labels)} (px)`).toBeGreaterThanOrEqual(0);
});
