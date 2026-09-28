import { describe, expect, it } from 'vitest';
import {
  bandHit,
  brushToIndices,
  gutterFor,
  nearestIndex,
  packRow,
  placeGutterLabels,
  placeTip,
  rectsIntersect,
  rowHit,
  textPx,
} from './chartLayout';

describe('textPx', () => {
  it('grows with character count and font size', () => {
    expect(textPx(0, 12)).toBe(4);
    expect(textPx(5, 10)).toBeCloseTo(5 * 10 * 0.6 + 4);
    expect(textPx(10, 12)).toBeGreaterThan(textPx(5, 12));
  });
});

describe('placeGutterLabels', () => {
  it('spreads three labels that share the same y', () => {
    const out = placeGutterLabels(
      [
        { y: 100, text: 'a' },
        { y: 100, text: 'b' },
        { y: 100, text: 'c' },
      ],
      { top: 0, bottom: 300, lineH: 14 },
    );
    expect(out).toHaveLength(3);
    const ys = out.map((o) => o.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(14);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(14);
    // At least the ones that moved report displaced.
    expect(out.some((o) => o.displaced)).toBe(true);
  });

  it('clamps labels at the top and bottom edges', () => {
    const out = placeGutterLabels(
      [
        { y: -50, text: 'top' },
        { y: 500, text: 'bottom' },
      ],
      { top: 0, bottom: 100, lineH: 14 },
    );
    for (const o of out) {
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThanOrEqual(100);
    }
  });

  it('drops the lowest-prio labels when they cannot all fit', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ y: 50, text: `L${i}`, prio: i === 0 ? 5 : 0 }));
    const out = placeGutterLabels(items, { top: 0, bottom: 40, lineH: 14 });
    // Column of height 40 with lineH 14 cannot fit 10 labels.
    const dropped = out.filter((o) => o.displaced && o.text === '');
    expect(dropped.length).toBeGreaterThan(0);
    // The high-prio label (index 0) must survive.
    expect(out[0]!.text).toBe('L0');
  });

  it('returns results in input order', () => {
    const out = placeGutterLabels(
      [
        { y: 40, text: 'second' },
        { y: 10, text: 'first' },
      ],
      { top: 0, bottom: 100, lineH: 14 },
    );
    expect(out[0]!.text).toBe('second');
    expect(out[1]!.text).toBe('first');
  });

  it('handles empty input', () => {
    expect(placeGutterLabels([], { top: 0, bottom: 100, lineH: 14 })).toEqual([]);
  });
});

describe('packRow', () => {
  it('leaves non-colliding labels on row 0 with their original anchor', () => {
    const out = packRow(
      [
        { x: 10, w: 20, anchor: 'start', text: 'a' },
        { x: 200, w: 20, anchor: 'start', text: 'b' },
      ],
      [0, 400],
    );
    expect(out.every((o) => o.row === 0)).toBe(true);
    expect(out.every((o) => !o.overflow)).toBe(true);
  });

  it('flips anchor to resolve a collision before moving rows', () => {
    // item0 occupies [0,20]. item1, anchored 'end' at x=25, would naturally
    // span [-35,25] and overlap item0; flipping to 'start' spans [25,85]
    // instead, clearing item0 without needing a second row.
    const out = packRow(
      [
        { x: 0, w: 20, anchor: 'start', text: 'a' },
        { x: 25, w: 60, anchor: 'end', text: 'b' },
      ],
      [0, 200],
    );
    expect(out[1]!.row).toBe(0);
    expect(out[1]!.anchor).toBe('start');
    expect(out[1]!.overflow).toBe(false);
  });

  it('moves to a second row when flipping cannot resolve the collision', () => {
    const out = packRow(
      [
        { x: 0, w: 100, anchor: 'middle', text: 'a' },
        { x: 10, w: 100, anchor: 'middle', text: 'b' },
      ],
      [0, 200],
    );
    expect(out[0]!.row).toBe(0);
    expect(out[1]!.row).toBe(1);
  });

  it('marks overflow when even a second row cannot resolve it', () => {
    const out = packRow(
      [
        { x: 0, w: 300, anchor: 'middle', text: 'a' },
        { x: 5, w: 300, anchor: 'middle', text: 'b' },
        { x: 10, w: 300, anchor: 'middle', text: 'c' },
      ],
      [0, 400],
    );
    expect(out.some((o) => o.overflow)).toBe(true);
  });

  it('marks overflow for a label that falls outside the range', () => {
    const out = packRow([{ x: -100, w: 20, anchor: 'middle', text: 'a' }], [0, 400]);
    expect(out[0]!.overflow).toBe(true);
  });
});

describe('gutterFor', () => {
  it('sizes the gutter to the widest label', () => {
    const g = gutterFor(['x', 'row median'], 11, 600);
    expect(typeof g).toBe('number');
    expect(g as number).toBeGreaterThan(textPx(1, 11));
  });

  it('falls back to legend when the gutter would exceed 30% of plot width', () => {
    const g = gutterFor(['a very long reference line label indeed'], 14, 100);
    expect(g).toBe('legend');
  });

  it('returns a small default gutter for no labels', () => {
    expect(gutterFor([], 12, 500)).toBe(8);
  });
});

describe('hit tests', () => {
  it('bandHit finds the containing band, including at slot edges', () => {
    // left=0, slot=10, n=5 -> bands [0,10) [10,20) ... [40,50)
    expect(bandHit(0, 0, 10, 5)).toBe(0);
    expect(bandHit(9.999, 0, 10, 5)).toBe(0);
    expect(bandHit(10, 0, 10, 5)).toBe(1);
    expect(bandHit(49.999, 0, 10, 5)).toBe(4);
    expect(bandHit(50, 0, 10, 5)).toBeNull(); // exactly at the far edge, outside
    expect(bandHit(-1, 0, 10, 5)).toBeNull();
    expect(bandHit(1000, 0, 10, 5)).toBeNull();
  });

  it('rowHit finds the containing row, including at row edges', () => {
    expect(rowHit(0, 0, 20, 3)).toBe(0);
    expect(rowHit(19.999, 0, 20, 3)).toBe(0);
    expect(rowHit(20, 0, 20, 3)).toBe(1);
    expect(rowHit(59.999, 0, 20, 3)).toBe(2);
    expect(rowHit(60, 0, 20, 3)).toBeNull();
    expect(rowHit(-5, 0, 20, 3)).toBeNull();
  });

  it('nearestIndex finds the closest x by binary search', () => {
    const xs = [0, 10, 20, 30, 40];
    expect(nearestIndex(0, xs)).toBe(0);
    expect(nearestIndex(4, xs)).toBe(0);
    expect(nearestIndex(6, xs)).toBe(1);
    expect(nearestIndex(40, xs)).toBe(4);
    expect(nearestIndex(1000, xs)).toBe(4);
    expect(nearestIndex(-1000, xs)).toBe(0);
    expect(nearestIndex(15, [5])).toBe(0);
    expect(nearestIndex(5, [])).toBe(-1);
  });
});

describe('rectsIntersect', () => {
  it('detects overlap and non-overlap, touching edges do not count', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
  });
});

describe('placeTip', () => {
  it('places to the right of the anchor by default', () => {
    const p = placeTip({ x: 50, y: 50 }, { w: 40, h: 20 }, { w: 400, h: 400 });
    expect(p.x).toBeGreaterThan(50);
  });

  it('flips left when the right side would overflow the frame', () => {
    const p = placeTip({ x: 390, y: 50 }, { w: 40, h: 20 }, { w: 400, h: 400 });
    expect(p.x).toBeLessThan(390);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 40).toBeLessThanOrEqual(400);
  });

  it('never intersects the mark rect, across a grid of anchor/mark positions', () => {
    const frame = { w: 300, h: 200 };
    const tip = { w: 60, h: 24 };
    for (let ax = 0; ax <= frame.w; ax += 15) {
      for (let ay = 0; ay <= frame.h; ay += 15) {
        const mark = { x: ax - 4, y: ay - 4, w: 8, h: 8 };
        const p = placeTip({ x: ax, y: ay }, tip, frame, mark);
        const box = { x: p.x, y: p.y, w: tip.w, h: tip.h };
        expect(rectsIntersect(box, mark)).toBe(false);
        // Stays inside the frame.
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + tip.w).toBeLessThanOrEqual(frame.w + 1e-6);
        expect(p.y + tip.h).toBeLessThanOrEqual(frame.h + 1e-6);
      }
    }
  });

  it('clamps inside the frame with no mark given', () => {
    const p = placeTip({ x: -100, y: -100 }, { w: 30, h: 10 }, { w: 200, h: 100 });
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });
});

describe('brushToIndices', () => {
  const xs = [0, 10, 20, 30, 40, 50];

  it('is order-independent', () => {
    expect(brushToIndices(10, 30, xs)).toEqual(brushToIndices(30, 10, xs));
    expect(brushToIndices(10, 30, xs)).toEqual([1, 3]);
  });

  it('returns null for an empty span (no point covered)', () => {
    expect(brushToIndices(12, 18, xs)).toBeNull();
  });

  it('returns null for an empty xs array', () => {
    expect(brushToIndices(0, 10, [])).toBeNull();
  });

  it('covers a single point as a single-index range', () => {
    expect(brushToIndices(9, 11, xs)).toEqual([1, 1]);
  });

  it('covers the whole domain', () => {
    expect(brushToIndices(-100, 1000, xs)).toEqual([0, 5]);
  });
});
