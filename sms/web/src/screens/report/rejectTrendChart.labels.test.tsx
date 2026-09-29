/**
 * Chart overhaul, wave 3, Task T5 (29 Sep 2026): `RejectTrendChart`'s two end
 * labels ("Quality x%", "Weight y%") de-collide via `chartLayout.ts`'s
 * `placeGutterLabels` rather than being drawn at their literal y — a new file
 * rather than an addition to `report.series.test.tsx` (owned elsewhere).
 *
 * Layout defect fix (chart overhaul wave 3, Task T9 follow-up, 29 Sep 2026):
 * the `lineH` handed to `placeGutterLabels` was a bare `14`, and the labels
 * themselves were drawn at a fixed `var(--fs-small)` CSS size — neither
 * tracked the chart's actual MEASURED font size (`ChartFrameSize.fontPx`,
 * `13` at 1x, `16.9` at the Wall's 1.3x `--ui-scale`), so at any font size
 * above ~10.7px the two end labels could be placed closer together than one
 * real text line, and a real-browser run (`layout-tests/charts.spec.ts`)
 * caught them overlapping. The tests below use the two real `fontPx` values
 * this app actually renders at, not an arbitrary constant, and assert the
 * de-collided gap is at least `fontPx * 1.3` — the same multiplier
 * `RefLineGutterProvider` already uses for the identical problem.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { RejectTrendChart, type TrendBucket } from './shared';

function bucket(ts: string, rate: number): TrendBucket {
  return { bucketTs: ts, rate, ucl: rate + 0.02, lcl: 0, outOfControl: false, produced: 500, rejects: Math.round(rate * 500) };
}

afterEach(() => {
  document.documentElement.style.removeProperty('--ui-scale');
});

describe('RejectTrendChart: the two end labels never overprint each other', () => {
  it('equal quality/weight rates on the last day are pushed apart, not stacked on the same y', () => {
    const quality: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.03), bucket('2026-09-02T00:00:00Z', 0.03)];
    const weight: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.03), bucket('2026-09-02T00:00:00Z', 0.03)];
    const { container } = render(<RejectTrendChart quality={quality} weight={weight} />);
    const svg = container.querySelector('svg.chart')!;
    const texts = Array.from(svg.querySelectorAll('text')).filter(
      (t) => t.textContent?.includes('%') && (t.getAttribute('fill') === 'var(--ink)' || t.getAttribute('fill') === 'var(--graphite)'),
    );
    const endLabels = texts.filter((t) => Number(t.getAttribute('x')) > Number(svg.getAttribute('viewBox')!.split(' ')[2]) * 0.6);
    expect(endLabels.length).toBe(2);
    const ys = endLabels.map((t) => Number(t.getAttribute('y')));
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThan(0);
  });

  it('one series only: a single end label still renders at its own value', () => {
    const quality: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.02), bucket('2026-09-02T00:00:00Z', 0.05)];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const svg = container.querySelector('svg.chart')!;
    expect(svg.textContent).toContain('Quality 5.0%');
  });

  it('renders the "limits worked out over" caption naming the series span', () => {
    const quality: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.02), bucket('2026-09-05T00:00:00Z', 0.05)];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    expect(container.textContent).toContain('Limits are worked out over the period shown');
  });

  /** Both end labels, sorted by their y regardless of which series drew
   *  first — the DOM order is quality-then-weight, but `placeGutterLabels`
   *  may push either one up or down depending on which had priority. */
  function endLabelYsAndFontSizes(container: HTMLElement): { ys: number[]; fontPx: number } {
    const svg = container.querySelector('svg.chart')!;
    const width = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    const texts = Array.from(svg.querySelectorAll('text')).filter(
      (t) => t.textContent?.includes('%') && Number(t.getAttribute('x')) > width * 0.6,
    );
    expect(texts.length).toBe(2);
    const ys = texts.map((t) => Number(t.getAttribute('y'))).sort((a, b) => a - b);
    const fontPxs = new Set(texts.map((t) => Number(t.getAttribute('font-size'))));
    // Both end labels must render at the SAME size — and that size is what
    // the lineH gap below is measured against.
    expect(fontPxs.size).toBe(1);
    return { ys, fontPx: [...fontPxs][0]! };
  }

  it('at the default 13px fontPx, two close end values are separated by at least fontPx * 1.3', () => {
    // Rates close enough that the OLD fixed lineH=14 (< 13*1.3=16.9) let
    // them land under one real text line apart.
    const quality: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.03), bucket('2026-09-02T00:00:00Z', 0.0301)];
    const weight: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.03), bucket('2026-09-02T00:00:00Z', 0.0301)];
    const { container } = render(<RejectTrendChart quality={quality} weight={weight} />);
    const { ys, fontPx } = endLabelYsAndFontSizes(container);
    expect(fontPx).toBe(13); // useChartSize's BASE_FONT_PX at --ui-scale unset (1x)
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(fontPx * 1.3 - 1e-6);
  });

  it('at the Wall\'s 1.3x --ui-scale (fontPx 16.9), the gap scales with the real rendered size, not a fixed constant', () => {
    document.documentElement.style.setProperty('--ui-scale', '1.3');
    const quality: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.03), bucket('2026-09-02T00:00:00Z', 0.0301)];
    const weight: TrendBucket[] = [bucket('2026-09-01T00:00:00Z', 0.03), bucket('2026-09-02T00:00:00Z', 0.0301)];
    const { container } = render(<RejectTrendChart quality={quality} weight={weight} />);
    const { ys, fontPx } = endLabelYsAndFontSizes(container);
    expect(fontPx).toBeCloseTo(16.9, 5);
    // The old fixed lineH=14 would have failed this at 16.9px fontPx even
    // though it happened to pass at the default 13px — this is exactly the
    // case a fixed constant cannot cover.
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(fontPx * 1.3 - 1e-6);
  });
});
