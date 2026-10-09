/**
 * CSS-015 (Phase 2 CSS recovery, owner decision 6 Oct 2026, option B). User impact: on Line, the name and count of a quiet
 * station tile (no cone for 20+ minutes) are drawn in the graphics-only grey (about 3.1:1 on white), so the one station a
 * supervisor most needs to read is the hardest to read. Owner chose: quiet text in the normal secondary grey, dashed border
 * and "quiet" tag kept. Runs without a session: every /api/* call is mocked (synthetic live payload with one quiet station).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine, LIVE } from './support/mocks';

function lum(c: [number, number, number]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function ratio(a: [number, number, number], b: [number, number, number]): number {
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

async function open(page: Page, w: number, scale: number) {
  await page.setViewportSize({ width: w, height: 900 });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* none */ } }, scale);
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  // Station 3 last produced 30 minutes before the newest reading; the rest are current.
  const live = JSON.parse(JSON.stringify(LIVE));
  live.data.lines[0].stations[2].lastTs = '2026-09-07T16:10:00Z';
  await page.route('**/api/live**', (route) => route.fulfill({ json: live }));
  await mockLine(page);
  await page.goto('/?s=line&p=pick&from=2026-09-07&to=2026-09-07');
  await page.locator('.st.quiet').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

for (const [w, scale] of [[1366, 1], [1920, 1.3]] as const) {
  test(`CSS-015 quiet tile name and count reach 4.5:1 at ${w}@${scale}, border and tag kept`, async ({ page }) => {
    await open(page, w, scale);
    const m = await page.evaluate(() => {
      const parse = (s: string): [number, number, number] => { const n = s.match(/[\d.]+/g)!.map(Number); return [n[0]!, n[1]!, n[2]!]; };
      const t = document.querySelector('.st.quiet') as HTMLElement;
      const bg = parse(getComputedStyle(document.body).backgroundColor);
      return {
        name: parse(getComputedStyle(t.querySelector('.st-name')!).color),
        val: parse(getComputedStyle(t.querySelector('.st-val')!).color),
        bg, border: getComputedStyle(t).borderTopStyle, tag: (t.querySelector('.st-tag') as HTMLElement).textContent?.trim() ?? '',
      };
    });
    expect(ratio(m.name, m.bg), 'quiet station name contrast').toBeGreaterThanOrEqual(4.5);
    expect(ratio(m.val, m.bg), 'quiet station count contrast').toBeGreaterThanOrEqual(4.5);
    expect(m.border).toBe('dashed');
    expect(m.tag.length, 'the quiet tag is still written').toBeGreaterThan(0);
  });
}
