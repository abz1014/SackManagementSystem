/**
 * A5 (Health "Data batches" Last seen / Status overprint) and A1 ("Pick dates"
 * inputs overlapping the top bar), 1 Oct 2026. Needs a session — see
 * `support/auth.ts`. Geometry only: rects must not intersect.
 */
import { test, expect, type Locator } from '@playwright/test';
import { signedInPage } from './support/auth';

const WIDTHS = [1280, 1024, 768] as const;
type R = { x: number; y: number; width: number; height: number };
const hit = (a: R, b: R) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
const rect = async (l: Locator): Promise<R> => (await l.boundingBox())!;
// Rect of the text actually painted inside a cell (so a cell whose text spills
// into its neighbour is caught, not just cell boxes that always tile).
const textRect = (l: Locator): Promise<R> =>
  l.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });

for (const width of WIDTHS) {
  test(`Health Data batches: Last seen and Status do not overprint at ${width}`, async ({ browser, baseURL }) => {
    const s = await signedInPage(browser, baseURL!);
    test.skip(s.page === null, (s as { reason: string }).reason ?? 'no session');
    if (s.page === null) return;
    const { page, context } = s;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?s=health');
      const rows = page.locator('table.epoch-tbl tbody tr');
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      const n = await rows.count();
      for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        const last = row.locator('td').nth(4);
        const status = row.locator('td').nth(5);
        expect(hit(await rect(last), await rect(status)), `row ${i} cells`).toBe(false);
        expect(hit(await textRect(last), await textRect(status)), `row ${i} Last seen text vs Status text`).toBe(false);
        // text of each cell must stay inside its own cell
        const lt = await textRect(last), lc = await rect(last);
        expect(lt.x + lt.width, `row ${i} Last seen text spills right`).toBeLessThanOrEqual(lc.x + lc.width + 0.5);
        const st = await textRect(status), sc = await rect(status);
        expect(st.x + st.width, `row ${i} Status text spills right`).toBeLessThanOrEqual(sc.x + sc.width + 0.5);
      }
    } finally {
      await context.close();
    }
  });

  test(`Top bar Pick dates: inputs inside bar, no overlap at ${width}`, async ({ browser, baseURL }) => {
    const s = await signedInPage(browser, baseURL!);
    test.skip(s.page === null, (s as { reason: string }).reason ?? 'no session');
    if (s.page === null) return;
    const { page, context } = s;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: /pick/i }).click();
      const bar = page.locator('.bar');
      const from = bar.getByLabel('From', { exact: true }), to = bar.getByLabel('To', { exact: true });
      await expect(from).toBeVisible();
      const b = await rect(bar);
      const inputs = [await rect(from), await rect(to)];
      for (const r of inputs) {
        expect(r.x, 'left in bar').toBeGreaterThanOrEqual(b.x - 0.5);
        expect(r.x + r.width, 'right in bar').toBeLessThanOrEqual(b.x + b.width + 0.5);
        expect(r.y, 'top in bar').toBeGreaterThanOrEqual(b.y - 0.5);
        expect(r.y + r.height, 'bottom in bar').toBeLessThanOrEqual(b.y + b.height + 0.5);
      }
      const others = bar.locator('.nav-link, .brand, .period button, .bar-right > *, .bar > .btn');
      const cnt = await others.count();
      for (let i = 0; i < cnt; i++) {
        const o = await rect(others.nth(i));
        for (const r of inputs) expect(hit(r, o), `date input vs bar control #${i}`).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally {
      await context.close();
    }
  });
}
