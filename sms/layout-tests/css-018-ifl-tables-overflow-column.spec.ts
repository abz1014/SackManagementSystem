/**
 * CSS-018 (Phase 2 CSS defect loop, 6 Oct 2026; reworked in the recovery stage, 8 Oct 2026). User impact: IFL's report tables
 * (sack weight summary / range, rejected sacks, rejected unknown lifter, rejected cones / hangers, SPS packing) are wider than
 * the 816px content column, so right-hand columns sit behind an unmarked sideways scroll of their box. The first fix also moved
 * five other report types (daily, cone weight, management summary, product, station) that had no measured defect; those must
 * keep their hanging-label composition. Runs without a session: every /api/* call is mocked (mockReport), synthetic fixtures only.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, type ReportKind } from './support/mocks';

const KINDS: ReportKind[] = ['sack-weight-summary', 'sack-weight-range', 'rejected-sacks', 'rejected-unknown-lifter'];
// cone-weight is the unlisted type whose table sits in a labelled block (daily / station are chart or tw-span blocks and are covered by the pixel probes).
const UNLISTED: ReportKind[] = ['cone-weight'];

for (const kind of KINDS) {
  test(`${kind} @1366x768: every IFL table fits its container`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
    await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
    await page.locator('table.ifl-table').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => Array.from(document.querySelectorAll('table.ifl-table')).map((t) => {
      let box: HTMLElement | null = t.parentElement;
      while (box && box !== document.body && !['auto', 'scroll', 'hidden'].includes(getComputedStyle(box).overflowX)) box = box.parentElement;
      return { tableW: (t as HTMLElement).getBoundingClientRect().width, cw: box ? box.clientWidth : -1, sw: box ? box.scrollWidth : -1 };
    }));
    expect(res.length, 'IFL tables rendered').toBeGreaterThan(0);
    for (const r of res) expect(r.sw, `${kind}: table ${Math.round(r.tableW)}px in a ${r.cw}px box (scrollWidth ${r.sw})`).toBeLessThanOrEqual(r.cw + 1);
  });
}

// The recovery-stage rework: the rule must not reach the report types that never overflowed.
for (const kind of UNLISTED) {
  test(`${kind} @1366x768: the table keeps its place beside the hanging label`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockCatchAll(page); await mockAuth(page); await mockCommon(page); await mockReport(page, kind);
    await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
    await page.locator('table.ifl-table').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const t = document.querySelector('table.ifl-table') as HTMLElement;
      const block = t.closest('.block') as HTMLElement;
      return { gap: t.getBoundingClientRect().left - block.getBoundingClientRect().left };
    });
    expect(res.gap, `${kind}: the table starts ${Math.round(res.gap)}px from the block edge (the 180px label column is gone)`).toBeGreaterThan(150);
  });
}
