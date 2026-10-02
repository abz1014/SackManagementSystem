/**
 * IFL's eight named reports (their email of 29 Sep 2026; built 1 Oct 2026) in a REAL browser — the layout and print checks jsdom cannot
 * make, at the two widths that matter: the plant PC's 1366x768 and a phone's 375x812.
 *
 * Like `charts.spec.ts` this never signs in: every `/api/*` call is mocked (`support/mocks.ts`, whose IFL fixtures
 * `web/src/screens/report/layoutMocks.contract.test.tsx` pins to the app's own wire types and renders through the real section
 * components), so it runs without `SMS_TEST_USERNAME` and needs only the Vite dev server.
 *
 * WHAT IS ASSERTED, per report and width:
 *  1. NO PAGE HORIZONTAL SCROLL. `html` and `body` never scroll sideways. A wide table scrolls inside its own `.tw` container, never the page.
 *  2. NOTHING POKES OUT OR IS CLIPPED. No visible element outside a scroll container extends past the right edge of the viewport or past an
 *     ancestor that clips it — the chips, the period bar, the figures and the section text included. (When 1 fails, this names the element.)
 *  3. EVERY TABLE IS REACHABLE. Each `.tw` lies inside the viewport, and where its table is wider than it the container really scrolls
 *     (`overflow-x: auto|scroll`) rather than clipping the columns off.
 *  4. EVERY HANGING LABEL IS READABLE. A block's label (`section.block > p.h2`) has a real width and is not painted over by its own table:
 *     beside the content at desktop width, above it on a phone, and the element under its centre is the label itself.
 *  5. NO EMPTY BAND UNDER THE FILTER CHIPS (L4): the first section starts within 80px of the last chip, not ~120px.
 *  6. PRINT ORIENTATION (desktop width only): the print stylesheet names the `report-portrait` page for seven of the eight and
 *     `report-landscape` for SPS packing (the wide matrix), and the PDF Edge renders says the same — first page's MediaBox.
 *
 * Findings it was written against (1 Oct 2026, a real-browser look at the integrated build): L1 the period bar did not wrap, so a
 * 375-547px window scrolled sideways; L2 a hanging block label collapsed to zero width under its table; L3 table columns were pushed off
 * screen on a phone; L4 ~120px of empty page under the filter chips on the Shift-wise CTS Loop report.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { IFL_REPORT_KINDS, mockAuth, mockCatchAll, mockCommon, mockReport, type ReportKind } from './support/mocks';

type IflKind = (typeof IFL_REPORT_KINDS)[number];

/** IFL's own names (their email), and whether the report prints portrait. */
const REPORTS: Record<IflKind, { title: string; portrait: boolean }> = {
  'shift-production': { title: 'Shift-wise CTS Loop Production Report', portrait: true },
  'rejected-sacks': { title: 'Rejected Sack Report - Daily', portrait: true },
  'sps-packing': { title: 'SPS Production Report - Count-wise Packing at Each SPS', portrait: false },
  'sack-weight-range': { title: 'SPS Sack Weight Range Report', portrait: true },
  'sack-weight-summary': { title: 'Sack Packing Weight Summary', portrait: true },
  'rejected-cones': { title: 'List of Rejected Cones Against Weight', portrait: true },
  'rejected-hangers': { title: 'Rejected Cone Hangers Report', portrait: true },
  'rejected-unknown-lifter': { title: 'Rejected Unknown (Lifter) Report', portrait: true },
};

const VIEWPORTS = [
  { width: 1366, height: 768, name: 'desktop' },
  { width: 375, height: 812, name: 'phone' },
] as const;

const OUT_DIR = path.join(__dirname, '.output', 'ifl-reports');

async function open(page: Page, kind: ReportKind): Promise<void> {
  // Catch-all FIRST: Playwright runs the last-registered matching route first (see support/mocks.ts).
  await mockCatchAll(page);
  await mockAuth(page, 'manager');
  await mockCommon(page);
  await mockReport(page, kind);
  await page.goto(`/?s=report&rt=${kind}&p=pick&from=2026-09-01&to=2026-09-07`);
  await page.locator('table.ifl-table').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(150); // fonts and ResizeObserver settle
}

interface Offender { el: string; why: string; right: number; width: number }
interface TableBox { tw: string; left: number; right: number; clientWidth: number; scrollWidth: number; overflowX: string }
interface LabelBox { text: string; width: number; top: number; bottom: number; left: number; right: number; contentLeft: number | null; contentTop: number | null; coveredBy: string | null }
interface LayoutMeasure {
  viewportWidth: number;
  htmlScroll: number;
  bodyScroll: number;
  offenders: Offender[];
  tables: TableBox[];
  labels: LabelBox[];
  chips: { text: string; left: number; right: number }[];
  gapUnderChips: number | null;
  orientationHooks: { portrait: boolean };
}

/** Everything the assertions read, measured in one pass inside the page (real layout, real boxes). */
async function measure(page: Page): Promise<LayoutMeasure> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const describe = (el: Element): string => {
      const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.trim().replace(/\s+/g, '.') : '';
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
    };
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    /**
     * Why an element is a layout defect, or null when it is fine. A table inside `.tw` (or `.mp-scroll`) scrolls in its own box, by design.
     * Anything else must end inside the viewport, and an ancestor that merely CLIPS (`overflow-x: hidden|clip`) is no excuse: content
     * cut off by it is as lost to the reader as content past the edge.
     */
    const classify = (el: Element): string | null => {
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        if (a.matches('.tw, .mp-scroll')) return null;
        const ox = getComputedStyle(a).overflowX;
        if ((ox === 'hidden' || ox === 'clip') && r.right > a.getBoundingClientRect().right + 1) return `clipped by ${describe(a)}`;
      }
      return r.right > vw + 1 ? 'past the right edge of the viewport' : null;
    };

    const offenders: { el: string; why: string; right: number; width: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('.sr-only, .sr-only-th, .print-only, .print-head, script, style')) continue;
      if (!shown(el)) continue;
      const why = classify(el);
      if (why) {
        const r = el.getBoundingClientRect();
        offenders.push({ el: describe(el), why, right: Math.round(r.right), width: Math.round(r.width) });
      }
    }

    const tables = Array.from(document.querySelectorAll('.tw')).filter(shown).map((tw) => {
      const r = tw.getBoundingClientRect();
      return {
        tw: describe(tw), left: Math.round(r.left), right: Math.round(r.right), clientWidth: tw.clientWidth, scrollWidth: tw.scrollWidth,
        overflowX: getComputedStyle(tw).overflowX,
      };
    });

    const labels: {
      text: string; width: number; top: number; bottom: number; left: number; right: number;
      contentLeft: number | null; contentTop: number | null; coveredBy: string | null;
    }[] = [];
    for (const h of Array.from(document.querySelectorAll('section.block > p.h2')).filter(shown)) {
      h.scrollIntoView({ block: 'center' });
      const r = h.getBoundingClientRect();
      const content = h.parentElement?.querySelector(':scope > div') ?? null;
      const c = content ? content.getBoundingClientRect() : null;
      // the element painted at the label's own centre: it must be the label (or inside it), not a table over it
      const top = document.elementFromPoint(r.left + Math.min(r.width / 2, 24), r.top + r.height / 2);
      labels.push({
        text: (h.textContent ?? '').trim().slice(0, 40), width: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right), contentLeft: c ? Math.round(c.left) : null, contentTop: c ? Math.round(c.top) : null,
        coveredBy: top && !h.contains(top) ? describe(top) : null,
      });
    }
    window.scrollTo(0, 0);

    const chipEls = Array.from(document.querySelectorAll('button.chip, label.chip')).filter(shown);
    const chips = chipEls.map((c) => {
      const r = c.getBoundingClientRect();
      return { text: (c.textContent ?? '').trim().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) };
    });
    const lastChipBottom = chipEls.length ? Math.max(...chipEls.map((c) => c.getBoundingClientRect().bottom)) : null;
    const firstBlock = document.querySelector('main section.block');
    const firstContent = firstBlock?.querySelector(':scope > p.h2, :scope > div > *') ?? null;
    const gapUnderChips = lastChipBottom != null && firstContent ? Math.round(firstContent.getBoundingClientRect().top - lastChipBottom) : null;

    return {
      viewportWidth: vw,
      htmlScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      offenders, tables, labels, chips, gapUnderChips,
      orientationHooks: { portrait: document.querySelector('[data-report-orientation="portrait"]') !== null },
    };
  });
}

for (const kind of IFL_REPORT_KINDS) {
  const def = REPORTS[kind];
  for (const vp of VIEWPORTS) {
    test(`${def.title}: fits ${vp.width}x${vp.height} — no page scroll, tables scroll in their own box, labels readable`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, kind);

      // The chip row names the open report by IFL's own title.
      await expect(page.getByRole('button', { name: def.title, exact: true })).toHaveAttribute('aria-pressed', 'true');

      const m = await measure(page);
      const where = `${kind} @ ${vp.width}x${vp.height}`;
      const shot = testInfo.outputPath(`${kind}-${vp.name}.png`);
      const fail = async (): Promise<void> => { await page.screenshot({ path: shot, fullPage: true }); };

      // 1. no page horizontal scroll
      const pageOverflow = Math.max(m.htmlScroll, m.bodyScroll) - m.viewportWidth;
      if (pageOverflow > 0) await fail();
      expect(pageOverflow, `${where}: the page scrolls sideways by ${pageOverflow}px (screenshot: ${shot}); elements past the right edge: ${JSON.stringify(m.offenders.slice(0, 8))}`).toBeLessThanOrEqual(0);

      // 2. nothing outside a scroll container pokes past the viewport
      expect(m.offenders, `${where}: elements run off the screen or are clipped`).toEqual([]);

      // 2b. every chip (report type and filters) is inside the row on screen
      for (const c of m.chips) expect(c.right, `${where}: chip "${c.text}" runs off the screen`).toBeLessThanOrEqual(m.viewportWidth + 1);

      // 3. every table is reachable: its container is on screen, and scrolls when the table is wider
      expect(m.tables.length, `${where}: no .tw table container rendered`).toBeGreaterThan(0);
      for (const t of m.tables) {
        expect(t.left, `${where}: table box ${t.tw} starts left of the screen`).toBeGreaterThanOrEqual(-1);
        expect(t.right, `${where}: table box ${t.tw} ends past the right edge`).toBeLessThanOrEqual(m.viewportWidth + 1);
        if (t.scrollWidth > t.clientWidth + 1) {
          expect(['auto', 'scroll'], `${where}: ${t.tw} is ${t.scrollWidth}px of table in a ${t.clientWidth}px box with overflow-x ${t.overflowX}: columns would be clipped`).toContain(t.overflowX);
        }
      }
      console.log(
        `[${where}] page ${Math.max(m.htmlScroll, m.bodyScroll)}/${m.viewportWidth}px; tables ` +
          m.tables.map((t) => `${t.scrollWidth}/${t.clientWidth}`).join(' ') + `; gap under chips ${m.gapUnderChips}px`,
      );

      // 4. every hanging label is a real, unobstructed box beside (desktop) or above (phone) its content
      expect(m.labels.length, `${where}: no block label rendered`).toBeGreaterThan(0);
      const sideBySide = m.viewportWidth > 860;
      for (const l of m.labels) {
        expect(l.width, `${where}: label "${l.text}" collapsed to ${l.width}px`).toBeGreaterThanOrEqual(sideBySide ? 120 : 40);
        expect(l.coveredBy, `${where}: label "${l.text}" is painted over by ${l.coveredBy}`).toBeNull();
        if (l.contentLeft != null && l.contentTop != null) {
          const clear = l.right <= l.contentLeft + 1 || l.bottom <= l.contentTop + 1;
          expect(clear, `${where}: label "${l.text}" [${l.left}-${l.right} x ${l.top}-${l.bottom}] overlaps its content starting at x=${l.contentLeft}, y=${l.contentTop}`).toBe(true);
        }
      }

      // 5. no empty band under the filter chips
      if (m.gapUnderChips != null) {
        expect(m.gapUnderChips, `${where}: ${m.gapUnderChips}px of empty page between the last filter chip and the first section`).toBeLessThanOrEqual(80);
      }
    });
  }

  test(`${def.title}: prints ${def.portrait ? 'portrait' : 'landscape (a wide matrix)'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await open(page, kind);
    await page.emulateMedia({ media: 'print' });

    // The screen-side hook the stylesheet keys off, and the named page the print stylesheet then assigns to the Report <main>.
    const hook = await page.evaluate(() => document.querySelector('[data-report-orientation="portrait"]') !== null);
    expect(hook, `${kind}: data-report-orientation="portrait" is ${def.portrait ? 'missing' : 'present'}`).toBe(def.portrait);
    const named = await page.evaluate(() => {
      const main = document.querySelector('main:has([role="group"][aria-label="Report"])');
      return main ? getComputedStyle(main).getPropertyValue('page').trim() : null;
    });
    if (named === '') testInfo.annotations.push({ type: 'note', description: 'this browser does not expose the computed `page` property; the PDF below is the proof' });
    else expect(named, `${kind}: the print stylesheet's named page`).toBe(def.portrait ? 'report-portrait' : 'report-landscape');

    // The PDF Edge renders: the first page's MediaBox (width x height in points) says which way it is.
    mkdirSync(OUT_DIR, { recursive: true });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const file = path.join(OUT_DIR, `${kind}.pdf`);
    writeFileSync(file, pdf);
    const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((x) => ({ w: Number(x[1]), h: Number(x[2]) }));
    console.log(`[${kind} print] ${pdf.length} bytes, ${boxes.length} MediaBox entries, first ${JSON.stringify(boxes[0] ?? null)} -> ${file}`);
    expect(pdf.length, `${kind}: the PDF render is implausibly small`).toBeGreaterThan(2000);
    if (boxes.length === 0) {
      testInfo.annotations.push({ type: 'note', description: 'no MediaBox found in the PDF bytes (object streams); orientation proven by the computed page name only' });
      return;
    }
    const first = boxes[0]!;
    if (def.portrait) expect(first.h, `${kind}: first printed page is ${first.w}x${first.h}pt, not portrait`).toBeGreaterThan(first.w);
    else expect(first.w, `${kind}: first printed page is ${first.w}x${first.h}pt, not landscape`).toBeGreaterThan(first.h);
  });
}
