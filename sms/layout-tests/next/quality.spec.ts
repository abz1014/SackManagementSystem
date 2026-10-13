/**
 * Quality charts and tables on web-next (Weight, Rejects, Stations) and the shared chart kit.
 * Ports: css-003, 004, 029, 032, 038, 049, 050, 053, 053b, 068, 069, 070, 071, 076, 077, s3-x1, charts,
 * plus the M-18 axis-title check (D8) and the date-format check (D15).
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp, overprintPairs, pageOverflow, PD1, PL, settle } from './support/page';
import { recorded } from './support/mock';
import { textOutsideSvg, titleTickIntersections, xLabelCollisions } from './support/chart';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}
const H = (w: number) => (w < 700 ? 812 : 800);
const CHART_SCREENS = [
  ['Today', `s=today${PD1}`], ['Weight over time', `s=quality&t=weight&wt=cone&wm=time${PD1}`], ['Weight distribution', `s=quality&t=weight&wt=cone&wm=dist${PD1}`],
  ['Rejects', `s=quality&t=rejects${PD1}`],
] as const;

test('css-003 bar and pareto charts keep bars visible and every label inside the svg at phone widths (M-03)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [320, 375, 500, 600]) {
    for (const [name, qs] of CHART_SCREENS) {
      await cell(page, qs, w, H(w));
      const out = await textOutsideSvg(page);
      for (const o of out) bad.push(`${name} @${w}: ${o.chart}: ${o.what}`);
      const bars = await page.evaluate(() => [...document.querySelectorAll('.ck-svg .ck-bar')].map((b) => b.getBoundingClientRect().width));
      if (bars.length && Math.max(...bars) < 2) bad.push(`${name} @${w}: the widest bar is ${Math.max(...bars).toFixed(1)} px`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-004 table headers do not overprint or run out of their cells (M-04): Stations and the calibration report', async ({ page }) => {
  const bad: string[] = [];
  const headerFits = () => page.evaluate(() => {
    const out: string[] = [];
    for (const th of document.querySelectorAll('.qs-table thead th, .qs-table thead td')) {
      if (!(th as HTMLElement).offsetParent) continue;
      const w = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
      let left = Infinity, right = -Infinity;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!(n.textContent ?? '').trim() || (n as Text).parentElement?.closest('.ui-sr, .sr-only')) continue;
        const g = document.createRange(); g.selectNodeContents(n);
        for (const q of g.getClientRects()) if (q.width > 0) { left = Math.min(left, q.left); right = Math.max(right, q.right); }
      }
      const t = { width: right - left, right, left };
      const c = th.getBoundingClientRect();
      if (t.width > 0 && (t.right > c.right + 0.5 || t.left < c.left - 0.5)) out.push(`"${(th.textContent ?? '').trim().slice(0, 24)}" text ${Math.round(t.width)} px in a ${Math.round(c.width)} px cell`);
    }
    return out;
  });
  for (const [w, scale] of [[375, 1], [860, 1], [1366, 1.3]] as const) {
    await cell(page, `s=quality&t=stations${PD1}`, w, H(w), scale);
    for (const m of await headerFits()) bad.push(`Stations ${w}@${scale}: header ${m}`);
    const head = page.locator('.qs-table thead').first();
    if (await head.count()) for (const p of await overprintPairs(head)) bad.push(`Stations ${w}@${scale}: header overprint ${p}`);
    await cell(page, `s=reports&rt=calibration${PL}`, w, H(w), scale);
    const worst = await page.evaluate(() => {
      const t = document.querySelector('.rp-doc table.calib-tbl, .rp-doc .calib-tbl');
      if (!t) return { none: true, gap: 0, where: '' };
      let gap = Infinity, where = '';
      for (const tr of t.querySelectorAll('tr')) {
        const cells = [...tr.children] as HTMLElement[];
        const rects = cells.map((c) => { const g = document.createRange(); g.selectNodeContents(c); return [...g.getClientRects()].filter((r) => r.width > 0 && r.height > 0); });
        for (let i = 0; i + 1 < cells.length; i++) for (const a of rects[i]!) for (const b of rects[i + 1]!) {
          if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 3) continue;
          if (b.left - a.right < gap) { gap = b.left - a.right; where = `"${(cells[i]!.textContent ?? '').trim().slice(0, 12)}" | "${(cells[i + 1]!.textContent ?? '').trim().slice(0, 12)}"`; }
        }
      }
      return { none: false, gap, where };
    });
    if (worst.none) bad.push(`Calibration ${w}@${scale}: table.calib-tbl not found`);
    else if (worst.gap < 0) bad.push(`Calibration ${w}@${scale}: cells overprint by ${(-worst.gap).toFixed(1)} px at ${worst.where}`);
  }
  expect(bad).toEqual([]);
});

test('css-029 the y axis of the failed-inspection trend has labelled ticks at least 20 px apart (M-18)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [1366, 375]) {
    await cell(page, `s=quality&t=rejects${PD1}`, w, H(w));
    const gaps = await page.evaluate(() => {
      const out: Array<{ chart: string; ys: number[] }> = [];
      for (const f of document.querySelectorAll('.ck-frame')) {
        const title = (f.querySelector('.ck-title')?.textContent ?? '').trim();
        for (const axis of f.querySelectorAll('.ck-yaxis')) {
          const ys = [...axis.querySelectorAll('.ck-tick')].map((t) => { const r = t.getBoundingClientRect(); return (r.top + r.bottom) / 2; }).sort((a, b) => a - b);
          out.push({ chart: title, ys });
        }
      }
      return out;
    });
    if (!gaps.length) bad.push(`${w}: no chart frames`);
    for (const g of gaps) {
      if (g.ys.length < 2) continue;
      const min = Math.min(...g.ys.slice(1).map((y, i) => y - g.ys[i]!));
      if (min < 20) bad.push(`${w}: "${g.chart}" y ticks ${min.toFixed(1)} px apart`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-032 first and last category labels sit on their bars and inside the chart (M-18)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [375, 1], [375, 1.3]] as const) {
    await cell(page, `s=today${PD1}`, w, H(w), scale);
    const res = await page.evaluate(() => {
      const out: string[] = [];
      for (const svg of document.querySelectorAll('.ck-svg')) {
        const bars = [...svg.querySelectorAll('.ck-bar')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0);
        const labels = [...svg.querySelectorAll('.ck-xlabels text')].map((t) => ({ t: (t.textContent ?? '').trim(), r: t.getBoundingClientRect() })).filter((l) => l.r.width > 0);
        if (!bars.length || !labels.length) continue;
        const sr = svg.getBoundingClientRect();
        for (const l of [labels[0]!, labels[labels.length - 1]!]) {
          const cx = (l.r.left + l.r.right) / 2;
          const nearest = bars.reduce((m, b) => (Math.abs((b.left + b.right) / 2 - cx) < Math.abs((m.left + m.right) / 2 - cx) ? b : m));
          const dx = Math.abs((nearest.left + nearest.right) / 2 - cx);
          if (dx > 4 && labels.length === bars.length) out.push(`"${l.t}" centre is ${dx.toFixed(1)} px off its bar`);
          if (l.r.left < sr.left - 0.5 || l.r.right > sr.right + 0.5) out.push(`"${l.t}" hangs outside the chart`);
        }
      }
      return out;
    });
    for (const r of res) bad.push(`${w}@${scale}: ${r}`);
  }
  expect(bad).toEqual([]);
});

const CHART_PAGES: Array<[string, string]> = [
  ['Weight over time', `s=quality&t=weight&wt=cone&wm=time${PL}`], ['Rejects trend', `s=quality&t=rejects${PL}`], ['Today shift chart', `s=today${PL}`],
];
test('css-038 a keyboard-pinned chart tooltip is gone once focus leaves the chart (M-23)', async ({ page }) => {
  const bad: string[] = [];
  for (const [name, qs] of CHART_PAGES) {
    await cell(page, qs, 1366, 800);
    const body = page.locator('.chart-frame-body').first();
    if (!(await body.count())) { bad.push(`${name}: no chart body`); continue; }
    await body.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    if ((await page.locator('.chart-tip').count()) < 1) { bad.push(`${name}: the arrow key did not show a tooltip`); continue; }
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const after = await page.locator('.chart-tip').count();
    if (after !== 0) bad.push(`${name}: ${after} tooltip(s) still shown after Tab moved focus off the chart`);
    await body.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    if ((await page.locator('.chart-tip').count()) !== 0) bad.push(`${name}: Escape did not clear the tooltip`);
  }
  expect(bad).toEqual([]);
});

/** Click the chart at 30 % of its width until the address changes to a zoomed range. Returns the index clicked, or -1. */
async function zoomByClick(page: Page): Promise<number> {
  const frames = page.locator('.chart-frame-body');
  const n = await frames.count();
  const before = page.url();
  for (let i = 0; i < n; i++) {
    const body = frames.nth(i);
    await body.scrollIntoViewIfNeeded();
    const box = await body.boundingBox();
    if (!box) continue;
    await body.click({ position: { x: box.width * 0.3, y: box.height / 2 } });
    await page.waitForTimeout(500);
    if (page.url() !== before) return i;
  }
  return -1;
}
async function backChecks(page: Page, label: string, bad: string[], restoreFrom?: string) {
  const back = page.locator('main').getByRole('button', { name: /zoomed in/i });
  if ((await back.count()) !== 1) { bad.push(`${label}: ${await back.count()} "Zoomed in - Back" controls beside the chart (need 1)`); return; }
  const r = await back.evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, right: b.right, vh: innerHeight, vw: innerWidth }; });
  if (r.top < 0 || r.bottom > r.vh || r.right > r.vw) bad.push(`${label}: Back control outside the viewport (${Math.round(r.top)}..${Math.round(r.bottom)} of ${r.vh})`);
  await back.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  if (restoreFrom && new URL(page.url()).searchParams.get('from') !== restoreFrom) bad.push(`${label}: Back did not restore the period (from=${new URL(page.url()).searchParams.get('from')})`);
  if ((await page.locator('main').getByRole('button', { name: /zoomed in/i }).count()) !== 0) bad.push(`${label}: the control is still there after Back`);
}
test('css-053 after a click-zoom a Back control is in view beside the chart and restores the period (M-23)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, h, scale] of [[1366, 768, 1], [768, 1024, 1], [1920, 1080, 1], [1366, 768, 1.3]] as const) {
    for (const [name, qs] of CHART_PAGES.slice(0, 2)) {
      await cell(page, qs, w, h, scale);
      const idx = await zoomByClick(page);
      if (idx < 0) { if (name === 'Weight over time') bad.push(`${name} ${w}@${scale}: no chart zoomed on click`); continue; }
      if (new URL(page.url()).searchParams.get('p') !== 'range') { bad.push(`${name} ${w}@${scale}: the click did not set p=range`); continue; }
      await backChecks(page, `${name} ${w}@${scale}`, bad, '2026-08-05');
    }
  }
  expect(bad).toEqual([]);
});

test('css-053b the Back control shows beside the chart when the page redraws after a zoom (M-23, Today)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, h] of [[1366, 768], [375, 812]] as const) {
    await cell(page, `s=today${PL}`, w, h);
    const idx = await zoomByClick(page);
    if (idx < 0) { bad.push(`Today ${w}: no chart zoomed on click`); continue; }
    await backChecks(page, `Today ${w}`, bad, '2026-08-05');
  }
  expect(bad).toEqual([]);
});

test('css-049 mixed-product station rows keep their words apart (M-22, S3 X-1)', async ({ page }) => {
  const bad: string[] = [];
  const mixed = (url: URL) => {
    const b = recorded(url);
    for (const i of [1, 4, 7]) if (b.data.stations[i]) b.data.stations[i].targetBasis = 'mixed';
    return b;
  };
  for (const [w, scale] of [[1366, 1], [1920, 1.3], [320, 1]] as const) {
    await cell(page, `s=quality&t=stations${PD1}`, w, H(w), scale, { overrides: { '/api/weight-stations': mixed } });
    const table = (await page.locator('.qs-table, .ui-dt').count()) ? page.locator('.qs-table, .ui-dt').first() : page.locator('main');
    for (const p of await overprintPairs(table)) bad.push(`${w}@${scale}: overprint ${p}`);
  }
  expect(bad).toEqual([]);
});

test('css-068 adjacent cell text in the stations table never touches (M-22)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [1920, 1.3], [1100, 1]] as const) {
    await cell(page, `s=quality&t=stations${PD1}`, w, H(w), scale);
    const res = await page.evaluate(() => {
      let worst = Infinity, where = '';
      for (const tr of document.querySelectorAll('.ui-dt__table tr')) {
        const cells = [...tr.children] as HTMLElement[];
        const rects = cells.map((c) => { const g = document.createRange(); g.selectNodeContents(c); return [...g.getClientRects()].filter((r) => r.width > 0 && r.height > 0); });
        for (let i = 0; i + 1 < cells.length; i++) for (const a of rects[i]!) for (const b of rects[i + 1]!) {
          if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 3) continue;
          if (b.left - a.right < worst) { worst = b.left - a.right; where = `"${(cells[i]!.textContent ?? '').trim().slice(0, 14)}" | "${(cells[i + 1]!.textContent ?? '').trim().slice(0, 14)}"`; }
        }
      }
      return { worst, where };
    });
    if (res.worst < 0) bad.push(`${w}@${scale}: ${res.worst.toFixed(1)} px at ${res.where}`);
  }
  expect(bad).toEqual([]);
});

test('css-076 a sparkline stays inside its table cell (M-22)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [1920, 1.3], [320, 1]] as const) {
    await cell(page, `s=quality&t=stations${PD1}`, w, H(w), scale);
    const out = await page.evaluate(() => {
      const res: string[] = [];
      for (const td of document.querySelectorAll('.ui-dt__table td')) {
        const c = td.getBoundingClientRect();
        for (const s of td.querySelectorAll('svg')) {
          const r = s.getBoundingClientRect();
          if (r.width && (r.right > c.right + 0.5 || r.left < c.left - 0.5)) res.push(`svg ${Math.round(r.left - c.left)}..${Math.round(r.right - c.left)} in a ${Math.round(c.width)} px cell`);
        }
      }
      return res.slice(0, 4);
    });
    for (const o of out) bad.push(`${w}@${scale}: ${o}`);
  }
  expect(bad).toEqual([]);
});

test('s3-x1-weight-mixed-row-height a station that ran several products keeps a one-line marker and a row of at most 70 px (M-22)', async ({ page }) => {
  const bad: string[] = [];
  const mixed = (url: URL) => {
    const b = recorded(url);
    for (const i of [1, 4, 7]) if (b.data.stations[i]) b.data.stations[i].targetBasis = 'mixed';
    return b;
  };
  for (const [w, scale] of [[1366, 1], [1920, 1.3]] as const) {
    await cell(page, `s=quality&t=stations${PD1}`, w, 900, scale, { overrides: { '/api/weight-stations': mixed } });
    const rows = await page.locator('.ui-dt__row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    if (!rows.length) bad.push(`${w}@${scale}: no table rows`);
    const max = Math.max(0, ...rows);
    if (max > 70) bad.push(`${w}@${scale}: tallest station row ${max.toFixed(0)} px (limit 70)`);
    const text = (await page.locator('main').innerText()).toLowerCase();
    const full = text.split('no single target applies').length - 1;
    if (full > 1) bad.push(`${w}@${scale}: the full "no single target applies" sentence is printed ${full} times (once under the table is the rule)`);
  }
  expect(bad).toEqual([]);
});

test('css-069 the chart legend stays inside its frame and clear of what follows (kit Frame)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [375, 730, 1366]) {
    for (const [name, qs] of CHART_SCREENS) {
      await cell(page, qs, w, H(w));
      const res = await page.evaluate(() => {
        const out: string[] = [];
        for (const f of document.querySelectorAll('.ck-frame')) {
          const fr = f.getBoundingClientRect();
          const lg = f.querySelector('.ck-legend');
          if (!lg) continue;
          const lr = lg.getBoundingClientRect();
          if (lr.bottom > fr.bottom + 0.5 || lr.right > fr.right + 0.5 || lr.left < fr.left - 0.5) out.push(`legend ${Math.round(lr.left - fr.left)}..${Math.round(lr.right - fr.left)} / bottom ${Math.round(lr.bottom - fr.bottom)} outside its frame`);
          const next = f.nextElementSibling?.getBoundingClientRect();
          if (next && lr.bottom > next.top + 0.5 && lr.top < next.bottom && lr.right > next.left && lr.left < next.right) out.push('legend overlaps the next block');
        }
        return out;
      });
      for (const r of res) bad.push(`${name} @${w}: ${r}`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-070 adjacent x-axis labels never collide (M-18)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[320, 1], [353, 1], [375, 1.3], [768, 1], [1366, 1]] as const) {
    for (const [name, qs] of CHART_SCREENS) {
      await cell(page, qs.replace(PD1, PL), w, H(w), scale);
      for (const c of await xLabelCollisions(page)) bad.push(`${name} @${w}@${scale}: ${c.chart}: ${c.what}`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-050 end labels of the trend line stay inside the chart (M-18)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[320, 1], [375, 1], [375, 1.3], [768, 1], [1366, 1], [1366, 1.3]] as const) {
    await cell(page, `s=quality&t=rejects&jc=2-1${PD1}`, w, H(w), scale);
    for (const o of await textOutsideSvg(page, '.ck-direct, .ck-xlabels text')) bad.push(`${w}@${scale}: ${o.chart}: ${o.what}`);
    if (!(await page.locator('.ck-direct').count())) bad.push(`${w}@${scale}: no direct end label drawn`);
  }
  expect(bad).toEqual([]);
});

test('css-071 the limit label of the weight chart stays inside the chart at 320 to 620 (M-29)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [320, 375, 500, 620, 768]) {
    await cell(page, `s=quality&t=weight&wt=cone&wm=time${PD1}`, w, H(w));
    const n = await page.locator('.ck-limit-text, .ck-band-text').count();
    if (!n) bad.push(`@${w}: no limit label drawn`);
    for (const o of await textOutsideSvg(page, '.ck-limit-text, .ck-band-text')) bad.push(`@${w}: ${o.chart}: ${o.what}`);
  }
  expect(bad).toEqual([]);
});

test('css-077 y-axis tick labels are inside the chart on every kit chart', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[320, 1], [375, 1.3], [1366, 1]] as const) {
    for (const [name, qs] of CHART_SCREENS) {
      await cell(page, qs, w, H(w), scale);
      for (const o of await textOutsideSvg(page, '.ck-yaxis text, .ck-yaxis .ck-tick')) bad.push(`${name} @${w}@${scale}: ${o.chart}: ${o.what}`);
    }
  }
  expect(bad).toEqual([]);
});

test('charts every chart screen offers a tooltip, a readout, zoom and resize', async ({ page }) => {
  const bad: string[] = [];
  for (const [name, qs] of CHART_PAGES) {
    await cell(page, qs, 1366, 800);
    const m = await page.evaluate(() => ({
      bodies: document.querySelectorAll('.chart-frame-body').length,
      readouts: document.querySelectorAll('.chart-frame .readout').length,
      handles: document.querySelectorAll('.chart-resize').length,
    }));
    if (!m.bodies) bad.push(`${name}: no chart drawn`);
    if (m.readouts < m.bodies) bad.push(`${name}: ${m.readouts} readouts for ${m.bodies} charts`);
    if (m.handles < m.bodies) bad.push(`${name}: ${m.handles} resize handles for ${m.bodies} charts`);
    const body = page.locator('.chart-frame-body').first();
    await body.hover({ position: { x: 200, y: 60 } });
    await page.waitForTimeout(200);
    if (!(await page.locator('.chart-tip').count())) bad.push(`${name}: hovering a mark shows no tooltip`);
    const h0 = (await body.boundingBox())?.height ?? 0;
    await page.locator('.chart-resize').first().focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    const h1 = (await page.locator('.chart-frame-body').first().boundingBox())?.height ?? 0;
    if (h1 <= h0) bad.push(`${name}: ArrowDown on the resize handle did not grow the chart (${h0} -> ${h1})`);
  }
  expect(bad).toEqual([]);
});

test('m-18 axis titles clear the tick labels on Weight over time, the Rejects Pareto and the Today Pareto (D8)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [375, 768, 1366, 1920]) {
    for (const [name, qs] of CHART_SCREENS) {
      await cell(page, qs, w, H(w));
      for (const o of await titleTickIntersections(page)) bad.push(`${name} @${w}: ${o.chart}: ${o.what}`);
    }
  }
  expect(bad).toEqual([]);
});

test('date-format no date on a Quality tab uses a second format (D15)', async ({ page }) => {
  const bad: string[] = [];
  const RE = /\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}|\bSept\b|\b\d{1,2}:\d{2}(?::\d{2})? ?[AP]M\b/;
  for (const qs of [`s=quality&t=weight&wt=cone&wm=time${PL}`, `s=quality&t=rejects${PL}`, `s=quality&t=stations${PL}`, `s=quality&t=register&rl=cones${PD1}`]) {
    await cell(page, qs, 1366, 800);
    const text = await page.locator('main').innerText();
    const m = text.match(RE);
    if (m) bad.push(`${qs.split('&').slice(0, 2).join('&')}: "${m[0]}"`);
  }
  await settle(page, 500);
  expect(bad).toEqual([]);
});
