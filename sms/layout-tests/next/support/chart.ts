/** Chart measurements for the kit (`.ck-frame` > `.chart-frame` > `.chart-frame-body` > `svg.ck-svg`). Real layout only. */
import type { Page } from '@playwright/test';

export interface ChartFinding { chart: string; what: string }

/** Titles of every chart frame on the page (for messages). */
export const chartTitle = (el: Element) => (el.closest('.ck-frame')?.querySelector('.ck-title')?.textContent ?? el.getAttribute('aria-label') ?? 'chart').trim().slice(0, 40);

/** svg text elements that stick out of their svg by more than 0.5 px, per chart. */
export async function textOutsideSvg(page: Page, textSel = 'text'): Promise<ChartFinding[]> {
  return page.evaluate((sel) => {
    const out: ChartFinding[] = [];
    for (const svg of document.querySelectorAll('.ck-svg')) {
      const sr = svg.getBoundingClientRect();
      if (!sr.width) continue;
      const title = (svg.closest('.ck-frame')?.querySelector('.ck-title')?.textContent ?? 'chart').trim().slice(0, 40);
      for (const t of svg.querySelectorAll(sel)) {
        const r = t.getBoundingClientRect();
        if (!r.width) continue;
        if (r.right > sr.right + 0.5 || r.left < sr.left - 0.5) out.push({ chart: title, what: `"${(t.textContent ?? '').trim().slice(0, 18)}" ${Math.round(r.left - sr.left)}..${Math.round(r.right - sr.left)} of ${Math.round(sr.width)}` });
      }
    }
    return out.slice(0, 8);
  }, textSel);
}

/** Adjacent x-axis labels whose boxes overlap (gap < 0), per chart. */
export async function xLabelCollisions(page: Page): Promise<ChartFinding[]> {
  return page.evaluate(() => {
    const out: ChartFinding[] = [];
    for (const g of document.querySelectorAll('.ck-svg .ck-xlabels')) {
      const title = (g.closest('.ck-frame')?.querySelector('.ck-title')?.textContent ?? 'chart').trim().slice(0, 40);
      const boxes = [...g.querySelectorAll('text')].map((t) => ({ t: (t.textContent ?? '').trim(), r: t.getBoundingClientRect() })).filter((b) => b.r.width > 0).sort((a, b) => a.r.left - b.r.left);
      for (let i = 1; i < boxes.length; i++) {
        const gap = boxes[i]!.r.left - boxes[i - 1]!.r.right;
        if (gap < 0) out.push({ chart: title, what: `"${boxes[i - 1]!.t}" and "${boxes[i]!.t}" overlap by ${(-gap).toFixed(1)} px` });
      }
    }
    return out.slice(0, 8);
  });
}

/** Axis-title text boxes that intersect a tick label box (D8 / M-18): the unit label must clear the ticks. */
export async function titleTickIntersections(page: Page): Promise<ChartFinding[]> {
  return page.evaluate(() => {
    const out: ChartFinding[] = [];
    for (const svg of document.querySelectorAll('.ck-svg')) {
      const title = (svg.closest('.ck-frame')?.querySelector('.ck-title')?.textContent ?? 'chart').trim().slice(0, 40);
      const units = [...svg.querySelectorAll('.ck-unit-label')].map((t) => ({ t: (t.textContent ?? '').trim(), r: t.getBoundingClientRect() })).filter((b) => b.r.width > 0);
      const ticks = [...svg.querySelectorAll('.ck-tick')].map((t) => ({ t: (t.textContent ?? '').trim(), r: t.getBoundingClientRect() })).filter((b) => b.r.width > 0);
      for (const u of units) for (const k of ticks) {
        const ox = Math.min(u.r.right, k.r.right) - Math.max(u.r.left, k.r.left);
        const oy = Math.min(u.r.bottom, k.r.bottom) - Math.max(u.r.top, k.r.top);
        if (ox > 0.5 && oy > 0.5) out.push({ chart: title, what: `axis title "${u.t}" overlaps tick "${k.t}"` });
      }
    }
    return out.slice(0, 8);
  });
}
