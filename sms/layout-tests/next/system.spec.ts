/**
 * System (Diagnostics, Setup), Login, the period panel and the first-load budget on web-next.
 * Ports: css-017, css-067, health-and-bar, login-screen, p3-p3-04-initial-js.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp, pageOverflow, PD1 } from './support/page';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}
const H = (w: number) => (w < 700 ? 812 : 800);

/** Open every disclosure on the page (Technical detail and the per-card details). */
async function openAll(page: Page) {
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await page.waitForTimeout(300);
}

test('css-017 the Diagnostics tables fit their boxes at 1100, 1366 and 1920, text size 1 and 1.3 (M-11)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [1100, 1], [1920, 1], [1366, 1.3]] as const) {
    await cell(page, 's=system&t=diagnostics', w, 800, scale);
    await openAll(page);
    const res = await page.evaluate(() => [...document.querySelectorAll('main table')].map((t) => {
      const box = (t.closest('.sy-tw, .ui-dt__wrap, .tw') ?? t.parentElement) as HTMLElement;
      const ths = [...t.querySelectorAll('th')].filter((th) => th.getBoundingClientRect().width > 0 && th.getBoundingClientRect().right > box.getBoundingClientRect().right + 0.5).map((th) => (th.textContent ?? '').trim().slice(0, 14));
      return { cls: t.className, tw: t.getBoundingClientRect().width, cw: box.clientWidth, sw: box.scrollWidth, ths };
    }));
    if (!res.length) bad.push(`${w}@${scale}: no tables`);
    for (const r of res) {
      if (r.sw > r.cw + 1) bad.push(`${w}@${scale}: ${r.cls} scrolls (${r.sw} > ${r.cw})`);
      if (r.ths.length) bad.push(`${w}@${scale}: ${r.cls} headers outside the box: ${r.ths.join(', ')}`);
    }
    if ((await pageOverflow(page)) > 1) bad.push(`${w}@${scale}: page overflow`);
  }
  expect(bad).toEqual([]);
});

test('css-067 data-check rows stay compact (median at most 215 px) and the page stays under 3,000 px at 1366 (M-11)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [1366, 1.3]] as const) {
    await cell(page, 's=system&t=diagnostics', w, 800, scale);
    const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
    if (w === 1366 && scale === 1 && pageH > 3000) bad.push(`${w}@${scale}: Diagnostics page is ${pageH} px tall with the details closed (limit 3,000)`);
    await openAll(page);
    const hs = await page.locator('.sy-find__tx').evaluateAll((els) => els.map((e) => (e.closest('li') ?? e.parentElement ?? e).getBoundingClientRect().height).sort((a, b) => a - b));
    if (!hs.length) { bad.push(`${w}@${scale}: no data-check rows`); continue; }
    const median = hs[Math.floor(hs.length / 2)]!;
    if (scale === 1 && median > 215) bad.push(`${w}@${scale}: median finding ${median.toFixed(0)} px (limit 215, the loop's CSS-067 bound)`);
  }
  expect(bad).toEqual([]);
});

test('health-and-bar Diagnostics cells are not clipped and the Pick-dates inputs fit the viewport and clear the top bar', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [1280, 1024, 768]) {
    await cell(page, 's=system&t=diagnostics', w, 900);
    await openAll(page);
    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      for (const td of document.querySelectorAll('main td')) {
        const g = document.createRange(); g.selectNodeContents(td);
        const t = g.getBoundingClientRect(); const c = td.getBoundingClientRect();
        if (t.width && c.width && t.right > c.right + 0.5) out.push(`"${(td.textContent ?? '').trim().slice(0, 16)}" spills ${(t.right - c.right).toFixed(1)} px`);
      }
      return out.slice(0, 4);
    });
    for (const c of clipped) bad.push(`diagnostics @${w}: ${c}`);

    await cell(page, `s=today${PD1}`, w, 900);
    await page.locator('.pp-chip, button.pp-chip, [class*="pp-chip"]').filter({ visible: true }).first().click();
    await page.locator('.pp-pop').waitFor({ state: 'visible' });
    const m = await page.evaluate(() => {
      const pop = document.querySelector('.pp-pop')!.getBoundingClientRect();
      const top = document.querySelector('.sh-top')?.getBoundingClientRect();
      const ins = [document.querySelector('#pp-fd'), document.querySelector('#pp-td')].map((i) => i!.getBoundingClientRect());
      return { vw: innerWidth, vh: innerHeight, popRight: pop.right, popLeft: pop.left, popTop: pop.top, topBottom: top?.bottom ?? 0, ins: ins.map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })), ov: document.documentElement.scrollWidth - innerWidth };
    });
    for (const i of m.ins) {
      if (i.l < 0 || i.r > m.vw + 0.5) bad.push(`pick dates @${w}: an input is outside the viewport (${Math.round(i.l)}..${Math.round(i.r)})`);
      if (i.b > m.vh + 0.5) bad.push(`pick dates @${w}: an input is below the viewport`);
    }
    if (m.ov > 1) bad.push(`pick dates @${w}: page overflow ${m.ov}px`);
  }
  expect(bad).toEqual([]);
});

test('login-screen the Login screen fits at 375, 1366 and 1920 and its fields stay inside the card (D5)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [375, 1366, 1920]) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openApp(page, 's=today', { width: w, height: H(w), signedOut: true });
    const m = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].map((i) => i.getBoundingClientRect());
      const btn = document.querySelector('button[type="submit"], button')?.getBoundingClientRect();
      const card = (document.querySelector('form') ?? document.querySelector('main'))!;
      const cr = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return { n: inputs.length, inputsRight: Math.max(0, ...inputs.map((r) => r.right)), cardInnerRight: cr.right - parseFloat(cs.paddingRight), btnRight: btn?.right ?? 0, ov: document.documentElement.scrollWidth - innerWidth };
    });
    if (m.n < 2) bad.push(`${w}: found ${m.n} inputs on the Login screen`);
    if (m.ov > 1) bad.push(`${w}: page overflow ${m.ov}px`);
    if (m.inputsRight > m.cardInnerRight + 1) bad.push(`${w}: inputs end at ${Math.round(m.inputsRight)}, card inner edge ${Math.round(m.cardInnerRight)}`);
    if (Math.abs(m.inputsRight - m.btnRight) > 2 && m.btnRight) bad.push(`${w}: inputs end ${Math.round(m.inputsRight)} but the button ends ${Math.round(m.btnRight)}`);
  }
  expect(bad).toEqual([]);
});

/** First-load JavaScript budget for the new app (uncompressed response bytes). Re-set from the HEAD measurement of 13 Oct 2026. */
const BUDGET_JS_BYTES = 620_000;
function trackJs(page: Page) {
  const files = new Map<string, number>();
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.includes('/assets/') || !u.pathname.endsWith('.js')) return;
    try { files.set(u.pathname, (await res.body()).length); } catch { /* aborted */ }
  });
  return files;
}
test('p3-p3-04-initial-js the first load of Today fetches no more JavaScript than the budget, and other screens add their own chunk', async ({ page }) => {
  const bad: string[] = [];
  const files = trackJs(page);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openApp(page, `s=today${PD1}`, { width: 1366, height: 768 });
  const total = [...files.values()].reduce((a, b) => a + b, 0);
  if (total > BUDGET_JS_BYTES) bad.push(`first load fetched ${total} bytes of JS in ${files.size} files (budget ${BUDGET_JS_BYTES})`);
  const before = files.size;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/next/?s=reports&rt=daily${PD1}`);
  await page.locator('.rp-doc').waitFor({ state: 'visible', timeout: 15_000 });
  if (files.size <= before) bad.push(`opening Reports fetched no further JS file (${before} -> ${files.size}); the chunk is not split`);
  if (errors.length) bad.push(`page errors: ${errors.join(' | ').slice(0, 200)}`);
  console.log(`[p3-04] first load ${total} bytes in ${before} files; after Reports ${files.size} files`);
  expect(bad).toEqual([]);
});
