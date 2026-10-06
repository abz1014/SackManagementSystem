/**
 * CSS-074 (Phase 2 CSS defect loop, 5 Oct 2026).
 *
 * User impact: inside a sheet (here the station sheet, "Show the working"), a
 * keyboard-only reader can never Tab to the <summary> that opens a disclosure:
 * the sheet's focus trap wraps from the last button before it, so the working
 * behind a figure cannot be opened without a mouse.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts,
 * synthetic data only), the same approach as charts.spec.ts.
 *
 * Measures behaviour: press Tab up to 25 times inside the open sheet;
 * document.activeElement must be a <summary> at least once.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockStationSheet } from './support/mocks';

async function prime(page: Page) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockStationSheet(page);
  await page.goto('/?s=line&p=today&sheet=station:5');
  await page.locator('[role="dialog"] summary').first().waitFor({ state: 'attached', timeout: 15_000 });
  await page.waitForTimeout(250);
}

for (const width of [375, 1366]) {
  test(`Tab reaches a <summary> inside the sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prime(page);
    let reached = false;
    const trail: string[] = [];
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press('Tab');
      const d = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return { tag: a?.tagName ?? '', text: (a?.textContent ?? '').trim().slice(0, 30), inDialog: !!a?.closest('[role="dialog"]') };
      });
      trail.push(`${d.tag}:${d.text}`);
      if (d.tag === 'SUMMARY' && d.inDialog) reached = true;
    }
    expect(reached, `a <summary> in the sheet was never focused in 25 Tabs; order seen: ${trail.slice(0, 8).join(' | ')}`).toBe(true);
  });
}
