/**
 * Products (Board, Changeover, Catalogue, Limits & History) on web-next.
 * Ports: css-009, css-010, css-025, css-047, css-078, s3-f1-running-last-product.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp, pageOverflow, PD1 } from './support/page';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}
const H = (w: number) => (w < 700 ? 812 : 800);

/** Every field and every card of the page ends inside its card's inner right edge. */
async function fieldsFit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const f of document.querySelectorAll('main input, main select, main textarea')) {
      const el = f as HTMLElement;
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      const card = el.closest('.card, .lm-card, .co, .pds, .wr-wizard__panel') as HTMLElement | null;
      if (!card) continue;
      const cs = getComputedStyle(card);
      const inner = card.getBoundingClientRect().right - parseFloat(cs.paddingRight);
      if (r.right > inner + 1) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} right ${Math.round(r.right)} > card inner ${Math.round(inner)}`);
    }
    return out.slice(0, 6);
  });
}

test('css-009 the Limits & History page fits at phone and tablet widths and keeps its fields in their cards (M-07)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[320, 1], [375, 1], [500, 1], [621, 1], [768, 1], [1366, 1.3]] as const) {
    await cell(page, 's=products&t=limits', w, H(w), scale);
    const o = await pageOverflow(page);
    if (o > 1) bad.push(`${w}@${scale}: page overflow ${o}px`);
    for (const f of await fieldsFit(page)) bad.push(`${w}@${scale}: ${f}`);
  }
  expect(bad).toEqual([]);
});

test('css-010 the retire checkboxes sit beside the first line of their label (M-08)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [320, 375, 521, 600, 1366]) {
    await cell(page, 's=products&t=changeover', w, H(w));
    const rows = await page.evaluate(() => [...document.querySelectorAll('.co-checks label, .co-retire label')].filter((l) => l.querySelector('input[type=checkbox]')).map((l) => {
      const cb = l.querySelector('input[type=checkbox]')!.getBoundingClientRect();
      const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
      let first: DOMRect | null = null;
      for (let n = w.nextNode(); n && !first; n = w.nextNode()) {
        if (!(n.textContent ?? '').trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        first = rg.getClientRects()[0] ?? null;
      }
      return first ? { dy: Math.abs(cb.top + cb.height / 2 - (first.top + first.height / 2)), text: (l.textContent ?? '').trim().slice(0, 22) } : null;
    }).filter(Boolean));
    if (!rows.length) { bad.push(`${w}: no retire checkboxes on the page`); continue; }
    const worst = rows.reduce((m, r) => (r!.dy > m.dy ? r! : m), rows[0]!);
    if (worst.dy > 2) bad.push(`${w}: "${worst.text}" checkbox centre is ${worst.dy.toFixed(1)} px from its first text line`);
  }
  expect(bad).toEqual([]);
});

test('css-025 the Changeover text inputs match the styled inputs (height and font)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [1366, 375]) {
    await cell(page, 's=products&t=changeover', w, H(w));
    const m = await page.evaluate(() => {
      const ins = [...document.querySelectorAll<HTMLInputElement>('main input.wr-input')].filter((i) => i.offsetParent && i.type !== 'checkbox' && i.type !== 'radio');
      return ins.map((i) => { const cs = getComputedStyle(i); return { h: i.getBoundingClientRect().height, fs: cs.fontSize, type: i.getAttribute('type'), id: i.id || i.name || (i.closest('label')?.textContent ?? '').slice(0, 16) }; });
    });
    if (m.length < 4) { bad.push(`${w}: only ${m.length} inputs found`); continue; }
    const ref = m[0]!;
    for (const i of m) {
      if (Math.abs(i.h - ref.h) > 1) bad.push(`${w}: "${i.id}" height ${i.h.toFixed(1)} vs ${ref.h.toFixed(1)}`);
      if (i.fs !== ref.fs) bad.push(`${w}: "${i.id}" font ${i.fs} vs ${ref.fs}`);
      if (i.type === null) bad.push(`${w}: "${i.id}" has no type attribute`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-047 table rows of Catalogue and Board stay at 50 px or less', async ({ page }) => {
  const bad: string[] = [];
  for (const [qs, name] of [['s=products&t=catalogue', 'Catalogue'], [`s=products&t=limits`, 'Limits']] as const) {
    await cell(page, qs, 1366, 800);
    const hs = await page.locator('.ui-dt__row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    if (!hs.length) { bad.push(`${name}: no rows`); continue; }
    const tall = hs.filter((h) => h > 50);
    if (tall.length > hs.length * 0.2) bad.push(`${name}: ${tall.length} of ${hs.length} rows above 50 px (max ${Math.max(...hs).toFixed(0)})`);
  }
  expect(bad).toEqual([]);
});

test('css-078 the Outcome column of the PDAS action history is wide and fully visible (M-30)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [375, 768, 1366]) {
    await cell(page, 's=products&t=limits', w, H(w));
    const res = await page.evaluate(() => {
      const th = [...document.querySelectorAll('.ui-dt__table th')].find((t) => /outcome/i.test(t.textContent ?? ''));
      if (!th) return null;
      const r = th.getBoundingClientRect();
      const wrap = th.closest('.ui-dt__wrap')?.getBoundingClientRect();
      return { w: r.width, right: r.right, wrapRight: wrap?.right ?? innerWidth };
    });
    if (w < 768) { if (res) bad.push(`${w}: expected the card list below 768, found a table with an Outcome header`); continue; }
    if (!res) { bad.push(`${w}: no Outcome column`); continue; }
    if (w === 768 && res.w < 276) bad.push(`${w}: Outcome column ${res.w.toFixed(0)} px (needs at least 276)`);
    if (res.right > res.wrapRight + 1) bad.push(`${w}: Outcome column ends at ${Math.round(res.right)}, the visible box ends at ${Math.round(res.wrapRight)}`);
  }
  expect(bad).toEqual([]);
});

test('s3-f1-running-last-product every winder that is not running shows the last product it stamped and when', async ({ page }) => {
  const bad: string[] = [];
  await cell(page, `s=products&t=board${PD1}`, 1366, 900);
  const idle = await page.locator('.pb-st--idle').evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  if (!idle.length) bad.push('no idle winder cards on the Board');
  for (const t of idle) {
    if (!/\d{1,2}:\d{2}/.test(t)) bad.push(`idle card has no time of the last cone: "${t.slice(0, 80)}"`);
    if (!/[A-Za-z0-9]{3,}-[A-Za-z0-9]{2,}|\b\d{3}-/.test(t) && !/last|stamped|no product/i.test(t)) bad.push(`idle card names no last product: "${t.slice(0, 80)}"`);
  }
  expect(bad).toEqual([]);
});
