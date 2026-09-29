/**
 * Chart overhaul, wave 3, Task T5 (29 Sep 2026): the `ChartFrame` tooltip
 * every chart in this module (bar `Histogram`, list `RankBars`,
 * `DeviationBars`) now carries, reached via keyboard (ArrowRight) so it does
 * not depend on pointer support in the test DOM. `RejectTrendChart` is not
 * covered here — it was migrated onto `ChartFrame` separately (commit
 * `ceecc55`), and its own tooltip and click-to-zoom behaviour are covered by
 * `report.series.test.tsx` instead, which this task does not own.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render } from '../../testkit/render';
import { DayBars, DeviationBars, Histogram, RankBars, type DeviationRow, type HistBucket, type RankRow } from './shared';
import type { ReportLine } from '../../api';

function activateFirst(container: HTMLElement) {
  const body = container.querySelector('.chart-frame-body')!;
  fireEvent.keyDown(body, { key: 'ArrowRight' });
}

describe('ChartFrame tooltip content, reached via keyboard', () => {
  it('Histogram: bin range, count, and inside/outside the limits when given', () => {
    const buckets: HistBucket[] = [
      { bucket: 10, count: 4 },
      { bucket: 11, count: 90 },
      { bucket: 12, count: 4 },
    ];
    const { container } = render(<Histogram buckets={buckets} bucketSize={1} unit=" g" label="Test histogram" limitLo={10.5} limitHi={12.5} />);
    activateFirst(container);
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent).toContain('10');
    expect(tip.textContent).toContain('11');
    expect(tip.textContent).toContain('4');
    expect(tip.textContent).toContain('Within limits');
  });

  it('RankBars: the tooltip heading carries the FULL label even when the on-chart label is truncated', () => {
    const longLabel = '205-IL0-SD · Star Green · PVSD8020 · 18 · a much longer product description than fits';
    const rows: RankRow[] = [
      { key: 'a', label: longLabel, value: 90 },
      { key: 'b', label: 'Short', value: 10 },
    ];
    const { container } = render(<RankBars rows={rows} ariaLabel="Products" labelWidth={120} />);
    activateFirst(container);
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent).toContain(longLabel);
    // The on-chart label, drawn separately from the tooltip, is shorter than
    // the full name and ends in an ellipsis.
    const onChartLabel = container.querySelector('svg text')!.textContent!;
    expect(onChartLabel.length).toBeLessThan(longLabel.length);
    expect(onChartLabel.endsWith('…')).toBe(true);
  });

  it('DeviationBars: falls back to the title string when no caller tip is given', () => {
    const rows: DeviationRow[] = [
      { key: 's1', label: 'Station 1', value: 12 },
      { key: 's2', label: 'Station 2', value: -8 },
    ];
    const { container } = render(<DeviationBars rows={rows} ariaLabel="Station bias" />);
    activateFirst(container);
    const tip = container.querySelector('.chart-tip')!;
    // `fmtSignedG` joins the value and unit with a non-breaking space, not an
    // ordinary one — matched on the numeral alone, not the exact whitespace.
    expect(tip.textContent).toContain('Station 1');
    expect(tip.textContent).toContain('+12.0');
    expect(tip.textContent).toContain('g');
  });

  it('DeviationBars: a caller-supplied tip wins over the title fallback', () => {
    const rows: DeviationRow[] = [
      { key: 's1', label: 'Station 1', value: 12 },
      { key: 's2', label: 'Station 2', value: -8 },
    ];
    const { container } = render(
      <DeviationBars
        rows={rows}
        ariaLabel="Station bias"
        tip={(i) => ({ heading: rows[i]!.label, rows: [{ name: '', value: '1,234 cones · 20 fewer than the row median of 1,254' }] })}
      />,
    );
    activateFirst(container);
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent).toContain('1,234 cones');
    expect(tip.textContent).toContain('row median of 1,254');
  });

  it('DayBars: the tooltip states the day, cones and sacks', () => {
    const rows: ReportLine[] = [
      { group: '2026-09-01', cones: 500, sacks: 10, sackWeightKg: 400, avgSackKg: 40, conesPerSack: 50, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-02', cones: 520, sacks: 11, sackWeightKg: 440, avgSackKg: 40, conesPerSack: 47, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
    ];
    const { container } = render(<DayBars rows={rows} />);
    activateFirst(container);
    const tip = container.querySelector('.chart-tip')!;
    expect(tip.textContent).toContain('500 cones');
    expect(tip.textContent).toContain('10 sacks');
  });
});
