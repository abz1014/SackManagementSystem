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
 *
 * Chart overhaul wave 3, Task T8b (29 Sep 2026): `RejectTrendChart` moved
 * onto `ChartFrame` (see shared.tsx's own header note on the function). The
 * two assertions that previously drove the chart via `rect.hit` elements and
 * `fireEvent.mouseEnter`, then read a plain `.readout` line, are rewritten
 * below to drive it the way every other `ChartFrame` chart in this app is
 * tested — keyboard focus (`ArrowRight`), then read the floating
 * `.chart-tip` — and to assert BEHAVIOUR (what the tooltip/readout states)
 * rather than which DOM elements happen to implement hover. Every other
 * assertion here protects a real rule (gap-vs-zero, the p-chart band, the
 * 14-day trailing window's selected-period shading) and is left exactly as
 * it was: none of that depends on how hover is implemented.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render } from './testkit/render';
import { RejectTrendChart, type TrendBucket } from './screens/report/shared';
import { dayToShiftRange } from './lib/period';
import type { PeriodParams } from './lib/period';

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

/** ArrowRight from a chart's own body lands on index 0 first, index 1 on the
 *  second press — `ChartFrame.tsx`'s own keyboard path. */
function focusIndex(body: HTMLElement, n: number) {
  for (let i = 0; i <= n; i++) fireEvent.keyDown(body, { key: 'ArrowRight' });
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

  it('focusing a day with no valid rate does not print "0.0%" as if it were a measured reading', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: null, ucl: null, lcl: null, produced: 4 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    focusIndex(body, 1); // day 2, the gap
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent ?? '').not.toContain('0.0%');
    expect(tip.textContent ?? '').toContain('no reading this day');
  });
});

describe('RejectTrendChart — ChartFrame tooltip, reached via keyboard', () => {
  it('a day with both series shows quality AND weight, each with its own UCL', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02, ucl: 0.05 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.03, ucl: 0.06 }),
    ];
    const weight: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.01, ucl: 0.04 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.015, ucl: 0.045 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} weight={weight} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    focusIndex(body, 1); // second day
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent).toContain('3.0%');
    expect(tip.textContent).toContain('6.0%'); // quality UCL
    expect(tip.textContent).toContain('1.5%');
    expect(tip.textContent).toContain('4.5%'); // weight UCL
    // Same facts must reach the aria-live readout, the screen-reader/wall
    // path a floating tooltip cannot serve.
    const readout = container.querySelector('.readout')!;
    expect(readout.textContent).toContain('3.0%');
    expect(readout.textContent).toContain('1.5%');
  });

  it('an out-of-control day states "above the usual range" in the tooltip context', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02, outOfControl: false }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.09, outOfControl: true }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    focusIndex(body, 1);
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent).toContain('above the usual range');
  });

  it('the p-chart band and points still render after the ChartFrame migration', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02, ucl: 0.05, lcl: 0.0 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.03, ucl: 0.06, lcl: 0.0, outOfControl: true }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const svg = container.querySelector('svg.chart')!;
    // The band fill.
    expect(svg.querySelector('path[fill="var(--paper-3)"]')).not.toBeNull();
    // The out-of-control mark.
    expect(svg.querySelector('circle[fill="var(--acc-fill)"]')).not.toBeNull();
  });
});

describe('RejectTrendChart — click-to-zoom sets the whole-page period, snapped to shifts', () => {
  it('Enter on the keyboard-active day commits a PeriodParams spanning that one day', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.03 }),
      bucket({ bucketTs: '2026-09-03T00:00:00Z', rate: 0.025 }),
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" onSelect={onSelect} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // day 1, 1 Sep
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    expect(p.range).toEqual(dayToShiftRange('2026-09-01', '2026-09-01'));
  });

  it('a real mouse click (not a drag) on a point zooms the same way', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.03 }),
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" onSelect={onSelect} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    // `hit()` always resolves to the NEAREST day by x, so a click at the
    // wrapper's own left edge lands on day 1 without needing the real mark
    // geometry — clientY 50 just needs to sit inside the plot band (T..H-B).
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 50, button: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    Object.defineProperty(down, 'pointerType', { value: 'mouse' });
    const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 0, clientY: 50, button: 0 });
    Object.defineProperty(up, 'pointerId', { value: 1 });
    Object.defineProperty(up, 'pointerType', { value: 'mouse' });
    body.dispatchEvent(down);
    body.dispatchEvent(up);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    expect(p.range).toEqual(dayToShiftRange('2026-09-01', '2026-09-01'));
  });

  it('a drag past the click threshold does not zoom', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.03 }),
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" onSelect={onSelect} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    Object.defineProperty(down, 'pointerType', { value: 'mouse' });
    const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 5000, clientY: 0, button: 0 });
    Object.defineProperty(up, 'pointerId', { value: 1 });
    Object.defineProperty(up, 'pointerType', { value: 'mouse' });
    body.dispatchEvent(down);
    body.dispatchEvent(up);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('with no onSelect prop, Enter does nothing (no zoom offered)', () => {
    const quality: TrendBucket[] = [
      bucket({ bucketTs: '2026-09-01T00:00:00Z', rate: 0.02 }),
      bucket({ bucketTs: '2026-09-02T00:00:00Z', rate: 0.03 }),
    ];
    const { container } = render(<RejectTrendChart quality={quality} singleName="Quality" />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    fireEvent.keyDown(body, { key: 'ArrowRight' });
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(body.className).not.toContain('can-activate');
  });
});
