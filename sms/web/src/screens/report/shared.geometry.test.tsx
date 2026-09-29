/**
 * Chart overhaul, wave 3, Task T5 (29 Sep 2026). Pure geometry proof for
 * `DeviationBars`' right-gutter labels (the zero line's and the threshold
 * lines') never landing on a bar — the screenshot defect this task exists to
 * close ("row median" drawn over the station bars because the chart only
 * ever reserved a fixed 8px right margin, whatever the label needed).
 *
 * Uses `deviationBarsGeometry`, the pure function the component itself calls
 * for its bar rects and its `placeGutterLabels`-derived label positions, so
 * this is the same math the rendered chart uses — no DOM, no ResizeObserver
 * stub width, just `chartLayout.ts`'s own `rectsIntersect`.
 */
import { describe, expect, it } from 'vitest';
import { rectsIntersect, textPx } from '../../ui/chartLayout';
import { deviationBarsGeometry, type DeviationRow } from './shared';

const FONT_PX = 12;

/** A generous estimate of a gutter label's own rendered box, built the same
 *  way `RefLine`'s gutter-mode text is actually drawn: left-anchored at
 *  `gutterX`, vertically centred on its own `y`. */
function labelBox(l: { text: string; y: number; gutterX: number }) {
  return { x: l.gutterX, y: l.y - FONT_PX, w: Math.ceil(textPx(l.text.length, FONT_PX)), h: FONT_PX * 1.6 };
}

function stationRows(n: number, lo: number, hi: number): DeviationRow[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `s${i + 1}`,
    label: `Station ${i + 1}`,
    tick: String(i + 1),
    value: lo + ((hi - lo) * i) / Math.max(1, n - 1),
  }));
}

describe('DeviationBars geometry: gutter labels never intersect a bar', () => {
  for (const width of [300, 600, 1200]) {
    it(`at width ${width}px — the screenshot case (14 stations, -20..+15, "row median")`, () => {
      const rows = stationRows(14, -20, 15);
      const { bars, labels } = deviationBarsGeometry(rows, {
        width,
        fontPx: FONT_PX,
        threshold: 9,
        thresholdLabel: 'Flag threshold',
        zeroLabel: 'row median',
      });
      expect(bars.length).toBe(14);
      // At the narrowest width the labels may legitimately fall back to the
      // legend (gutterFor returns 'legend' rather than clip the plot to
      // nothing) — that is itself the no-overlap answer, so this only
      // requires zero intersections over whatever labels ARE drawn in the
      // gutter, never that there must be some.
      for (const label of labels) {
        const box = labelBox(label);
        for (const bar of bars) {
          expect(rectsIntersect(box, bar)).toBe(false);
        }
      }
    });
  }

  it('two labels close together are pushed apart rather than overprinting (placeGutterLabels de-collision reaches the caller)', () => {
    // A flat set of rows so the zero line and a tight threshold sit only a
    // few px apart — the shape that, undefended, overprints the two labels.
    const rows = stationRows(6, -1, 1);
    const { labels } = deviationBarsGeometry(rows, {
      width: 600,
      fontPx: FONT_PX,
      height: 220,
      threshold: 1.2,
      thresholdLabel: 'Flag threshold',
      zeroLabel: 'row median',
    });
    expect(labels.length).toBe(2);
    const [a, b] = labels;
    expect(Math.abs(a!.y - b!.y)).toBeGreaterThanOrEqual(FONT_PX * 1.3 - 0.5);
  });

  it('falls back to a legend (no gutter labels) when the widest label would eat too much of a narrow chart', () => {
    const rows = stationRows(4, -5, 5);
    const { labels } = deviationBarsGeometry(rows, {
      width: 140,
      fontPx: FONT_PX,
      threshold: 9,
      thresholdLabel: 'A very long threshold label that will not fit',
      zeroLabel: 'row median',
    });
    expect(labels.length).toBe(0);
  });
});
