/**
 * Register, Rejects lists, drilldown sheets, chips and table semantics on web-next.
 * Ports: css-008, 023, 024, 051, 052, 060, 060b, 062, 064, 065, 066, 074, 079, 080, a11y.tables.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp, pageOverflow, PD1 } from './support/page';
import { recorded } from './support/mock';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}
const H = (w: number) => (w < 700 ? 812 : 800);
const REASON = 'sheet=reason%3A2026-09-01%7Cquality%7C2%7C1';
const STATION = 'sheet=station%3A8';
const STOCK = 'rl=stock';

test('css-008 the by-day reason matrix scrolls inside its own box and never widens the page', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [320, 375, 440]) {
    await cell(page, `s=quality&t=rejects${PD1}`, w, H(w));
    const m = await page.evaluate(() => {
      const box = document.querySelector('.qr-heat__scroll') as HTMLElement | null;
      return { has: !!box, overflowX: box ? getComputedStyle(box).overflowX : '', tab: box?.getAttribute('tabindex') ?? null };
    });
    if (!m.has) bad.push(`${w}: no .qr-heat__scroll region`);
    else if (!/auto|scroll/.test(m.overflowX)) bad.push(`${w}: matrix region overflow-x is "${m.overflowX}"`);
    const o = await pageOverflow(page);
    if (o > 1) bad.push(`${w}: page overflow ${o}px`);
  }
  expect(bad).toEqual([]);
});

test('css-023 reason sheet rows are at most 70 px tall (M-16)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[768, 1], [1366, 1], [1366, 1.3]] as const) {
    await cell(page, `s=quality&t=rejects&${REASON}${PD1}`, w, H(w), scale);
    const hs = await page.locator('.ui-sheet__body .ui-dt__row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height).sort((a, b) => a - b));
    if (!hs.length) { bad.push(`${w}@${scale}: no rows in the sheet`); continue; }
    const median = hs[Math.floor(hs.length / 2)]!;
    if (median > 70) bad.push(`${w}@${scale}: median row ${median.toFixed(0)} px`);
  }
  expect(bad).toEqual([]);
});

test('css-024 reject reason names wrap to at most two lines and counts stay on one line (M-17)', async ({ page }) => {
  const bad: string[] = [];
  const longNames = (url: URL) => {
    const b = recorded(url);
    for (const r of b.data.reasons) { r.label = 'Tube ring mark long reason name'; r.displayLabel = r.label; }
    return b;
  };
  for (const [w, scale] of [[500, 1], [620, 1], [375, 1], [320, 1], [375, 1.3]] as const) {
    await cell(page, `s=quality&t=rejects${PD1}`, w, H(w), scale, { overrides: { '/api/rejects': longNames } });
    const rows = await page.evaluate(() => {
      const lines = (el: Element) => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4; return Math.round(el.getBoundingClientRect().height / lh); };
      return [...document.querySelectorAll('.qr-list__row')].map((r) => {
        const name = r.querySelector('.qr-list__name, .qr-list__pick') as HTMLElement | null;
        const num = r.querySelector('.qr-list__num') as HTMLElement | null;
        return name && num ? { n: (name.textContent ?? '').slice(0, 16), w: name.getBoundingClientRect().width, nl: lines(name), cl: lines(num) } : null;
      }).filter(Boolean) as Array<{ n: string; w: number; nl: number; cl: number }>;
    });
    if (!rows.length) { bad.push(`${w}@${scale}: no reason rows`); continue; }
    for (const r of rows) {
      const limit = w >= 500 ? 2 : scale > 1 ? 4 : 3; // policy: two lines from 500 px up, three on a phone, four at text size 1.3
      if (r.nl > limit) bad.push(`${w}@${scale}: "${r.n}" wraps to ${r.nl} lines (limit ${limit}) in ${Math.round(r.w)} px`);
      if (r.cl > 1) bad.push(`${w}@${scale}: count of "${r.n}" wraps`);
    }
    if (Math.min(...rows.map((r) => r.w)) < 90) bad.push(`${w}@${scale}: narrowest name column ${Math.min(...rows.map((r) => r.w)).toFixed(0)} px`);
  }
  expect(bad).toEqual([]);
});

test('css-051 the reason sheet fits its box at phone and desktop widths (M-16)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[375, 1], [1366, 1], [1366, 1.3]] as const) {
    await cell(page, `s=quality&t=rejects&${REASON}${PD1}`, w, H(w), scale);
    const m = await page.evaluate(() => {
      const body = document.querySelector('.ui-sheet__body') as HTMLElement;
      const wraps = [...document.querySelectorAll('.ui-sheet__body .ui-dt__wrap')] as HTMLElement[];
      return { sw: body.scrollWidth, cw: body.clientWidth, wraps: wraps.map((x) => x.scrollWidth - x.clientWidth) };
    });
    if (m.sw > m.cw + 1) bad.push(`${w}@${scale}: sheet body ${m.sw} > ${m.cw}`);
    if (await pageOverflow(page) > 1) bad.push(`${w}@${scale}: page overflow`);
  }
  expect(bad).toEqual([]);
});

test('css-052 every explanation column in the station sheet is at least 211 px wide (M-16)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[375, 1], [1366, 1], [1366, 1.3]] as const) {
    await cell(page, `s=quality&t=stations&${STATION}${PD1}`, w, H(w), scale);
    const m = await page.evaluate(() => {
      const body = document.querySelector('.ui-sheet__body') as HTMLElement;
      const dds = [...body.querySelectorAll('dd, td')].filter((e) => (e.textContent ?? '').trim().length > 40 && (e as HTMLElement).offsetParent).map((e) => e.getBoundingClientRect().width);
      return { sw: body.scrollWidth, cw: body.clientWidth, narrow: dds.filter((x) => x < 211).length, n: dds.length };
    });
    if (m.sw > m.cw + 1) bad.push(`${w}@${scale}: station sheet scrolls sideways (${m.sw} > ${m.cw})`);
    if (m.narrow) bad.push(`${w}@${scale}: ${m.narrow} of ${m.n} long-text cells narrower than 211 px`);
  }
  expect(bad).toEqual([]);
});

test('css-060 the sheet Close control is still reachable after scrolling a long sheet', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, h] of [[1366, 768], [375, 812]] as const) {
    await cell(page, `s=quality&t=stations&${STATION}${PD1}`, w, h);
    await page.locator('.ui-sheet__body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(150);
    const r = await page.locator('.ui-sheet__close').boundingBox();
    if (!r) { bad.push(`${w}: no Close control`); continue; }
    if (r.y < 0 || r.y + r.height > h) bad.push(`${w}: Close at ${Math.round(r.y)}..${Math.round(r.y + r.height)} of ${h} after scrolling`);
    const hit = await page.evaluate(() => { const b = document.querySelector('.ui-sheet__close')!.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e?.closest('.ui-sheet__close'); });
    if (!hit) bad.push(`${w}: Close is covered after scrolling`);
  }
  expect(bad).toEqual([]);
});

test('css-060b keyboard focus never sits under the sheet head (M-21)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, h] of [[1366, 768], [375, 812]] as const) {
    await cell(page, `s=quality&t=stations&${STATION}${PD1}`, w, h);
    await page.locator('.ui-sheet__close').focus();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab');
      const m = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        const head = document.querySelector('.ui-sheet__head')?.getBoundingClientRect();
        if (!a || !head || !a.closest('.ui-sheet__body')) return null;
        const r = a.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, headBottom: head.bottom, text: (a.textContent ?? '').trim().slice(0, 16) };
      });
      if (m && m.top < m.headBottom - 0.5 && m.bottom > 0) bad.push(`${w}: "${m.text}" focused at top ${Math.round(m.top)} under the head (${Math.round(m.headBottom)})`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-074 the disclosure summary in a sheet is reachable by Tab (M-21)', async ({ page }) => {
  const bad: string[] = [];
  for (const qs of [`s=quality&t=stations&${STATION}${PD1}`]) {
    await cell(page, qs, 1366, 768);
    if (!(await page.locator('.ui-sheet__body summary').count())) { bad.push(`${qs.slice(0, 40)}: no summary in this sheet`); continue; }
    await page.locator('.ui-sheet__close').focus();
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.tagName === 'SUMMARY');
    }
    if (!reached) bad.push(`${qs.slice(0, 40)}: Tab never reached a <summary> in 25 presses`);
  }
  expect(bad).toEqual([]);
});

test('css-062 the focus ring of a clickable table row is not clipped by its scroll box', async ({ page }) => {
  const bad: string[] = [];
  for (const qs of [`s=quality&t=register&rl=cones${PD1}`, `s=quality&t=stations${PD1}`]) {
    await cell(page, qs, 1366, 800);
    await page.locator('.ui-dt__row').first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const m = await page.evaluate(() => {
      const row = document.activeElement as HTMLElement | null;
      if (!row?.classList.contains('ui-dt__row')) return { ok: false as const, why: `focus is on ${row?.tagName}.${String(row?.className).slice(0, 20)}` };
      const cs = getComputedStyle(row);
      const w = parseFloat(cs.outlineWidth), off = parseFloat(cs.outlineOffset) || 0;
      const rr = row.getBoundingClientRect();
      const wrap = row.closest('.ui-dt__wrap')!.getBoundingClientRect();
      const left = rr.left - (off > 0 ? off + w : 0), top = rr.top - (off > 0 ? off + w : 0);
      return { ok: true as const, hasRing: cs.outlineStyle !== 'none' && w > 0, ringLeft: left, wrapLeft: wrap.left, ringTop: top, wrapTop: wrap.top };
    });
    if (!m.ok) { bad.push(`${qs.slice(0, 40)}: ${m.why}`); continue; }
    if (!m.hasRing) bad.push(`${qs.slice(0, 40)}: no outline ring on the focused row`);
    if (m.ringLeft < m.wrapLeft - 0.5) bad.push(`${qs.slice(0, 40)}: ring starts ${(m.wrapLeft - m.ringLeft).toFixed(1)} px outside the scroll box`);
  }
  expect(bad).toEqual([]);
});

test('css-064 the Day cell of the sack stock ledger stays on one line (M-27)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[768, 1], [1366, 1], [1920, 1.3]] as const) {
    await cell(page, `s=quality&t=register&${STOCK}${PD1}`, w, H(w), scale);
    const res = await page.evaluate(() => {
      const first = document.querySelector('.ui-dt__table tbody');
      if (!first) return null;
      const cells = [...first.querySelectorAll('tr')].map((tr) => tr.children[0] as HTMLElement).filter(Boolean);
      return cells.map((c) => { const g = document.createRange(); g.selectNodeContents(c); return { text: (c.textContent ?? '').trim().slice(0, 14), lines: new Set([...g.getClientRects()].map((r) => Math.round(r.top))).size }; });
    });
    if (!res || !res.length) { bad.push(`${w}@${scale}: no ledger rows`); continue; }
    const wrapped = res.filter((r) => r.lines > 1);
    if (wrapped.length) bad.push(`${w}@${scale}: ${wrapped.length} of ${res.length} Day cells wrap ("${wrapped[0]!.text}")`);
  }
  expect(bad).toEqual([]);
});

test('css-065 the closing column of the ledger in kg mode is inside its box, or scrolling is marked (M-27)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[768, 1], [1366, 1], [1920, 1]] as const) {
    await cell(page, `s=quality&t=register&${STOCK}${PD1}`, w, H(w), scale);
    const kg = page.locator('.ui-seg__opt', { hasText: /^kg$/i }).first();
    if (await kg.count()) await kg.click();
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.ui-dt__wrap') as HTMLElement | null;
      const table = wrap?.querySelector('table');
      if (!wrap || !table) return null;
      const ths = [...table.querySelectorAll('thead th')] as HTMLElement[];
      const last = ths[ths.length - 1]!.getBoundingClientRect();
      return { lastRight: last.right, wrapRight: wrap.getBoundingClientRect().right, scrolls: wrap.scrollWidth > wrap.clientWidth + 1, cue: !!wrap.parentElement?.querySelector('.ui-dt__fade, .ui-dt__cue') };
    });
    if (!m) { bad.push(`${w}: no ledger table`); continue; }
    if (m.lastRight > m.wrapRight + 1 && !m.cue) bad.push(`${w}: last column ends at ${Math.round(m.lastRight)} past the box (${Math.round(m.wrapRight)}) with no scroll cue`);
  }
  expect(bad).toEqual([]);
});

test('css-066 register listing rows are at most 45 px between 768 and 860 and a card list below (M-28)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [768, 800, 860]) {
    await cell(page, `s=quality&t=register&rl=cones${PD1}`, w, H(w));
    const hs = await page.locator('.ui-dt__row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    if (!hs.length) { bad.push(`${w}: no rows`); continue; }
    const tall = hs.filter((h) => h > 45.5).length;
    if (tall) bad.push(`${w}: ${tall} of ${hs.length} rows above 45 px (max ${Math.max(...hs).toFixed(0)})`);
  }
  await cell(page, `s=quality&t=register&rl=cones${PD1}`, 375, 812);
  if (!(await page.locator('.ui-dt--cards').count())) bad.push('375: not a card list');
  expect(bad).toEqual([]);
});

test('css-079 a filter chip with a long reason name keeps its row inside the phone width (M-26)', async ({ page }) => {
  const bad: string[] = [];
  const longName = (url: URL) => { const b = recorded(url); for (const r of b.data.reasons) { r.label = 'Tube ring mark with a very long descriptive reason name for the chip'; r.displayLabel = r.label; } return b; };
  for (const w of [320, 375]) {
    await cell(page, `s=quality&t=rejects&jc=2-1${PD1}`, w, 812, 1, { overrides: { '/api/rejects': longName } });
    const chip = page.locator('.ui-chip').first();
    if (!(await chip.count())) { bad.push(`${w}: no chip drawn`); continue; }
    const r = await chip.boundingBox();
    if (r && r.x + r.width > w + 0.5) bad.push(`${w}: chip ends at ${Math.round(r.x + r.width)}`);
    const o = await pageOverflow(page);
    if (o > 1) bad.push(`${w}: page overflow ${o}px`);
  }
  expect(bad).toEqual([]);
});

test('css-080 the clear button of a chip shows a focus ring (M-26)', async ({ page }) => {
  const bad: string[] = [];
  await cell(page, `s=quality&t=rejects&jc=2-1${PD1}`, 1366, 800);
  const x = page.locator('.ui-chip__x').first();
  if (!(await x.count())) bad.push('no chip clear button on the page');
  else {
    await x.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const m = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      const chip = el.closest('.ui-chip') as HTMLElement | null;
      return { onX: el.classList.contains('ui-chip__x'), width: parseFloat(cs.outlineWidth), style: cs.outlineStyle, color: cs.outlineColor, shadow: cs.boxShadow, chipBg: chip ? getComputedStyle(chip).backgroundColor : '' };
    });
    if (!m.onX) bad.push('keyboard focus did not reach the clear button');
    if (!((m.style !== 'none' && m.width >= 1.5) || m.shadow !== 'none')) bad.push(`no ring: outline ${m.style} ${m.width}px, shadow ${m.shadow}`);
    if (m.style !== 'none' && m.color === m.chipBg) bad.push(`ring colour equals the chip background (${m.color})`);
  }
  expect(bad).toEqual([]);
});

test('a11y.tables every data table keeps real column headers (not hidden spans)', async ({ page }) => {
  const bad: string[] = [];
  const pages = [
    `s=today${PD1}`, `s=quality&t=stations${PD1}`, `s=quality&t=register&rl=cones${PD1}`, `s=quality&t=register&${STOCK}${PD1}`, 's=products&t=catalogue', 's=products&t=limits',
    `s=reports&rt=rejected-sacks${PD1}`, `s=reports&rt=daily${PD1}`, 's=system&t=diagnostics',
  ];
  for (const qs of pages) {
    await cell(page, qs, 1366, 800);
    const m = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('main thead th')].filter((t) => { const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !t.closest('details:not([open])'); });
      const blockified = ths.filter((t) => { const d = getComputedStyle(t).display; return d !== 'table-cell' && d !== 'none'; });
      return { n: ths.length, blockified: blockified.map((t) => (t.textContent ?? '').trim().slice(0, 14)) };
    });
    const roles = await page.getByRole('columnheader').count();
    if (m.n === 0) bad.push(`${qs.slice(0, 44)}: no table headers on the page`);
    else {
      if (m.blockified.length) bad.push(`${qs.slice(0, 44)}: headers lost their cell display (role): ${m.blockified.join(', ')}`);
      if (roles < Math.floor(m.n / 2)) bad.push(`${qs.slice(0, 44)}: ${m.n} th but only ${roles} columnheader roles`);
    }
  }
  expect(bad).toEqual([]);
});
