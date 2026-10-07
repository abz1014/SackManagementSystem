/**
 * CSS-077 (Phase 2 CSS defect loop, 5 Oct 2026). User impact: at the Wall
 * text size (UI scale 1.3) on a narrow screen, the y-axis tick labels of the
 * deviation charts are cut off by the screen edge, so "-0.10 kg" reads
 * "10 kg" and the sign (the whole point of the label) is lost.
 * Runs without a session: every /api/* call is mocked (mockSacks), synthetic data.
 */
import { test, expect } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockSacks } from './support/mocks';

for (const [width, scale] of [[375, '1.3'], [375, '1'], [320, '1.3'], [768, '1.3']] as const) {
  test(`Sacks @${width} scale ${scale}: every y-axis tick label is fully on screen`, async ({ page }) => {
    await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', s); } catch { /* ignore */ } }, scale);
    await page.setViewportSize({ width, height: 900 });
    await mockCatchAll(page);
    await mockAuth(page);
    await mockCommon(page);
    await mockSacks(page);
    await page.goto('/?s=sacks&p=today');
    await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const bad: string[] = [];
      let n = 0;
      for (const svg of Array.from(document.querySelectorAll('.chart-frame svg'))) {
        const sr = svg.getBoundingClientRect();
        for (const t of Array.from(svg.querySelectorAll('text'))) {
          if (t.getAttribute('text-anchor') !== 'end') continue;
          const r = t.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.left - sr.left > sr.width * 0.5) continue; // y-axis labels sit at the left
          n++;
          if (r.left < 0) bad.push(`"${(t.textContent ?? '').trim()}" left=${r.left.toFixed(1)} svgLeft=${sr.left.toFixed(1)}`);
        }
      }
      return { n, bad };
    });
    expect(res.n, 'y-axis tick labels were found').toBeGreaterThan(0);
    expect(res.bad, `y labels cut by the screen edge: ${res.bad.join('; ')}`).toEqual([]);
  });
}
