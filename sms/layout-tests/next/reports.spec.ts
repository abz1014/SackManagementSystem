/**
 * Reports (the 18 report types over the old renderers, restyled in web-next) on screen.
 * Ports: css-011, 012, 013, 018, 019, 033, 035, 036, 036b, 040, 056, 073, 075, s3-c005, s3-f2, ifl-reports,
 * machine-product-report. Print and PDF checks live in print.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { contrastOf, IFL_TYPES, openApp, pageOverflow, PD1, PL, REPORT_TYPES } from './support/page';
import { recorded } from './support/mock';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}
const H = (w: number) => (w < 700 ? 812 : 800);
const rp = (rt: string, period = PL) => `s=reports&rt=${rt}${period}`;

test('css-011 the Daily and sack reports never scroll the page sideways', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of ['daily', 'sack']) {
    for (const w of [375, 621, 768, 900, 1100, 1366]) {
      await cell(page, rp(rt), w, H(w));
      const o = await pageOverflow(page);
      if (o > 1) bad.push(`${rt} @${w}: overflow ${o}px`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-012 the report page head and builder actions keep a readable headline and clear the preview (M-09)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [650, 768, 900]) {
    await cell(page, rp('daily'), w, H(w));
    const m = await page.evaluate(() => {
      const sentence = document.querySelector('.rp-title__sentence, .rp-title h1, .rp-title') as HTMLElement | null;
      const acts = document.querySelector('.rp-acts, .rp-exports') as HTMLElement | null;
      const prev = document.querySelector('.rp-preview') as HTMLElement | null;
      return { sw: sentence?.getBoundingClientRect().width ?? 0, actsBottom: acts?.getBoundingClientRect().bottom ?? 0, prevTop: prev?.getBoundingClientRect().top ?? 0, ov: document.documentElement.scrollWidth - innerWidth };
    });
    if (m.sw < 300) bad.push(`@${w}: headline column ${Math.round(m.sw)} px`);
    if (m.prevTop - m.actsBottom < 10 && m.prevTop > m.actsBottom - 1) bad.push(`@${w}: actions end ${Math.round(m.actsBottom)}, preview starts ${Math.round(m.prevTop)}`);
    if (m.ov > 1) bad.push(`@${w}: overflow ${m.ov}px`);
  }
  expect(bad).toEqual([]);
});

test('css-013 every IFL table heading has at least 4.5:1 contrast on its fill (M-14)', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of IFL_TYPES) {
    await cell(page, rp(rt), 1366, 800);
    const ths = page.locator('.rp-doc .ifl-table th:visible');
    const n = await ths.count();
    if (!n) { bad.push(`${rt}: no IFL table headings`); continue; }
    let worst = 99, which = '';
    for (let i = 0; i < Math.min(n, 12); i++) {
      const c = await contrastOf(ths.nth(i));
      if (c < worst) { worst = c; which = ((await ths.nth(i).textContent()) ?? '').trim().slice(0, 20); }
    }
    if (worst < 4.5) bad.push(`${rt}: "${which}" ${worst.toFixed(2)}:1`);
  }
  expect(bad).toEqual([]);
});

test('css-018 IFL tables fit their report column at desktop widths (M-12)', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of IFL_TYPES) {
    for (const w of [1366, 1920]) {
      await cell(page, rp(rt), w, 900);
      const res = await page.evaluate(() => [...document.querySelectorAll('.rp-doc table.ifl-table')].map((t) => {
        let box: HTMLElement | null = t.parentElement;
        while (box && box !== document.body && !['auto', 'scroll', 'hidden'].includes(getComputedStyle(box).overflowX)) box = box.parentElement;
        return { sw: box?.scrollWidth ?? 0, cw: box?.clientWidth ?? 0 };
      }));
      if (!res.length) bad.push(`${rt} @${w}: no IFL table`);
      for (const r of res) if (r.sw > r.cw + 1) bad.push(`${rt} @${w}: table scrolls (${r.sw} > ${r.cw})`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-019 a wide machine matrix names the machines out of view and keeps contrast (M-13)', async ({ page }) => {
  const bad: string[] = [];
  for (const [w, scale] of [[1366, 1], [768, 1], [375, 1], [1366, 1.3]] as const) {
    await cell(page, rp('machine-product'), w, H(w), scale);
    const truth = await page.evaluate(() => {
      const box = document.querySelector('.mp-scroll') as HTMLElement | null;
      if (!box) return null;
      const right = box.getBoundingClientRect().right;
      const hidden = [...box.querySelectorAll('thead th.click')].filter((t) => t.getBoundingClientRect().right > right + 0.5).map((t) => (t.childNodes[0]?.textContent ?? '').trim());
      return { wide: box.scrollWidth > box.clientWidth, hidden };
    });
    if (!truth) { bad.push(`${w}@${scale}: no .mp-scroll matrix`); continue; }
    if (!truth.wide || !truth.hidden.length) continue; // fits: no cue needed
    const cue = page.locator('.mp-cue');
    if (!(await cue.count()) || !(await cue.first().isVisible())) { bad.push(`${w}@${scale}: matrix scrolls but no cue is visible`); continue; }
    const text = (await cue.first().textContent()) ?? '';
    if (!text.includes(truth.hidden[0]!)) bad.push(`${w}@${scale}: cue does not name the first hidden machine "${truth.hidden[0]}"`);
    if (!text.includes(truth.hidden[truth.hidden.length - 1]!)) bad.push(`${w}@${scale}: cue does not name the last hidden machine`);
    const c = await contrastOf(cue);
    if (c < 4.5) bad.push(`${w}@${scale}: cue contrast ${c.toFixed(2)}:1`);
  }
  expect(bad).toEqual([]);
});

test('css-033 date cells in the IFL tables never split across lines (M-12)', async ({ page }) => {
  const bad: string[] = [];
  const DATE = /\b\d{1,2} [A-Z][a-z]{2,4}(?: \d{4})?\b|\b\d{2}[\/-]\d{2}[\/-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/;
  for (const rt of ['rejected-sacks', 'rejected-hangers', 'daily', 'reject', 'shift-production']) {
    for (const w of [768, 1366]) {
      await cell(page, rp(rt), w, H(w));
      const n = await page.evaluate((src) => {
        const re = new RegExp(src);
        let splits = 0;
        for (const td of document.querySelectorAll('.rp-doc td')) {
          const t = td.textContent ?? '';
          if (!re.test(t) || t.length > 24) continue;
          const g = document.createRange(); g.selectNodeContents(td);
          if (new Set([...g.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size > 1) splits++;
        }
        return splits;
      }, DATE.source);
      if (n) bad.push(`${rt} @${w}: ${n} date cell(s) split across lines`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-035 text in the IFL tables keeps 4 px from the gridlines', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of ['rejected-sacks', 'sack-weight-summary', 'shift-production']) {
    await cell(page, rp(rt), 1366, 800);
    const res = await page.evaluate(() => {
      let worst = Infinity, where = '';
      for (const c of document.querySelectorAll('.rp-doc table.ifl-table td, .rp-doc table.ifl-table th')) {
        if (!(c.textContent ?? '').trim()) continue;
        const g = document.createRange(); g.selectNodeContents(c);
        const t = g.getBoundingClientRect(); const b = c.getBoundingClientRect();
        if (!t.width) continue;
        const gap = Math.min(t.left - b.left, b.right - t.right);
        if (gap < worst) { worst = gap; where = (c.textContent ?? '').trim().slice(0, 14); }
      }
      return { worst, where };
    });
    if (res.worst < 3.5) bad.push(`${rt}: "${res.where}" is ${res.worst.toFixed(1)} px from a gridline`);
  }
  expect(bad).toEqual([]);
});

test('css-036 the machine matrix header is IFL light blue (owner B, M-14)', async ({ page }) => {
  await cell(page, rp('machine-product'), 1366, 800);
  const bg = await page.locator('.mp-scroll thead th').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, 'matrix header fill (IFL light blue is #ADD8E6)').toBe('rgb(173, 216, 230)');
});

test('css-036b the matrix header chevron has at least 4.5:1 contrast on the blue (M-14)', async ({ page }) => {
  await cell(page, rp('machine-product'), 1366, 800);
  const chev = page.locator('.mp-scroll thead th .chev').first();
  if (!(await chev.count())) throw new Error('no chevron in the matrix header');
  expect(await contrastOf(chev)).toBeGreaterThanOrEqual(4.5);
});

test('css-040 the keyboard focus ring of a matrix header is not clipped at its top edge', async ({ page }) => {
  await cell(page, rp('machine-product'), 1366, 800);
  await page.locator('.mp-scroll thead th.click').first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const m = await page.evaluate(() => {
    const th = document.activeElement as HTMLElement;
    const cs = getComputedStyle(th);
    const box = th.closest('.mp-scroll')!.getBoundingClientRect();
    const r = th.getBoundingClientRect();
    const w = parseFloat(cs.outlineWidth), off = parseFloat(cs.outlineOffset) || 0;
    return { isTh: th.tagName === 'TH', has: cs.outlineStyle !== 'none' && w > 0, top: r.top - Math.max(0, w + off), boxTop: box.top };
  });
  expect(m.isTh, 'focus reaches a matrix header').toBe(true);
  expect(m.has, 'the focused header has an outline').toBe(true);
  expect(m.top, 'ring top inside the scroll box').toBeGreaterThanOrEqual(m.boxTop - 0.5);
});

test('css-056 no row of the unknown-lifter report is taller than 95 px (M-12)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [768, 1366]) {
    await cell(page, rp('rejected-unknown-lifter'), w, H(w));
    const hs = await page.locator('.rp-doc table.ifl-table tbody tr').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    if (!hs.length) { bad.push(`${w}: no rows`); continue; }
    if (Math.max(...hs) > 95) bad.push(`${w}: tallest row ${Math.max(...hs).toFixed(0)} px`);
  }
  expect(bad).toEqual([]);
});

test('css-073 every report table that scrolls sideways carries a visible fade cue (M-12)', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of ['rejected-sacks', 'rejected-hangers', 'daily', 'reject', 'shift-production']) {
    for (const w of [768, 1100]) {
      await cell(page, rp(rt), w, H(w));
      const res = await page.evaluate(() => [...document.querySelectorAll('.rp-doc .tw')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => {
        const cue = b.querySelector('.ui-dt__fade, .ui-dt__cue, .tw-fade, [data-scroll-cue]') ?? b.parentElement?.querySelector('.ui-dt__fade, .ui-dt__cue, .tw-fade, [data-scroll-cue]');
        const cs = b ? getComputedStyle(b, '::after') : null;
        const visible = !!cue && (cue as HTMLElement).getBoundingClientRect().width > 0;
        return { cue: visible || (cs?.backgroundImage ?? 'none') !== 'none' || (cs?.content ?? 'none') !== 'none' };
      }));
      const missing = res.filter((r) => !r.cue).length;
      if (missing) bad.push(`${rt} @${w}: ${missing} of ${res.length} scrolling table(s) with no fade cue`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-075 the report actions keep at least 10 px from the preview (M-09)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [1366, 768, 375]) {
    await cell(page, rp('daily'), w, H(w));
    const m = await page.evaluate(() => {
      const acts = [...document.querySelectorAll('.rp-acts, .rp-exports')].map((e) => e.getBoundingClientRect().bottom);
      const prev = document.querySelector('.rp-preview')?.getBoundingClientRect().top ?? 0;
      return { gap: acts.length ? prev - Math.max(...acts) : 99 };
    });
    if (m.gap < 10) bad.push(`@${w}: ${m.gap.toFixed(1)} px between the actions and the preview`);
  }
  expect(bad).toEqual([]);
});

test('s3-c005-product-station-sacks a Product report filtered to one winder blanks the sack figures and says why', async ({ page }) => {
  const bad: string[] = [];
  const NOTE = 'Sacks are not shown: the sack scale records no winder, so sack figures cannot be narrowed to station 4.';
  const filtered = (url: URL) => {
    const b = recorded(url);
    b.data.header.filters = { station: 4 };
    b.data.report.filters = { station: 4 };
    for (const r of b.data.report.rows) { r.sacks = null; r.sackWeightKg = null; r.avgSackKg = null; r.conesPerSack = null; }
    b.data.report.sacksOmitted = true;
    b.data.report.sackNote = NOTE;
    return b;
  };
  for (const [w, h] of [[1366, 768], [375, 812]] as const) {
    await cell(page, `${rp('product', PD1)}&st=4`, w, h, 1, { overrides: { '/api/reports/product': filtered } });
    const heads = (await page.locator('.rp-doc table.ifl-table thead th').allInnerTexts()).map((t) => t.trim());
    if (heads.includes('Sacks')) bad.push(`${w}: a Sacks column is still shown with a winder filter`);
    const n = await page.getByText('the sack scale records no winder').count();
    if (n !== 1) bad.push(`${w}: the reason is printed ${n} times (once is the rule)`);
    if ((await pageOverflow(page)) > 1) bad.push(`${w}: page overflow`);
  }
  await cell(page, rp('product', PD1), 1366, 768);
  const heads = (await page.locator('.rp-doc table.ifl-table thead th').allInnerTexts()).map((t) => t.trim());
  if (!heads.includes('Sacks')) bad.push('no filter: the Sacks column is missing');
  expect(bad).toEqual([]);
});

test('s3-f2-report-product-changes the Daily, Shift and Shift-production reports show product changes once, with the time rule', async ({ page }) => {
  const bad: string[] = [];
  const TIME = 'Each change is timed at the first cone of the new product on that winder, not at the moment the panel selection was made.';
  for (const rt of ['daily', 'shift', 'shift-production']) {
    const withChanges = (url: URL) => {
      const b = recorded(url);
      const mk = (station: number, first: string, before: boolean) => ({ station, machineName: `M${station}`, day: '2026-08-11', shift: 'evening', fromMaterialId: 21, fromProductName: '205-IL0-SD', toMaterialId: 1021, toProductName: '205-IL0-SD', firstUtc: first, kind: 'between_shifts', fromBeforePeriod: before });
      b.data.report.productChanges = [mk(3, '2026-08-11T17:20:14.290Z', true), mk(4, '2026-08-11T20:03:28.827Z', false)];
      b.data.report.productChangeLabels = { '21': '205-IL0-SD #21', '1021': '205-IL0-SD #1021' };
      b.data.header.reportNotes = [...(b.data.header.reportNotes ?? []), TIME];
      return b;
    };
    for (const w of [1366, 375]) {
      await cell(page, rp(rt, '&p=pick&from=2026-08-11&to=2026-08-11'), w, H(w), 1, { overrides: { [`/api/reports/${rt}`]: withChanges } });
      const heads = (await page.locator('.rp-doc table.ifl-table thead th').allInnerTexts()).map((t) => t.trim());
      if (!heads.includes('First cone of the new product')) bad.push(`${rt} @${w}: no "First cone of the new product" column`);
      if ((await page.getByText('(before this period)').count()) !== 1) bad.push(`${rt} @${w}: the change from before the period is not marked once`);
      if (!(await page.getByText('not at the moment the panel selection was made').count())) bad.push(`${rt} @${w}: the time rule is missing`);
      if ((await pageOverflow(page)) > 1) bad.push(`${rt} @${w}: page overflow`);
    }
  }
  expect(bad).toEqual([]);
});

test('ifl-reports all IFL report types draw at 1366 and 375 without overflow, with a verdict and a table', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of IFL_TYPES) {
    for (const w of [1366, 375]) {
      await cell(page, rp(rt), w, H(w));
      const m = await page.evaluate(() => ({ doc: !!document.querySelector('.rp-doc'), tables: document.querySelectorAll('.rp-doc table').length, text: (document.querySelector('.rp-doc') as HTMLElement | null)?.innerText.length ?? 0 }));
      if (!m.doc || m.text < 200) bad.push(`${rt} @${w}: report did not draw`);
      if (!m.tables) bad.push(`${rt} @${w}: no table`);
      if ((await pageOverflow(page)) > 1) bad.push(`${rt} @${w}: page overflow`);
    }
  }
  expect(bad).toEqual([]);
});

test('machine-product-report the matrix at 1366 keeps its first column visible while scrolling', async ({ page }) => {
  await cell(page, rp('machine-product'), 1366, 800);
  const box = page.locator('.mp-scroll');
  expect(await box.count(), 'matrix region').toBe(1);
  const before = await page.locator('.mp-scroll tbody tr').first().locator('th, td').first().boundingBox();
  await box.evaluate((el) => { el.scrollLeft = 400; });
  await page.waitForTimeout(150);
  const after = await page.locator('.mp-scroll tbody tr').first().locator('th, td').first().boundingBox();
  const canScroll = await box.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (canScroll) expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0)), 'first column stays put (sticky)').toBeLessThanOrEqual(1);
});

test('reports-all the 18 report types draw at 1366 without a page overflow', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of REPORT_TYPES) {
    await cell(page, rp(rt), 1366, 800);
    if (!(await page.locator('.rp-doc').count())) bad.push(`${rt}: no document`);
    if ((await pageOverflow(page)) > 1) bad.push(`${rt}: overflow`);
  }
  expect(bad).toEqual([]);
});
