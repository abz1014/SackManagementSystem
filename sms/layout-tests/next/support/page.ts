/**
 * Page helpers for the web-next Playwright port: open a screen over the mocks, wait for it to settle, measure.
 * Everything measured runs in the real browser (real layout), never jsdom.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { installApi, type Api, type ApiOptions } from './mock';

export const PD1 = '&p=pick&from=2026-09-01&to=2026-09-01';
export const PL = '&p=pick&from=2026-08-05&to=2026-09-07';
export const WIDTHS = { w320: 320, w375: 375, w600: 600, w768: 768, w1100: 1100, w1366: 1366, w1920: 1920 } as const;
export const REPORT_TYPES = ['management-summary', 'daily', 'shift', 'shift-production', 'reject', 'rejected-cones', 'rejected-hangers', 'rejected-unknown-lifter', 'rejected-sacks', 'sack-weight-summary', 'sack', 'sack-weight-range', 'sps-packing', 'machine-product', 'product', 'cone-weight', 'station', 'calibration'] as const;
export const IFL_TYPES = ['management-summary', 'sack-weight-range', 'rejected-sacks', 'rejected-unknown-lifter', 'rejected-hangers', 'sps-packing', 'shift-production'] as const;

export interface OpenOpts extends ApiOptions {
  width?: number;
  height?: number;
  /** Text size (the saved `sms.uiScale`), 1 or 1.3. */
  scale?: number;
  /** Do not wait for skeletons to go away. */
  noSettle?: boolean;
}

/** Wait until the page has no visible loading skeleton (up to `ms`), then a short beat for layout. */
export async function settle(page: Page, ms = 6000): Promise<void> {
  try { await page.waitForLoadState('networkidle', { timeout: ms }); } catch { /* keep going */ }
  try {
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.ui-skel, .kpi-skel, .ui-dt__skel, .skel, .ck-skel, .ui-skel-chart, .ui-skel-kpis')].some((e) => (e as HTMLElement).offsetParent !== null),
      undefined,
      { timeout: ms },
    );
  } catch { /* a screen may keep a skeleton; the spec measures what is there */ }
  await page.waitForTimeout(250);
}

/** Install the mocks, size the window, open `?qs` under /next/ and settle. */
export async function openApp(page: Page, qs: string, o: OpenOpts = {}): Promise<Api> {
  if (o.width) await page.setViewportSize({ width: o.width, height: o.height ?? (o.width < 700 ? 812 : 800) });
  if (o.scale && o.scale !== 1) await page.addInitScript((v) => { try { localStorage.setItem('sms.uiScale', v); } catch { /* ignore */ } }, String(o.scale));
  const api = await installApi(page, o);
  await page.goto(`/next/?${qs}`, { waitUntil: 'load' });
  if (!o.noSettle) await settle(page);
  return api;
}

/** document.scrollingElement.scrollWidth - innerWidth. */
export const pageOverflow = (page: Page) => page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth);

export interface Box { x: number; y: number; width: number; height: number; right: number; bottom: number }
export async function box(l: Locator): Promise<Box> {
  const b = await l.first().boundingBox();
  if (!b) throw new Error('element has no box');
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}
export const count = (l: Locator) => l.count();

/** Every element matching `sel` whose right edge is past `limit` (default viewport width) and is not inside a scroller. */
export async function pokingOut(page: Page, sel = 'body *', limit?: number): Promise<string[]> {
  return page.evaluate(
    ([s, lim]) => {
      const L = (lim as number | null) ?? innerWidth;
      const inScroller = (e: Element) => {
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
        }
        return false;
      };
      const out: string[] = [];
      for (const e of document.querySelectorAll(s as string)) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if ((r.right > L + 1 || r.left < -1) && !inScroller(e) && out.length < 8) out.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      return out;
    },
    [sel, limit ?? null] as const,
  );
}

/** WCAG contrast of the text colour of `el` against the first opaque background found going up the tree. */
export function contrastOf(l: Locator): Promise<number> {
  return l.first().evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const fg = parse(getComputedStyle(el).color);
    let bg = [255, 255, 255];
    for (let p: Element | null = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) { bg = c; break; }
    }
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

/** Word pairs in `root` whose boxes overlap (text overprint), excluding a node pair that is the same element. */
export function overprintPairs(root: Locator, gap = 0): Promise<string[]> {
  return root.first().evaluate((el, g) => {
    const rects: Array<{ t: string; r: DOMRect }> = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (!t) continue;
      const pe = (n as Text).parentElement;
      if (!pe || getComputedStyle(pe).visibility === 'hidden' || pe.closest('.ui-sr, .sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) rects.push({ t: t.slice(0, 24), r });
    }
    const out: string[] = [];
    for (let i = 0; i < rects.length && out.length < 6; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!.r, b = rects[j]!.r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left) - g;
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) - g;
        if (ox > 1 && oy > 2) { out.push(`"${rects[i]!.t}" x "${rects[j]!.t}"`); break; }
      }
    }
    return out;
  }, gap);
}

export const expectNoOverflow = async (page: Page, label = '') => expect(await pageOverflow(page), `page overflow ${label}`).toBeLessThanOrEqual(1);
