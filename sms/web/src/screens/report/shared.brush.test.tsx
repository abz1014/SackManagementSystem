/**
 * Chart overhaul, wave 3, Task T5 (29 Sep 2026): drag-to-select on `DayBars`
 * and on `DeviationBars` in DAY mode both commit a snapped `PeriodParams` for
 * the whole page — driven via keyboard (Shift+Arrow to extend, then `+` to
 * commit, `ChartFrame.tsx`'s own keyboard path for a brush) rather than
 * synthetic pointer coordinates, which jsdom's stub layout cannot place
 * reliably.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render } from '../../testkit/render';
import { DayBars, DeviationBars, type DeviationRow } from './shared';
import { dayToShiftRange } from '../../lib/period';
import type { ReportLine } from '../../api';
import type { PeriodParams } from '../../lib/period';

function selectRange(body: HTMLElement) {
  // ArrowRight to land on index 0, Shift+ArrowRight to extend to index 1,
  // then `+` to commit — ChartFrame.tsx's own keyboard brush path.
  fireEvent.keyDown(body, { key: 'ArrowRight' });
  fireEvent.keyDown(body, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(body, { key: '+' });
}

describe('brush commits a snapped whole-page PeriodParams', () => {
  it('DayBars: a day-range selection snaps to D1.morning .. D2.night', () => {
    const rows: ReportLine[] = [
      { group: '2026-09-01', cones: 500, sacks: 10, sackWeightKg: 400, avgSackKg: 40, conesPerSack: 50, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-02', cones: 520, sacks: 11, sackWeightKg: 440, avgSackKg: 40, conesPerSack: 47, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-03', cones: 480, sacks: 9, sackWeightKg: 360, avgSackKg: 40, conesPerSack: 53, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<DayBars rows={rows} onSelect={onSelect} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    selectRange(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    const expected = dayToShiftRange('2026-09-01', '2026-09-02');
    expect(p.range).toEqual(expected);
  });

  it('DeviationBars: a day-mode `brush` prop snaps the same way, from its own refs', () => {
    const rows: DeviationRow[] = [
      { key: '2026-09-01', label: '1 Sep', value: 3 },
      { key: '2026-09-02', label: '2 Sep', value: -4 },
      { key: '2026-09-03', label: '3 Sep', value: 1 },
    ];
    const refs: [ReturnType<typeof dayToShiftRange>['from'], ReturnType<typeof dayToShiftRange>['to']][] = rows.map((r) => {
      const rr = dayToShiftRange(r.key, r.key);
      return [rr.from, rr.to];
    });
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<DeviationBars rows={rows} ariaLabel="Sacks per day" brush={{ refs, onSelect }} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    selectRange(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    const expected = dayToShiftRange('2026-09-01', '2026-09-02');
    expect(p.range).toEqual(expected);
  });

  it('DeviationBars: with no `brush` prop, the `+` key does nothing (no brush offered for stations)', () => {
    const rows: DeviationRow[] = [
      { key: 's1', label: 'Station 1', value: 3 },
      { key: 's2', label: 'Station 2', value: -4 },
    ];
    const { container } = render(<DeviationBars rows={rows} ariaLabel="Station bias" />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    // Should not throw, and no brush overlay/label should ever appear.
    selectRange(body);
    expect(container.querySelector('.chart-brush-label')).toBeNull();
  });
});
