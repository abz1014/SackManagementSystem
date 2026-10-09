/**
 * CSS-019 (Phase 2 CSS recovery, owner decision 6 Oct 2026, option A). User impact: the product-by-machine table is wider than
 * its box (15 columns, about 1,476px in 816px at 1366) and scrolls sideways inside it, but nothing says so, so a reader sees
 * machines 1 to 8 and has no sign that machines 9 to 14 exist. Owner chose: keep the sideways scroll and the pinned first
 * column, add a visible "scroll sideways" cue that names the machines out of view, only while the table is wider than its box.
 * Runs without a session: every /api/* call is mocked (./support/css-019.fixtures), synthetic data only.
 */
import { test, expect } from '@playwright/test';
import { primeMachineProductN } from './support/css-019.fixtures';

function lum(c: number[]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
}

for (const [w, h, scale] of [[1366, 768, 1], [1920, 1080, 1], [1366, 768, 1.3], [768, 1024, 1], [375, 812, 1]] as const) {
  test(`CSS-019 a wide matrix shows a cue naming the machines out of view at ${w}@${scale}`, async ({ page }) => {
    await primeMachineProductN(page, w, h, 14, scale);
    const truth = await page.evaluate(() => {
      const box = document.querySelector('.mp-scroll') as HTMLElement;
      const right = box.getBoundingClientRect().right;
      const ths = Array.from(box.querySelectorAll('thead th.click'));
      const hidden = ths.filter((t) => t.getBoundingClientRect().right > right + 0.5).map((t) => (t.childNodes[0]?.textContent ?? '').trim());
      return { wide: box.scrollWidth > box.clientWidth, hidden };
    });
    expect(truth.wide, 'the 14-machine matrix is wider than its box').toBe(true);
    expect(truth.hidden.length, 'some machines are out of view').toBeGreaterThan(0);
    const cue = page.locator('.mp-cue');
    await expect(cue, 'a scroll cue is visible').toBeVisible();
    const text = (await cue.textContent()) ?? '';
    expect(text, 'the cue names the first hidden machine').toContain(truth.hidden[0]!);
    expect(text, 'the cue names the last hidden machine').toContain(truth.hidden[truth.hidden.length - 1]!);
    const col = await cue.evaluate((el) => {
      const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      return { fg: parse(getComputedStyle(el).color), bg: parse(getComputedStyle(document.body).backgroundColor) };
    });
    const [a, b] = [lum(col.fg), lum(col.bg)];
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), 'cue text contrast').toBeGreaterThanOrEqual(4.5);
    await page.emulateMedia({ media: 'print' });
    await expect(cue, 'the cue is not printed').toBeHidden();
  });
}

test('CSS-019 a matrix that fits its box shows no cue at 1366', async ({ page }) => {
  await primeMachineProductN(page, 1366, 768, 3);
  const wide = await page.evaluate(() => { const b = document.querySelector('.mp-scroll') as HTMLElement; return b.scrollWidth > b.clientWidth; });
  expect(wide, 'the 3-machine matrix fits its box').toBe(false);
  await expect(page.locator('.mp-cue')).toHaveCount(0);
});
