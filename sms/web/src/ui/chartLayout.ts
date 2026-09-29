/**
 * Chart layout primitives — pure, side-effect-free geometry for the SVG
 * charts in `chart.tsx` and `screens/report/shared.tsx`. No React, no DOM:
 * everything here takes plain numbers/strings and returns plain numbers, so
 * it can be unit tested without a browser and reused by any chart.
 *
 * Built for the chart overhaul (wave 1, task T1, 28 Sep 2026): hover tips
 * that never cover the hovered mark, layouts that re-flow at any width, and
 * no text overlapping a mark or another label — today's concrete failure is
 * `DeviationBars`' "row median" / "Flag threshold" `RefLine` labels drawn
 * over the bars because the chart reserves only an 8px right margin.
 */

/* -------------------------------------------------------------- text width */

/**
 * A conservative estimate of a string's rendered width, in px, for a given
 * character count and font size. Matches the 0.58-0.6em-per-character advance
 * already used ad hoc in `chart.tsx` (`fittingTicks`) and `shared.tsx`, plus
 * a small padding allowance so two adjacent labels get a visible gap rather
 * than touching edges.
 */
export function textPx(chars: number, fontPx: number): number {
  const n = Math.max(0, chars);
  return n * fontPx * 0.6 + 4;
}

/* ----------------------------------------------------------- gutter labels */

export interface GutterLabelIn {
  y: number;
  text: string;
  /** Higher survives a drop first. Default 0. */
  prio?: number;
}

export interface GutterLabelOut {
  y: number;
  text: string;
  /** True when this label was moved off its natural y to avoid a collision,
   *  or dropped (still returned, with `y` clamped, `text: ''`, `displaced: true`)
   *  when it could not be placed at all. */
  displaced: boolean;
}

/**
 * Vertical de-collision for a column of labels sharing one x (a gutter of
 * RefLine labels, a column of y-axis annotations). Returns results in the
 * SAME order as `items`.
 *
 * Algorithm: sort by y, push labels down so consecutive gaps are at least
 * `lineH`, then sweep back up from the bottom so nothing is pushed past
 * `bottom` and gaps stay >= lineH walking upward too. If the column is too
 * short to fit everyone even after that, the lowest-`prio` labels are
 * dropped (in ascending prio order, ties broken by lowest original y) until
 * the rest fit; dropped labels are returned with `text: ''` and
 * `displaced: true` so a caller can skip rendering them while still knowing
 * they existed.
 */
export function placeGutterLabels(
  items: GutterLabelIn[],
  opt: { top: number; bottom: number; lineH: number },
): GutterLabelOut[] {
  const { top, bottom, lineH } = opt;
  if (items.length === 0) return [];

  type Working = { idx: number; y: number; text: string; prio: number; dropped: boolean };
  const working: Working[] = items.map((it, idx) => ({
    idx,
    y: clamp(it.y, top, bottom),
    text: it.text,
    prio: it.prio ?? 0,
    dropped: false,
  }));

  const span = Math.max(0, bottom - top);
  const capacity = lineH > 0 ? Math.floor(span / lineH) + 1 : working.length;

  // Drop lowest-prio labels (ties: lower original y first, i.e. earlier in
  // the sorted-by-y order) until what remains can possibly fit.
  const order = [...working].sort((a, b) => a.y - b.y || a.idx - b.idx);
  if (order.length > Math.max(1, capacity)) {
    const dropCount = order.length - Math.max(1, capacity);
    const byPrio = [...order].sort((a, b) => a.prio - b.prio || a.y - b.y);
    for (let i = 0; i < dropCount; i++) byPrio[i]!.dropped = true;
  }

  const kept = order.filter((w) => !w.dropped);

  // Push down: walk top to bottom, enforce minimum gap.
  for (let i = 1; i < kept.length; i++) {
    const min = kept[i - 1]!.y + lineH;
    if (kept[i]!.y < min) kept[i]!.y = min;
  }
  // Clamp bottom, then sweep back up so nothing overshoots `bottom` and gaps
  // still hold walking upward.
  if (kept.length > 0) {
    const last = kept[kept.length - 1]!;
    if (last.y > bottom) last.y = bottom;
    for (let i = kept.length - 2; i >= 0; i--) {
      const max = kept[i + 1]!.y - lineH;
      if (kept[i]!.y > max) kept[i]!.y = max;
    }
  }
  // Final clamp into [top, bottom] in case the column is shorter than one
  // line height.
  for (const w of kept) w.y = clamp(w.y, top, bottom);

  const byIdx = new Map<number, Working>();
  for (const w of working) byIdx.set(w.idx, w);

  return items.map((_, idx) => {
    const w = byIdx.get(idx)!;
    if (w.dropped) return { y: w.y, text: '', displaced: true };
    // "displaced" also covers a kept label moved off its natural y.
    const naturalY = clamp(items[idx]!.y, top, bottom);
    return { y: w.y, text: w.text, displaced: w.y !== naturalY };
  });
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/* --------------------------------------------------------------- packRow */

export interface PackRowIn {
  x: number;
  w: number;
  anchor: 'start' | 'middle' | 'end';
  text: string;
}

export interface PackRowOut {
  x: number;
  anchor: 'start' | 'middle' | 'end';
  row: 0 | 1;
  overflow: boolean;
}

/**
 * Horizontal de-collision for a row of x-axis-style labels within `range`.
 * Order matches `items`. For each label in turn (left to right by its
 * computed left/right edge), if it would overlap the previous label ON THE
 * SAME ROW: first try flipping its anchor (start/end swap, or middle tried
 * last), then move it to row 1, then — if row 1 is already occupied at that
 * x too — mark `overflow: true` and leave it in place on row 1.
 */
export function packRow(items: PackRowIn[], range: [number, number]): PackRowOut[] {
  const [lo, hi] = range;
  const out: PackRowOut[] = items.map((it) => ({ x: it.x, anchor: it.anchor, row: 0 as const, overflow: false }));

  const edges = (x: number, w: number, anchor: 'start' | 'middle' | 'end'): [number, number] => {
    if (anchor === 'start') return [x, x + w];
    if (anchor === 'end') return [x - w, x];
    return [x - w / 2, x + w / 2];
  };

  // Track the previous placed label's edges per row.
  const lastEdge: Record<0 | 1, [number, number] | null> = { 0: null, 1: null };

  // Process in x order for a stable left-to-right sweep, but write results
  // back to the original index.
  const orderIdx = items.map((_, i) => i).sort((a, b) => items[a]!.x - items[b]!.x);

  for (const i of orderIdx) {
    const it = items[i]!;
    let anchor = it.anchor;
    let e = edges(it.x, it.w, anchor);

    const collides = (edge: [number, number], other: [number, number] | null) => !!other && edge[0] < other[1];

    let row: 0 | 1 = 0;
    let placed = false;

    if (!collides(e, lastEdge[0])) {
      placed = true;
    } else {
      // Try flipping anchor on row 0.
      const flipped = anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : anchor;
      if (flipped !== anchor) {
        const e2 = edges(it.x, it.w, flipped);
        if (!collides(e2, lastEdge[0])) {
          anchor = flipped;
          e = e2;
          placed = true;
        }
      }
    }

    if (!placed) {
      // Move to row 1, with the original anchor.
      anchor = it.anchor;
      e = edges(it.x, it.w, anchor);
      row = 1;
      if (!collides(e, lastEdge[1])) {
        placed = true;
      } else {
        const flipped = anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : anchor;
        if (flipped !== anchor) {
          const e2 = edges(it.x, it.w, flipped);
          if (!collides(e2, lastEdge[1])) {
            anchor = flipped;
            e = e2;
            placed = true;
          }
        }
      }
    }

    const overRange = e[0] < lo || e[1] > hi;
    lastEdge[row] = e;
    out[i] = { x: it.x, anchor, row, overflow: !placed || overRange };
  }

  return out;
}

/* ---------------------------------------------------------------- gutterFor */

/**
 * The right-margin width (px) needed to fit a column of reference-line
 * labels without clipping, given the widest label. Returns the string
 * `'legend'` instead of a number when that width would exceed 30% of
 * `plotWidth` — past that point a right-margin gutter eats too much of the
 * chart, and the caller should fall back to a legend/disclosure instead.
 */
export function gutterFor(labels: string[], fontPx: number, plotWidth: number): number | 'legend' {
  const widest = labels.reduce((m, s) => Math.max(m, s.length), 0);
  if (widest === 0) return 8;
  const w = Math.ceil(textPx(widest, fontPx)) + 8; // 8px gap from the plot edge
  if (plotWidth > 0 && w > plotWidth * 0.3) return 'legend';
  return w;
}

/* ------------------------------------------------------------------ hit tests */

/** Which of `n` equal-width bars/bands (left edge `left`, each `slot` wide)
 *  contains `px`. `null` outside [left, left + n*slot). */
export function bandHit(px: number, left: number, slot: number, n: number): number | null {
  if (n <= 0 || slot <= 0) return null;
  if (px < left) return null;
  const i = Math.floor((px - left) / slot);
  if (i < 0 || i >= n) return null;
  return i;
}

/** Which of `n` equal-height rows (top edge `top`, each `rowH` tall)
 *  contains `py`. `null` outside [top, top + n*rowH). */
export function rowHit(py: number, top: number, rowH: number, n: number): number | null {
  if (n <= 0 || rowH <= 0) return null;
  if (py < top) return null;
  const i = Math.floor((py - top) / rowH);
  if (i < 0 || i >= n) return null;
  return i;
}

/** The index of the `xs` entry nearest to `px`, by binary search. `xs` must
 *  be sorted ascending. Ties go to the earlier (lower) index. */
export function nearestIndex(px: number, xs: number[]): number {
  const n = xs.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < px) lo = mid;
    else hi = mid;
  }
  const dLo = Math.abs(xs[lo]! - px);
  const dHi = Math.abs(xs[hi]! - px);
  return dHi < dLo ? hi : lo;
}

/* ------------------------------------------------------------------- rects */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether two axis-aligned rects overlap (touching edges do not count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* ------------------------------------------------------------------ tooltip */

/**
 * Where to draw a `tip.w` x `tip.h` tooltip box anchored near `{x, y}`
 * inside a `frame.w` x `frame.h` viewport, such that it never intersects
 * `mark` (the hovered data mark's own rect) and never runs outside the
 * frame. Preference order: right of the anchor; if that overflows the
 * frame's right edge, flip to the left; then clamp fully inside the frame.
 * If the clamped box would still intersect `mark`, the box is moved above
 * the mark if there is room, else below it, then re-clamped.
 */
export function placeTip(
  anchor: { x: number; y: number },
  tip: { w: number; h: number },
  frame: { w: number; h: number },
  mark?: Rect,
): { x: number; y: number } {
  const gap = 8;
  let x = anchor.x + gap;
  let y = anchor.y - tip.h / 2;

  // Flip left if placing to the right overflows the frame.
  if (x + tip.w > frame.w) {
    const flippedX = anchor.x - gap - tip.w;
    x = flippedX;
  }

  x = clamp(x, 0, Math.max(0, frame.w - tip.w));
  y = clamp(y, 0, Math.max(0, frame.h - tip.h));

  if (mark) {
    const box: Rect = { x, y, w: tip.w, h: tip.h };
    if (rectsIntersect(box, mark)) {
      // Try above the mark first.
      const above = mark.y - gap - tip.h;
      const below = mark.y + mark.h + gap;
      if (above >= 0) {
        y = above;
      } else if (below + tip.h <= frame.h) {
        y = below;
      } else {
        // No room either side within the frame: clamp and accept whichever
        // side overlaps least — prefer above, clamped to the frame top.
        y = clamp(above, 0, Math.max(0, frame.h - tip.h));
      }
      y = clamp(y, 0, Math.max(0, frame.h - tip.h));

      // Re-check horizontal: with y moved, x may still collide if the mark
      // is wide; re-clamp x away from the mark when possible within frame.
      const box2: Rect = { x, y, w: tip.w, h: tip.h };
      if (rectsIntersect(box2, mark)) {
        // Last resort: push x to whichever side of the mark fits, or clamp.
        const rightOfMark = mark.x + mark.w + gap;
        const leftOfMark = mark.x - gap - tip.w;
        if (rightOfMark + tip.w <= frame.w) x = rightOfMark;
        else if (leftOfMark >= 0) x = leftOfMark;
        x = clamp(x, 0, Math.max(0, frame.w - tip.w));
      }
    }
  }

  return { x, y };
}

