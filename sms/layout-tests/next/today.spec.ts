/**
 * Today, the period panel and the Wall on web-next.
 * Ports: css-015, css-022, css-048, s3-x2-period-seed, s3-x3-empty-after-newest, wall.
 */
import { expect, test, type Page } from '@playwright/test';
import { contrastOf, openApp, pageOverflow, PD1, settle } from './support/page';
import { recorded } from './support/mock';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}

test('css-015 a quiet station tile keeps readable ink, its dashed edge and its word (M-10)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [1920, 1.3]] as const) {
    await cell(page, `s=today${PD1}`, w, 900, scale);
    const tile = page.locator('.tile-nodata').first();
    if (!(await tile.count())) { bad.push(`${w}@${scale}: no quiet/no-data tile on the page`); continue; }
    const nameEl = tile.locator('.tile-name, [class*="name"]').first();
    const bigEl = tile.locator('.tile-big, [class*="big"]').first();
    const name = (await nameEl.count()) ? await contrastOf(nameEl) : 0;
    const big = (await bigEl.count()) ? await contrastOf(bigEl) : 0;
    const edge = await tile.evaluate((el) => getComputedStyle(el).borderTopStyle);
    const word = ((await tile.innerText()) ?? '').replace(/\s+/g, ' ').trim().match(/no data|quiet|not running|nothing/i)?.[0] ?? '';
    if (name < 4.5) bad.push(`${w}@${scale}: tile name ${name.toFixed(2)}:1`);
    if (big < 4.5) bad.push(`${w}@${scale}: tile count ${big.toFixed(2)}:1`);
    if (edge !== 'dashed') bad.push(`${w}@${scale}: edge is "${edge}", owner CSS-015 keeps a dashed edge`);
    if (!word) bad.push(`${w}@${scale}: no state word`);
  }
  expect(bad).toEqual([]);
});

const SKELETON_SCREENS: Array<{ name: string; qs: string; row: string }> = [
  { name: 'Today', qs: `s=today${PD1}`, row: '.today-kpis' },
  { name: 'Weight', qs: `s=quality&t=weight&wt=cone&wm=time${PD1}`, row: '.qw-kpis' },
  { name: 'Rejects', qs: `s=quality&t=rejects${PD1}`, row: '.qr-kpis' },
];
test('css-022 the first figures row keeps its height as data lands, skeleton to loaded (M-15)', async ({ page }) => {
  test.setTimeout(240_000);
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [375, 1], [1366, 1.3]] as const) {
    for (const s of SKELETON_SCREENS) {
      await cell(page, s.qs, w, w < 700 ? 812 : 800, scale, { delayMs: 1000, noSettle: true });
      try {
        await page.locator(s.row).first().waitFor({ state: 'attached', timeout: 6000 });
      } catch { bad.push(`${s.name} ${w}@${scale}: ${s.row} never drawn while loading`); continue; }
      const before = (await page.locator(s.row).first().boundingBox())?.height ?? 0;
      await settle(page, 12000);
      const after = (await page.locator(s.row).first().boundingBox())?.height ?? 0;
      if (Math.abs(after - before) > 4) bad.push(`${s.name} ${w}@${scale}: ${before.toFixed(0)} px as skeleton, ${after.toFixed(0)} px loaded`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-048 the KPI cards of a row start at the same height, linked or not (M-20)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [1366, 1.3]] as const) {
    for (const s of SKELETON_SCREENS.slice(0, 3)) {
      await cell(page, s.qs, w, 800, scale);
      const tops = await page.locator('.kpi').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top + window.scrollY));
      const rows: number[][] = [];
      for (const t of tops) { const r = rows.find((x) => Math.abs(x[0]! - t) < 40); if (r) r.push(t); else rows.push([t]); }
      for (const r of rows) {
        const spread = Math.max(...r) - Math.min(...r);
        if (r.length > 1 && spread > 0.5) bad.push(`${s.name} ${w}@${scale}: card tops ${r.map((x) => x.toFixed(1)).join(', ')} (spread ${spread.toFixed(1)})`);
      }
      if (tops.length < 3) bad.push(`${s.name} ${w}@${scale}: only ${tops.length} KPI cards found`);
    }
  }
  expect(bad).toEqual([]);
});

test('s3-x2-period-seed Pick dates opens on the period that is on screen, not on today', async ({ page }) => {
  const bad: string[] = [];
  for (const [from, to] of [['2026-09-01', '2026-09-01'], ['2026-08-10', '2026-08-20']]) {
    await cell(page, `s=today&p=pick&from=${from}&to=${to}`, 1366, 800);
    await page.locator('.pp-chip, button.pp-chip, [class*="pp-chip"]').filter({ visible: true }).first().click();
    await page.locator('.pp-pop').waitFor({ state: 'visible' });
    const fd = await page.locator('#pp-fd').inputValue();
    const td = await page.locator('#pp-td').inputValue();
    if (fd !== from || td !== to) bad.push(`period ${from}..${to}: the panel opened with ${fd}..${td}`);
  }
  expect(bad).toEqual([]);
});

/** Same shape, every number zero, every list empty. */
const emptied = (v: any): any =>
  Array.isArray(v) ? [] : typeof v === 'number' ? 0 : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'generation' || k === 'metadata' ? x : emptied(x)])) : v;

test('s3-x3-empty-after-newest an empty period after the newest reading says when the newest reading is', async ({ page }) => {
  const bad: string[] = [];
  const AFTER = '&p=pick&from=2026-09-20&to=2026-09-20';
  const empties: Record<string, unknown> = {};
  for (const path of ['/api/production', '/api/events', '/api/rejects', '/api/reject-spc', '/api/spc', '/api/weight-stations', '/api/station-status', '/api/rejects/by-day-code', '/api/sacks/summary', '/api/sacks/stock']) {
    empties[path] = (url: URL) => emptied(recorded(url));
  }
  const screens = [['Today', 's=today'], ['Weight', 's=quality&t=weight&wt=cone&wm=time'], ['Rejects', 's=quality&t=rejects'], ['Stations', 's=quality&t=stations'], ['Register', 's=quality&t=register&rl=cones']];
  for (const [name, qs] of screens) {
    await cell(page, qs + AFTER, 1366, 800, 1, { overrides: empties });
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/\b7 Sep/.test(text)) bad.push(`${name}: an empty period after the newest reading does not name the newest reading (7 Sep)`);
  }
  expect(bad).toEqual([]);
});

test('wall the TV wall fits, keeps its chips and is large-screen only (D9, D22)', async ({ page }) => {
  const bad: string[] = [];
  const unclipped = () => page.evaluate(() => {
    const out: string[] = [];
    for (const e of document.querySelectorAll('*')) {
      const cs = getComputedStyle(e);
      if (!(e as HTMLElement).offsetParent || e.children.length) continue;
      if (/(hidden|clip)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && (e.textContent ?? '').trim()) out.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 24)} "${(e.textContent ?? '').trim().slice(0, 20)}"`);
    }
    return out.slice(0, 6);
  });
  for (const [w, h, scale] of [[1920, 1080, 1], [1920, 1080, 1.3], [1366, 768, 1]] as const) {
    await cell(page, `s=today&wall=1${PD1}`, w, h, scale);
    const ov = await pageOverflow(page);
    const clipped = await unclipped();
    if (ov > 1) bad.push(`${w}@${scale}: overflow ${ov}px`);
    if (clipped.length) bad.push(`${w}@${scale}: clipped text ${clipped.join('; ')}`);
  }
  // type grows with the text size: the biggest heading at 1.3 is at least 1.25 times the one at 1
  const sizes: number[] = [];
  for (const scale of [1, 1.3]) {
    await cell(page, `s=today&wall=1${PD1}`, 1920, 1080, scale);
    sizes.push(await page.evaluate(() => Math.max(...[...document.querySelectorAll('*')].filter((e) => (e as HTMLElement).offsetParent && (e.textContent ?? '').trim()).map((e) => parseFloat(getComputedStyle(e).fontSize)))));
  }
  if (sizes[1]! < sizes[0]! * 1.25 - 0.05) bad.push(`type at 1.3 is ${sizes[1]} px vs ${sizes[0]} px at 1 (needs at least 1.25 times)`);
  await cell(page, `s=today&wall=1${PD1}`, 375, 812);
  const msg = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  if (!/designed for a large screen/i.test(msg)) bad.push('375: no "designed for a large screen" message');
  if ((await pageOverflow(page)) > 1) bad.push('375: overflow');
  expect(bad).toEqual([]);
});
