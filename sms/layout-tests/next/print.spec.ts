/**
 * Print and PDF on web-next: emulated print media and the browser's own page.pdf (landscape, page numbers).
 * Ports: css-005, css-006, css-031, css-034, print.
 * The PDF text comes from PyMuPDF through support/pdf.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openApp, PD1, PL } from './support/page';
import { footersPerPage, overlappingWordPairs, readPdf } from './support/pdf';

const OUT = path.join(__dirname, '..', '.output', 'next-pdf');

async function cell(page: Page, qs: string, w: number, h: number) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  return openApp(page, qs, { width: w, height: h });
}
async function pdfOf(page: Page, name: string) {
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(500); // chart ResizeObserver settles after the media switch
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.pdf`), buf);
  return buf;
}

test('css-005 printed chart axis labels start inside the printable area (M-05)', async ({ page }) => {
  const bad: string[] = [];
  for (const rt of ['station', 'calibration']) {
    await cell(page, `s=reports&rt=${rt}${PL}`, 1123, 794);
    await page.locator('.chart-frame svg').first().waitFor({ state: 'attached', timeout: 15_000 });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const re = /^[+−-]?\d+(\.\d+)?\s?g?$/;
      const labels = [...document.querySelectorAll<SVGTextElement>('.chart-frame svg text')].filter((t) => re.test((t.textContent ?? '').trim()) && t.getBoundingClientRect().width > 0);
      let min = Infinity, which = '';
      for (const t of labels) { const l = t.getBoundingClientRect().left; if (l < min) { min = l; which = (t.textContent ?? '').trim(); } }
      return { n: labels.length, min, which };
    });
    if (!m.n) bad.push(`${rt}: no numeric axis labels in print`);
    else if (m.min < 0) bad.push(`${rt}: label "${m.which}" starts at x=${m.min.toFixed(1)}`);
  }
  expect(bad).toEqual([]);
});

test('css-006 printed reports have no overlapping words, wherever the page breaks fall (M-05)', async ({ page }) => {
  test.setTimeout(180_000);
  const bad: string[] = [];
  for (const rt of ['station', 'calibration', 'daily', 'shift', 'management-summary']) {
    await cell(page, `s=reports&rt=${rt}${PL}`, 1123, 794);
    const doc = readPdf(await pdfOf(page, `css006-${rt}`));
    const pairs = overlappingWordPairs(doc.words);
    if (pairs) bad.push(`${rt}: ${pairs} overlapping word pair(s) over ${doc.pages.length} page(s)`);
    if (!doc.pages.length) bad.push(`${rt}: empty PDF`);
  }
  expect(bad).toEqual([]);
});

test('css-031 every printed page carries one "Page N of M": the registers and the reports (M-19)', async ({ page }) => {
  test.setTimeout(180_000);
  const bad: string[] = [];
  const docs: Array<[string, string, number, number]> = [
    ['Register cones', `s=quality&t=register&rl=cones${PD1}`, 1017, 1400],
    ['Register sacks', `s=quality&t=register&rl=sacks${PD1}`, 1017, 1400],
    ['Daily', `s=reports&rt=daily${PL}`, 1123, 794],
    ['Management summary', `s=reports&rt=management-summary${PL}`, 1123, 794],
  ];
  for (const [name, qs, w, h] of docs) {
    await cell(page, qs, w, h);
    const doc = readPdf(await pdfOf(page, `css031-${name.replace(/\W+/g, '-')}`));
    if (doc.pages.length < 1) { bad.push(`${name}: empty PDF`); continue; }
    const f = footersPerPage(doc.pages);
    if (f.some((n) => n !== 1)) bad.push(`${name}: "Page N of M" count per page ${JSON.stringify(f)} over ${doc.pages.length} pages`);
    else if (!doc.pages[0]!.includes(`Page 1 of ${doc.pages.length}`)) bad.push(`${name}: first page does not say "Page 1 of ${doc.pages.length}"`);
  }
  expect(bad).toEqual([]);
});

test('css-034 printed pages carry no navigation, tabs, toggles or Name-it controls (M-19)', async ({ page }) => {
  const bad: string[] = [];
  const SEL = '.sh-side, .sh-top, .sh-tabbar, .ui-tabs, .ui-seg, .rs-nameit, .chart-resize, .chart-tip, .ck-toggle, main .ui-btn';
  for (const qs of [`s=quality&t=rejects${PD1}`, `s=quality&t=register&rl=cones${PD1}`, `s=quality&t=weight&wt=cone&wm=time${PD1}`, `s=quality&t=stations${PD1}`]) {
    await cell(page, qs, 1017, 1400);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    const visible = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 22)} "${(e.textContent ?? '').trim().slice(0, 14)}"`).slice(0, 5), SEL);
    if (visible.length) bad.push(`${qs.split('&').slice(0, 2).join('&')}: visible in print: ${visible.join('; ')}`);
  }
  expect(bad).toEqual([]);
});

test('print a report prints on A4 landscape with page numbers; the Login smoke page makes a real PDF', async ({ page }) => {
  const bad: string[] = [];
  await cell(page, `s=reports&rt=daily${PL}`, 1366, 768);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);
  const doc = readPdf(await pdfOf(page, 'print-daily-landscape'));
  if (!doc.sizes.length) bad.push('daily: no pages');
  else {
    const [w, h] = doc.sizes[0]!;
    if (!(w > h)) bad.push(`daily: page is ${Math.round(w)}x${Math.round(h)} pt, not landscape`);
    if (Math.abs(w - 841.9) > 6 && Math.abs(w - 842) > 6) bad.push(`daily: page width ${Math.round(w)} pt is not A4 landscape (842)`);
    if (!doc.pages[0]!.includes('Page 1 of')) bad.push('daily: no "Page 1 of N" footer');
  }
  // sidebar, top bar and builder are not on the paper
  const text = doc.pages.join(' ');
  for (const word of ['Build your report', 'Open the readings', 'Sign out']) if (text.includes(word)) bad.push(`daily: "${word}" is printed`);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openApp(page, 's=today', { width: 1366, height: 768, signedOut: true });
  await page.emulateMedia({ media: 'print' });
  const login = await page.pdf({ format: 'A4' });
  if (login.length < 1000) bad.push(`login: the PDF is implausibly small (${login.length} bytes)`);
  expect(bad).toEqual([]);
});
