/**
 * THE HISTOGRAM X AXIS IS LINEAR IN VALUE. This file exists so an index
 * layout cannot silently return.
 *
 * It did once, and was harmless for as long as the server's bucket was wider
 * than the spread it was drawing: at one bar an index axis and a value axis
 * are the same picture. `b91f7d5` fixed the bucketing and the index layout
 * became a measurable lie — measured in the browser at 1366px on 23 Sep 2026,
 * the gen-3 sack chart drew 55.45 kg at x=775 and 49.15 kg at x=739, the same
 * 36px it gave the 0.05 kg step from 45.10 to 45.15. The first assertion
 * below is that 126:1 distortion, pinned.
 *
 * The bucket values in `GEN3_SACKS` and `GEN1_CONES` are not invented. They
 * are the real sparse payloads, read off the sidecar on 23 Sep 2026 by
 * running the same GROUP BY FLOOR(weight/@bucket) `weights.ts` runs, over
 * IFL's own generations only — epoch 10 (September copy, sacks) and epoch 1
 * (July copy, cones). Never epoch 13/14, which are the plant simulator.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
// `testkit/render` installs the shared DOM stubs and the per-test cleanup.
// Its ResizeObserver stub never fires, so `useChartWidth` keeps its own
// 1036px fallback — which is what every geometry assertion below is
// measured against. That is a harness fact, not a claim about any real
// viewport: the 1366px and 1920px behaviour was checked in the browser.
import { render } from '../../testkit/render';
import { Histogram, histogramView, type HistBucket } from './shared';

/** Gen 3 sacks, 0.05 kg buckets, n=3122. Strays at 45.1x and 55.45. */
const GEN3_SACKS: HistBucket[] = [
  { bucket: 45.1, count: 1 }, { bucket: 45.15, count: 2 }, { bucket: 45.25, count: 1 },
  { bucket: 45.3, count: 2 }, { bucket: 46.95, count: 8 }, { bucket: 47, count: 42 },
  { bucket: 47.05, count: 82 }, { bucket: 47.1, count: 250 }, { bucket: 47.15, count: 308 },
  { bucket: 47.2, count: 610 }, { bucket: 47.25, count: 513 }, { bucket: 47.3, count: 638 },
  { bucket: 47.35, count: 288 }, { bucket: 47.4, count: 243 }, { bucket: 47.45, count: 81 },
  { bucket: 47.5, count: 33 }, { bucket: 47.55, count: 12 }, { bucket: 47.6, count: 5 },
  { bucket: 48.35, count: 1 }, { bucket: 49.15, count: 1 }, { bucket: 55.45, count: 1 },
];

/** Gen 1 cones, 2 g buckets, n=142,290 — a clean bell with a thin tail. */
const GEN1_CONES: HistBucket[] = [
  [1744, 1], [1818, 1], [1850, 1], [1852, 1], [1876, 1], [1882, 1], [1884, 1], [1890, 2],
  [1892, 1], [1894, 3], [1898, 2], [1900, 3], [1902, 6], [1904, 9], [1906, 9], [1908, 8],
  [1910, 11], [1912, 15], [1914, 26], [1916, 40], [1918, 53], [1920, 73], [1922, 94],
  [1924, 147], [1926, 256], [1928, 402], [1930, 702], [1932, 1166], [1934, 1885],
  [1936, 3033], [1938, 4354], [1940, 6044], [1942, 7864], [1944, 9621], [1946, 11462],
  [1948, 12990], [1950, 13368], [1952, 13579], [1954, 12508], [1956, 11038], [1958, 9360],
  [1960, 7158], [1962, 5267], [1964, 3521], [1966, 2363], [1968, 1506], [1970, 909],
  [1972, 562], [1974, 334], [1976, 198], [1978, 93], [1980, 80], [1982, 43], [1984, 37],
  [1986, 20], [1988, 14], [1990, 13], [1992, 7], [1994, 2], [2000, 3], [2002, 2], [2004, 2],
  [2006, 2], [2012, 1], [2016, 1], [2020, 1], [2022, 1], [2030, 1], [2032, 2], [2038, 1],
  [2040, 1], [2042, 1], [2048, 1], [2086, 1], [2094, 1],
].map(([bucket, count]) => ({ bucket: bucket as number, count: count as number }));

/** Bar centres, keyed by the bucket value they claim to stand for. */
function barCentres(container: HTMLElement, buckets: HistBucket[], size: number): Map<number, number> {
  const rects = [...container.querySelectorAll('rect')];
  const drawn = histogramView(buckets, size).drawn;
  expect(rects.length).toBe(drawn.length);
  return new Map(drawn.map((b, i) => {
    const r = rects[i]!;
    return [b.bucket, Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2];
  }));
}

describe('histogram x axis is linear in value, not in index', () => {
  it('spaces bars in proportion to the gap between their VALUES', () => {
    // A contiguous run with one deliberate hole: 10, 11, 12, then 20.
    const buckets: HistBucket[] = [
      { bucket: 10, count: 5 }, { bucket: 11, count: 90 }, { bucket: 12, count: 5 }, { bucket: 20, count: 4 },
    ];
    // The hole is 7 empty buckets — inside CORE_GAP_BUCKETS, so nothing is
    // clipped and all four bars must be drawn on one linear axis.
    const v = histogramView(buckets, 1);
    expect(v.below).toBeNull();
    expect(v.above).toBeNull();
    expect(v.drawn).toHaveLength(4);

    const { container } = render(<Histogram buckets={buckets} bucketSize={1} unit="" label="t" />);
    const c = barCentres(container, buckets, 1);
    const d1011 = c.get(11)! - c.get(10)!;
    const d1220 = c.get(20)! - c.get(12)!;
    // Eight times the value gap must be eight times the distance. An index
    // layout gives both the same slot and this ratio comes out at 1.
    expect(d1220 / d1011).toBeCloseTo(8, 1);
  });

  it('gen-3 sacks: 55.45 no longer sits one slot from 49.15', () => {
    const { container } = render(<Histogram buckets={GEN3_SACKS} bucketSize={0.05} unit="" label="t" />);
    // The two 1-count strays at 48.35/49.15/55.45 and the 45.1x cluster are
    // outside the drawn core, so they cannot be drawn adjacent to anything.
    const v = histogramView(GEN3_SACKS, 0.05);
    expect(v.lo).toBeCloseTo(46.95, 5);
    expect(v.hi).toBeCloseTo(47.65, 5);
    expect(v.below).toEqual({ count: 6, extremeBucket: 45.1 });
    expect(v.above).toEqual({ count: 3, extremeBucket: 55.45 });
    // 9 of 3122 = 0.29 %, well inside MAX_OVERFLOW_SHARE.
    expect(container.querySelectorAll('rect')).toHaveLength(14);
    // And every one of the nine is stated on screen, with both extremes.
    const note = screen.getByText(/Axis clipped/);
    expect(note.textContent).toContain('6 below 46.95');
    expect(note.textContent).toContain('45.10');
    expect(note.textContent).toContain('3 above 47.65');
    expect(note.textContent).toContain('55.45');
    expect(note.textContent).toMatch(/still counted/);
  });

  it('gen-3 sacks: within the core, distance is still proportional to value', () => {
    const { container } = render(<Histogram buckets={GEN3_SACKS} bucketSize={0.05} unit="" label="t" />);
    const c = barCentres(container, GEN3_SACKS, 0.05);
    const one = c.get(47)! - c.get(46.95)!;
    expect(c.get(47.6)! - c.get(46.95)!).toBeCloseTo(one * 13, 1);
  });

  it('gen-1 cones: the sparse tail keeps its true positions', () => {
    const v = histogramView(GEN1_CONES, 2);
    // 1852 -> 1876 is 11 empty buckets and 2048 -> 2086 is 18: both past the
    // gap threshold, so four readings below and two above are named, not drawn.
    expect(v.lo).toBe(1876);
    expect(v.hi).toBe(2050);
    expect(v.below).toEqual({ count: 4, extremeBucket: 1744 });
    expect(v.above).toEqual({ count: 2, extremeBucket: 2094 });

    const { container } = render(<Histogram buckets={GEN1_CONES} bucketSize={2} unit="" label="t" />);
    const c = barCentres(container, GEN1_CONES, 2);
    // 1994 -> 2000 is three buckets of value; an index layout draws it as one.
    const step = c.get(1952)! - c.get(1950)!;
    expect(c.get(2000)! - c.get(1994)!).toBeCloseTo(step * 3, 1);
    // Nothing collapses: the drawn span is the core's, in buckets.
    expect(container.querySelectorAll('rect')).toHaveLength(v.drawn.length);
  });

  it('never renders a bar narrower than 2px, even at the full core width', () => {
    const { container } = render(<Histogram buckets={GEN1_CONES} bucketSize={2} unit="" label="t" />);
    for (const r of container.querySelectorAll('rect')) {
      expect(Number(r.getAttribute('width'))).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('histogramView refuses to clip when clipping would mislead', () => {
  it('draws the full range when the outside share is a second population', () => {
    // Two equal mounds far apart: clipping either would hide half the data.
    const buckets: HistBucket[] = [
      { bucket: 0, count: 100 }, { bucket: 1, count: 200 }, { bucket: 2, count: 100 },
      { bucket: 60, count: 100 }, { bucket: 61, count: 190 }, { bucket: 62, count: 100 },
    ];
    const v = histogramView(buckets, 1);
    expect(v.below).toBeNull();
    expect(v.above).toBeNull();
    expect(v.drawn).toHaveLength(6);
    expect(v.lo).toBe(0);
    expect(v.hi).toBe(63);
  });

  it('draws the full range when clipping would save almost no width', () => {
    const buckets: HistBucket[] = [
      { bucket: 0, count: 1 },
      ...Array.from({ length: 40 }, (_, i) => ({ bucket: 20 + i, count: 100 })),
    ];
    // The core is 40 of a 60-bucket range — a 33 % saving is over the floor,
    // so this one DOES clip; widen the body and it must stop.
    expect(histogramView(buckets, 1).below).not.toBeNull();
    const wide: HistBucket[] = [
      { bucket: 0, count: 1 },
      ...Array.from({ length: 120 }, (_, i) => ({ bucket: 20 + i, count: 100 })),
    ];
    expect(histogramView(wide, 1).below).toBeNull();
  });

  it('a single bucket is one bar and never clipped', () => {
    const v = histogramView([{ bucket: 47, count: 5000 }], 0.05);
    expect(v.drawn).toHaveLength(1);
    expect(v.below).toBeNull();
    expect(v.above).toBeNull();
    expect(v.hi - v.lo).toBeCloseTo(0.05, 5);
  });

  it('renders no clipping sentence when nothing is clipped', () => {
    render(<Histogram buckets={[{ bucket: 10, count: 3 }, { bucket: 11, count: 9 }, { bucket: 12, count: 3 }]} bucketSize={1} unit="" label="t" />);
    expect(screen.queryByText(/Axis clipped/)).toBeNull();
  });
});
