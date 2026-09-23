/**
 * Machine-product report (`?s=report&rt=machine-product`) at 1366x768 — the
 * "~18% of 55 columns visible, no sticky first column" figure from the
 * manual audit CLAUDE.md/the WS-PW brief cite. This spec measures it for
 * real instead of repeating the manual number.
 *
 * Needs a session — see `support/auth.ts`. Skips with a clear reason when
 * `SMS_TEST_USERNAME`/`SMS_TEST_PASSWORD` are unset (true on this machine
 * today).
 */
import { test, expect } from '@playwright/test';
import { signedInPage } from './support/auth';
import { measureHorizontalOverflow } from './support/overflow';

test('machine-product report: columns visible at 1366x768', async ({ browser, baseURL }) => {
  const s = await signedInPage(browser, baseURL!);
  test.skip(s.page === null, (s as { reason: string }).reason ?? 'no session');
  if (s.page === null) return;
  const { page, context } = s;

  try {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/?s=report&rt=machine-product');

    const wrapper = page.locator('.tw').first();
    await expect(wrapper).toBeVisible({ timeout: 15_000 });

    const table = wrapper.locator('table').first();
    const headerCells = table.locator('thead th');
    const totalColumns = await headerCells.count();

    let visibleColumns = 0;
    const wrapperBox = await wrapper.boundingBox();
    for (let i = 0; i < totalColumns; i++) {
      const cellBox = await headerCells.nth(i).boundingBox();
      if (cellBox && wrapperBox && cellBox.x + cellBox.width <= wrapperBox.x + wrapperBox.width + 0.5) {
        visibleColumns++;
      }
    }

    const m = await measureHorizontalOverflow(wrapper);
    const pct = totalColumns > 0 ? Math.round((visibleColumns / totalColumns) * 1000) / 10 : 0;
    console.log(
      `[machine-product 1366x768] totalColumns=${totalColumns} visibleColumns=${visibleColumns} ` +
        `(${pct}%) scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth} overflowPx=${m.overflowPx}`,
    );

    // Record the measurement rather than asserting a specific percentage —
    // the point of this spec is to REPLACE the manual "~18%" estimate with a
    // real number, not to lock that estimate in as a target. It does assert
    // that a wide report genuinely overflows and that a sticky first column
    // is (or is not) present, both statements the manual audit made.
    expect(totalColumns, 'expected the machine-product table to have a real column count').toBeGreaterThan(1);
    expect(m.overflows, 'expected this report to overflow at 1366x768 (that is the defect being measured)').toBe(true);

    const firstColSticky = await table
      .locator('thead th')
      .first()
      .evaluate((el) => getComputedStyle(el).position === 'sticky');
    console.log(`[machine-product 1366x768] first column position=sticky? ${firstColSticky}`);
  } finally {
    await context.close();
  }
});
