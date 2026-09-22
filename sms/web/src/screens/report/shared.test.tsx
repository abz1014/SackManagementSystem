/**
 * UX chart-primitives pass (22 Sep 2026): `RankBars` and `DeviationBars`
 * (report/shared.tsx). The mechanical properties a design review asked for
 * — print-survival (an SVG `fill` attribute, never a CSS `background`),
 * exact proportionality, an honest empty state, and the accent reserved for
 * a genuinely flagged row.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { DeviationBars, RankBars, type DeviationRow, type RankRow } from './shared';

function rankRows(values: number[]): RankRow[] {
  return values.map((value, i) => ({ key: `r${i}`, label: `Row ${i}`, value }));
}

function deviationRows(values: number[], flags: boolean[] = []): DeviationRow[] {
  return values.map((value, i) => ({ key: `d${i}`, label: `Station ${i}`, value, flagged: flags[i] ?? false }));
}

describe('RankBars', () => {
  it('renders one <rect> per row, each with a fill attribute and no CSS background', () => {
    const { container } = render(<RankBars rows={rankRows(Array.from({ length: 14 }, (_, i) => i + 1))} ariaLabel="Top reasons" />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(14);
    rects.forEach((r) => {
      expect(r.getAttribute('fill')).toBeTruthy();
      expect((r as unknown as HTMLElement).style.background).toBe('');
    });
  });

  it('bar length is exactly proportional to value', () => {
    const { container } = render(<RankBars rows={rankRows([10, 40])} ariaLabel="Two rows" />);
    const rects = Array.from(container.querySelectorAll('rect'));
    const wa = Number(rects[0]!.getAttribute('width'));
    const wb = Number(rects[1]!.getAttribute('width'));
    expect(Math.abs(wa / wb - 10 / 40)).toBeLessThan(0.01);
  });

  it('renders nothing below the multi-row minimum', () => {
    const { container } = render(<RankBars rows={rankRows([5])} ariaLabel="One row" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('rect').length).toBe(0);
  });

  it('renders nothing for zero rows', () => {
    const { container } = render(<RankBars rows={[]} ariaLabel="No rows" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('carries role="img" and the given aria-label', () => {
    const { container } = render(<RankBars rows={rankRows([1, 2, 3])} ariaLabel="Reject reasons, ranked by count" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Reject reasons, ranked by count');
  });

  it('draws the accent fill only on a row the caller flagged, never elsewhere', () => {
    const rows = rankRows([1, 2, 3]);
    rows[1]!.flagged = true;
    const { container } = render(<RankBars rows={rows} ariaLabel="With one flagged row" />);
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(rects[1]!.getAttribute('fill')).toBe('var(--acc-fill)');
    expect(rects[0]!.getAttribute('fill')).not.toContain('--acc');
    expect(rects[2]!.getAttribute('fill')).not.toContain('--acc');
  });

  it('a healthy list (nothing flagged) contains no accent reference anywhere in the render', () => {
    const { container } = render(<RankBars rows={rankRows([1, 2, 3])} ariaLabel="All healthy" />);
    expect(container.innerHTML).not.toContain('--acc');
  });
});

describe('DeviationBars', () => {
  it('renders one <rect> per row, each with a fill attribute and no CSS background', () => {
    const values = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? i + 1 : -(i + 1)));
    const { container } = render(<DeviationBars rows={deviationRows(values)} ariaLabel="Station bias" />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(14);
    rects.forEach((r) => {
      expect(r.getAttribute('fill')).toBeTruthy();
      expect((r as unknown as HTMLElement).style.background).toBe('');
    });
  });

  it('bar length is exactly proportional to |value|, on both sides of zero', () => {
    const { container } = render(<DeviationBars rows={deviationRows([6, -18])} ariaLabel="Two stations" />);
    const rects = Array.from(container.querySelectorAll('rect'));
    const ha = Number(rects[0]!.getAttribute('height'));
    const hb = Number(rects[1]!.getAttribute('height'));
    expect(Math.abs(ha / hb - 6 / 18)).toBeLessThan(0.01);
  });

  it('proportionality holds with a threshold widening the domain', () => {
    const { container } = render(
      <DeviationBars rows={deviationRows([3, -12])} ariaLabel="Two stations, with a threshold" threshold={9} thresholdLabel="9 g" />,
    );
    const rects = Array.from(container.querySelectorAll('rect'));
    const ha = Number(rects[0]!.getAttribute('height'));
    const hb = Number(rects[1]!.getAttribute('height'));
    expect(Math.abs(ha / hb - 3 / 12)).toBeLessThan(0.01);
  });

  it('renders nothing below the multi-row minimum', () => {
    const { container } = render(<DeviationBars rows={deviationRows([4])} ariaLabel="One row" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('rect').length).toBe(0);
  });

  it('renders nothing for zero rows', () => {
    const { container } = render(<DeviationBars rows={[]} ariaLabel="No rows" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws the accent fill only on a row the caller flagged, never elsewhere', () => {
    const { container } = render(<DeviationBars rows={deviationRows([5, -5, 2], [false, true, false])} ariaLabel="One flagged station" />);
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(rects[1]!.getAttribute('fill')).toBe('var(--acc-fill)');
    expect(rects[0]!.getAttribute('fill')).not.toContain('--acc');
    expect(rects[2]!.getAttribute('fill')).not.toContain('--acc');
  });

  it('a healthy chart (nothing flagged) contains no accent reference anywhere in the render, even with a threshold', () => {
    const { container } = render(
      <DeviationBars rows={deviationRows([2, -3, 1])} ariaLabel="All healthy" threshold={9} thresholdLabel="9 g" />,
    );
    expect(container.innerHTML).not.toContain('--acc');
  });

  it('carries role="img" and the given aria-label', () => {
    const { container } = render(<DeviationBars rows={deviationRows([1, -1, 2])} ariaLabel="Station bias from the line" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Station bias from the line');
  });
});
