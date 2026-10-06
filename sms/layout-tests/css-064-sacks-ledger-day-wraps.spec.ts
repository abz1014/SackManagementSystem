/**
 * CSS-064 (Phase 2 CSS defect loop, 6 Oct 2026). User impact: in the Sacks
 * stock ledger the Day cell ("Wednesday, 5 August 2026") wraps onto two lines
 * on almost every row, so a 34-day ledger is ~870 px longer than it needs to be
 * and the eye has to read two-line rows.
 * Runs without a session: every /api/* call is mocked (mockAuth + mockSacks),
 * with a synthetic 34-day stock fixture overriding the stock route.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockSacks, META } from './support/mocks';

function stock34() {
  const flow = (s: number) => ({ sacks: s, kg: s * 25 });
  const days = Array.from({ length: 34 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 7, 5 + i)).toISOString().slice(0, 10);
    return {
      day: d, opening: flow(200 + i * 50), openingEntries: flow(i === 0 ? 40 : 0), receipts: flow(i % 5 === 0 ? 300 : 0), weighed: flow(120),
      issues: flow(50), consumption: flow(0), adjustments: flow(0), closing: flow(270 + i * 50), movements: 2,
    };
  });
  return {
    data: {
      from: '2026-08-05', to: '2026-09-07', product: null, basis: 'line', machineLevel: { enabled: false, reason: 'n/a' },
      dayBasis: 'production_day', sackTimeIsInsertTime: true, receiptMeaning: 'note', weightBasis: 'gross', tareKg: 0,
      opening: flow(200), closing: flow(1920),
      totals: { openingEntries: flow(0), receipts: flow(0), weighed: flow(4080), issues: flow(1700), consumption: flow(0), adjustments: flow(0) },
      days, byMaterial: [], kgMissing: 0, countedSinceDay: '2026-08-05', manualMovementRows: 0,
    },
    metadata: META,
  };
}

async function prime(page: Page, width: number, scale = 1) {
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* none */ } }, scale);
  await page.setViewportSize({ width, height: 768 });
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockSacks(page);
  await page.route('**/api/sacks/stock**', (route) => route.fulfill({ json: stock34() }));
  await page.goto('/?s=sacks&p=pick&from=2026-08-05&to=2026-09-07');
  await page.locator('tr.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const width of [1366, 1920]) {
  test(`Sacks stock ledger @${width}: every Day cell is one line and the page does not scroll sideways`, async ({ page }) => {
    await prime(page, width);
    const res = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('tr.click > td:first-child')) as HTMLElement[];
      const cs0 = getComputedStyle(cells[0]);
      const lh = parseFloat(cs0.lineHeight) || 20;
      const tall = cells.filter((c) => {
        const cs = getComputedStyle(c);
        return c.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) > lh * 1.5;
      });
      const root = document.documentElement;
      const tw = cells[0].closest('.tw') as HTMLElement;
      return { n: cells.length, wrapped: tall.length, scroll: root.scrollWidth - root.clientWidth, inner: tw.scrollWidth - tw.clientWidth };
    });
    expect(res.n, 'ledger rows rendered').toBe(34);
    expect(res.wrapped, `Day cells wrapped onto 2+ lines (of ${res.n})`).toBe(0);
    expect(res.inner, 'ledger table wider than its own box (px): the Closing column would need a sideways scroll').toBeLessThanOrEqual(1);
    expect(res.scroll, 'page-level horizontal scroll (px)').toBeLessThanOrEqual(0);
  });
}
