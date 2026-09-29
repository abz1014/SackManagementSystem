/**
 * Chart overhaul, Task T9 — geometry helpers for a REAL browser render.
 *
 * Everything here runs inside `page.evaluate` (real layout, real
 * `getBoundingClientRect`), never jsdom. Boxes are compared in *screen*
 * pixel space (not SVG user-space), which is the space a person actually
 * looks at, and which already accounts for the SVG's own `viewBox` scaling.
 *
 * `.chart-tip` (the hover/tap tooltip) is excluded from every check per the
 * task brief — it is expected to sit on top of the chart, and its own
 * "doesn't intersect the hovered mark" placement is asserted separately.
 */
import type { Page } from '@playwright/test';

export interface PlainBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TextMarkOverlap {
  text: string;
  textBox: PlainBox;
  markTag: string;
  markBox: PlainBox;
  frameLabel: string | null;
}

export interface TextTextOverlap {
  a: string;
  b: string;
  aBox: PlainBox;
  bBox: PlainBox;
  frameLabel: string | null;
}

export interface ChartOverlapReport {
  textMarkOverlaps: TextMarkOverlap[];
  textTextOverlaps: TextTextOverlap[];
  chartFrameCount: number;
  svgCount: number;
}

/**
 * Scans every `.chart-frame` on the page for:
 *  - a `<text>` bounding box intersecting a mark box (`rect`/`path`/`circle`)
 *  - a `<text>` bounding box intersecting another `<text>` bounding box
 * Both checked with `tolerancePx` shrunk off the text box first, so a
 * same-pixel touch (kerning, anti-aliasing) is not a false positive.
 */
export async function findChartOverlaps(page: Page, tolerancePx = 1): Promise<ChartOverlapReport> {
  return page.evaluate((tol) => {
    const toPlain = (r: DOMRect): any => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    const shrink = (r: any, t: number) => ({
      left: r.left + t,
      right: r.right - t,
      top: r.top + t,
      bottom: r.bottom - t,
    });
    const intersects = (a: any, b: any) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const textMarkOverlaps: any[] = [];
    const textTextOverlaps: any[] = [];
    const frames = Array.from(document.querySelectorAll('.chart-frame'));
    let svgCount = 0;

    for (const frame of frames) {
      const frameLabelEl = frame.querySelector('[role="img"][aria-label], .chart-frame-body[aria-label]');
      const frameLabel = frameLabelEl ? frameLabelEl.getAttribute('aria-label') : null;
      const svgs = Array.from(frame.querySelectorAll('svg'));
      for (const svg of svgs) {
        svgCount++;
        const texts = Array.from(svg.querySelectorAll('text')).filter((t) => !t.closest('.chart-tip'));
        const marks = Array.from(svg.querySelectorAll('rect, path, circle')).filter((m) => !m.closest('.chart-tip'));

        const textBoxes = texts
          .map((t) => ({ el: t, box: toPlain(t.getBoundingClientRect()), text: (t.textContent || '').trim() }))
          .filter((tb) => tb.box.width > 0 && tb.box.height > 0);
        const markBoxes = marks
          .map((m) => ({ el: m, box: toPlain(m.getBoundingClientRect()), tag: m.tagName.toLowerCase() }))
          .filter((mb) => mb.box.width > 0 && mb.box.height > 0);

        for (const tb of textBoxes) {
          const shrunk = shrink(tb.box, tol);
          for (const mb of markBoxes) {
            if (intersects(shrunk, mb.box)) {
              textMarkOverlaps.push({ text: tb.text, textBox: tb.box, markTag: mb.tag, markBox: mb.box, frameLabel });
            }
          }
        }
        for (let i = 0; i < textBoxes.length; i++) {
          for (let j = i + 1; j < textBoxes.length; j++) {
            const a = shrink(textBoxes[i]!.box, tol);
            const b = textBoxes[j]!.box;
            if (a.left === undefined) continue;
            if (intersects(a, b) && textBoxes[i]!.text !== textBoxes[j]!.text) {
              textTextOverlaps.push({
                a: textBoxes[i]!.text,
                b: textBoxes[j]!.text,
                aBox: textBoxes[i]!.box,
                bBox: textBoxes[j]!.box,
                frameLabel,
              });
            } else if (intersects(a, b) && textBoxes[i]!.text === textBoxes[j]!.text) {
              // Identical text at two DOM nodes overlapping is still a real
              // defect (duplicate label drawn twice in place) — keep it.
              textTextOverlaps.push({
                a: textBoxes[i]!.text,
                b: textBoxes[j]!.text,
                aBox: textBoxes[i]!.box,
                bBox: textBoxes[j]!.box,
                frameLabel,
              });
            }
          }
        }
      }
    }
    return { textMarkOverlaps, textTextOverlaps, chartFrameCount: frames.length, svgCount };
  }, tolerancePx);
}

/** viewBox width vs the SVG's own rendered clientWidth — "no scaling". */
export async function checkViewBoxMatchesClientWidth(
  page: Page,
): Promise<{ tag: string; viewBoxWidth: number; clientWidth: number; diff: number }[]> {
  return page.evaluate(() => {
    const out: any[] = [];
    const svgs = Array.from(document.querySelectorAll('.chart-frame svg'));
    for (const svg of svgs) {
      const vb = svg.getAttribute('viewBox');
      if (!vb) continue;
      const parts = vb.split(/\s+/).map(Number);
      const vbWidth = parts[2];
      const clientWidth = (svg as SVGSVGElement).clientWidth;
      if (!vbWidth || !clientWidth) continue;
      out.push({ tag: svg.getAttribute('aria-label') || 'svg', viewBoxWidth: vbWidth, clientWidth, diff: Math.abs(vbWidth - clientWidth) });
    }
    return out;
  });
}

/** The `font-size` (px) of every axis-tick `<text>` under `.chart-frame`. */
export async function readTickFontSizes(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('.chart-frame svg text'));
    return texts
      .map((t) => {
        const explicit = t.getAttribute('font-size');
        if (explicit) return parseFloat(explicit);
        return parseFloat(getComputedStyle(t as Element).fontSize);
      })
      .filter((n) => Number.isFinite(n) && n > 0);
  });
}
