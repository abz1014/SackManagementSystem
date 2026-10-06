/**
 * CSS-023 (Phase 2 CSS loop, 2 Oct 2026). User impact: reason-sheet rows are
 * ~147px tall (each cell wraps word by word), so the sheet shows a handful of
 * rejects per screen instead of a list. Runs without a session: mocked API,
 * synthetic rows only.
 */
import { test, expect } from '@playwright/test';
import { primeReasonSheet } from './support/css-051.fixtures';

test('reason sheet rows are at most two text lines tall at 1366@1', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await primeReasonSheet(page, 50);
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sheet tbody tr')] as HTMLElement[];
    const hs = rows.map((r) => r.getBoundingClientRect().height).sort((a, b) => a - b);
    const td = rows[0]!.querySelector('td') as HTMLElement;
    const cs = getComputedStyle(td);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 1;
    return { median: hs[Math.floor(hs.length / 2)]!, limit: 2 * lh + pad };
  });
  expect(m.median, `median row ${m.median}px vs two lines ${m.limit}px`).toBeLessThanOrEqual(m.limit + 0.5);
});
