/**
 * Chart overhaul, wave 3, Task T5 (29 Sep 2026): `RejectTrendChart`'s two end
 * labels ("Quality x%", "Weight y%") de-collide via `chartLayout.ts`'s
 * `placeGutterLabels` rather than being drawn at their literal y — a new file
 * rather than an addition to `report.series.test.tsx` (owned elsewhere).
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { RejectTrendChart, type TrendBucket } from './shared';

function bucket(ts: string, rate: number): TrendBucket {
  return { bucketTs: ts, rate, ucl: rate + 0.02, lcl: 0, outOfControl: false, produced: 500, rejects: Math.round(rate * 500) };
}

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
});
