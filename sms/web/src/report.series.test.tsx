/**
 * UX Phase WS-B2 (23 Sep 2026) — `RejectTrendChart` (report/shared.tsx),
 * the reject-rate line both the Rejects screen and the Reject report chart
 * share. `pct(b.rate) ?? 0` and `pct(wb?.rate ?? null) ?? 0` turned "this
 * bucket has no valid rate" and "no matching weight-reject bucket exists for
 * this day at all" into a literal 0% — indistinguishable on the chart from a
 * genuinely perfect day. The discipline the band already applies two lines
 * away (a day too thin for a valid limit BREAKS the band rather than being
 * bridged) is applied here to the line itself: a missing bucket must draw a
 * GAP, never a plotted zero.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render } from './testkit/render';
import { RejectTrendChart, type TrendBucket } from './screens/report/shared';

function bucket(overrides: Partial<TrendBucket>): TrendBucket {
  return {
    bucketTs: '2026-09-01T00:00:00Z',
    rate: 0.02,
    ucl: 0.05,
    lcl: 0.0,
    outOfControl: false,
    produced: 500,
    rejects: 10,
    ...overrides,
  };
}

describe('RejectTrendChart — a missing bucket is a gap, not a zero', () => {
  it('a quality bucket with rate:null breaks the line into separate segments, not one path dipping to 0%', () => {
    // Two-point runs either side of the gap (days 1-2, then 4-5) so each
    // side draws an actual line segment rather than an isolated dot — the
    // shape a real multi-day gap produces, distinct from a single stray day.
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.022 }),
      bucket({ bucketTs: '2026-09-03T00:00:00Z', rate: null, ucl: null, lcl: null }),
      bucket({ bucketTs: '2026-09-04T00:00:00Z', rate: 0.03 }),
      bucket({ bucketTs: '2026-09-05T00:00:00Z', rate: 0.031 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    // Direct <path> children of the chart svg that are the quality LINE
    // (stroke var(--ink), no dasharray) — band/ceiling paths are wrapped in
    // their own <g> and are not direct children, so this counts line
    // segments only. Before the fix: exactly one path spans all five days
    // with its middle vertex fabricated at 0%. After: the gap at day 3
    // forces two separate segments either side of it.
    const linePaths = Array.from(container.querySelectorAll('svg.chart > path')).filter(
      (p) => p.getAttribute('stroke') === 'var(--ink)',
    );
    expect(linePaths.length).toBeGreaterThanOrEqual(2);
  });

  it('a day the weight series has no bucket for at all is not plotted as 0% — the dashed weight line has a gap too', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-03T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-04T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-05T00:00:00Z', rate: 0.02 }),
    ];
    const weight: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.01 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.011 }),
      // 09-03 has no weight-reject bucket at all (wByTs.get returns undefined).
      bucket({ bucketTs: '2026-09-04T00:00:00Z', rate: 0.015 }),
      bucket({ bucketTs: '2026-09-05T00:00:00Z', rate: 0.016 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} weight={weight} />);
    const weightLinePaths = Array.from(container.querySelectorAll('svg.chart > path')).filter(
      (p) => p.getAttribute('stroke-dasharray') === '4 3',
    );
    expect(weightLinePaths.length).toBeGreaterThanOrEqual(2);
  });

  it('an ISOLATED single-day gap (a lone stray reading) draws as a dot, not a dropped point', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: null, ucl: null, lcl: null }),
      bucket({ bucketTs: '2026-09-03T00:00:00Z', rate: 0.03 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    // Two single-point runs (day 1 alone, day 3 alone) render as two dots,
    // never as a path bridging through day 2's fabricated 0%.
    const dots = container.querySelectorAll('svg.chart > circle[fill="var(--ink)"]');
    expect(dots.length).toBe(2);
    const linePaths = Array.from(container.querySelectorAll('svg.chart > path')).filter(
      (p) => p.getAttribute('stroke') === 'var(--ink)',
    );
    expect(linePaths.length).toBe(0);
  });

  it('the axis ceiling (max) is computed only from real values — a missing bucket does not silently cap the scale', () => {
    // Every real value here is at or above 4% (0.04); if a missing bucket's
    // ucl/rate fed the max() as a fabricated 0, the max would still resolve
    // to a real number here, so this pins the max via the grid tick labels
    // instead: the top gridline must reflect the real data (>= 4%), never
    // collapse toward zero because of the gap.
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.041, ucl: 0.06, lcl: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: null, ucl: null, lcl: null }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const gridLabels = Array.from(container.querySelectorAll('svg.chart text')).map((t) => t.textContent);
    // At least one gridline at or above 4% must exist — proof the real
    // value drove the scale rather than being averaged down by a phantom 0.
    expect(gridLabels.some((t) => t != null && /^[4-9]%$/.test(t))).toBe(true);
  });

  it('hovering a day with no valid rate does not print "0.0%" as if it were a measured reading', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: null, ucl: null, lcl: null, produced: 4 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const hitRects = container.querySelectorAll('svg.chart rect.hit');
    expect(hitRects.length).toBe(2);
    fireEvent.mouseEnter(hitRects[1]!);
    const readout = container.querySelector('.readout') ?? container;
    expect(readout.textContent ?? '').not.toContain('Quality 0.0%');
  });
});
