/**
 * Chart overhaul, wave 4, Task W2 (29 Sep 2026): rewritten from
 * `shared.brush.test.tsx` (deleted) now that drag-to-select is removed
 * everywhere (`ChartFrame.tsx`'s own header, Task W1). `DayBars` and
 * `DeviationBars` in day mode both now offer CLICK-TO-ZOOM: a click on a bar
 * (or Enter on the keyboard-active one) commits a snapped `PeriodParams` for
 * the whole page directly — there is no second endpoint to extend to and no
 * `+` to commit, so the old Shift+Arrow-then-`+` keyboard path is gone too.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render } from '../../testkit/render';
import { DayBars, DeviationBars, type DeviationRow } from './shared';
import { dayToShiftRange } from '../../lib/period';
import type { ReportLine } from '../../api';
import type { PeriodParams } from '../../lib/period';

/** Lands the keyboard-active mark on index 0, then Enter — `ChartFrame.tsx`'s
 *  own click/Enter activation path (`onWrapperKeyDown`'s `Enter` case). */
function zoomViaKeyboard(body: HTMLElement) {
  fireEvent.keyDown(body, { key: 'ArrowRight' });
  fireEvent.keyDown(body, { key: 'Enter' });
}

/** Same technique as `ui/ChartFrame.test.tsx`'s own `firePointer` and
 *  `Line.stationChartClick.test.tsx`'s: jsdom does not construct a real
 *  PointerEvent from fireEvent's init dict, so a MouseEvent is dispatched
 *  under the pointer* event names with pointerId/pointerType defined
 *  directly on it. */
function firePointer(el: Element, type: 'pointerdown' | 'pointerup', clientX: number, clientY: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  el.dispatchEvent(ev);
}

describe('click-to-zoom commits a snapped whole-page PeriodParams', () => {
  it('DayBars: clicking the first bar zooms to D1.morning .. D1.night', () => {
    const rows: ReportLine[] = [
      { group: '2026-09-01', cones: 500, sacks: 10, sackWeightKg: 400, avgSackKg: 40, conesPerSack: 50, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-02', cones: 520, sacks: 11, sackWeightKg: 440, avgSackKg: 40, conesPerSack: 47, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-03', cones: 480, sacks: 9, sackWeightKg: 360, avgSackKg: 40, conesPerSack: 53, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<DayBars rows={rows} onSelect={onSelect} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    zoomViaKeyboard(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    const expected = dayToShiftRange('2026-09-01', '2026-09-01');
    expect(p.range).toEqual(expected);
  });

  it('DayBars: a real mouse click (not a drag) zooms the same way', () => {
    const rows: ReportLine[] = [
      { group: '2026-09-01', cones: 500, sacks: 10, sackWeightKg: 400, avgSackKg: 40, conesPerSack: 50, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-02', cones: 520, sacks: 11, sackWeightKg: 440, avgSackKg: 40, conesPerSack: 47, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<DayBars rows={rows} onSelect={onSelect} />);
    const svg = container.querySelector('svg.chart') as SVGSVGElement;
    const rect = svg.querySelector('rect') as SVGRectElement;
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    const x = Number(rect.getAttribute('x'));
    const w = Number(rect.getAttribute('width'));
    const y = Number(rect.getAttribute('y'));
    const h = Number(rect.getAttribute('height'));
    const cx = x + w / 2;
    const cy = y + h / 2;
    firePointer(body, 'pointerdown', cx, cy);
    firePointer(body, 'pointerup', cx, cy);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    expect(p.range).toEqual(dayToShiftRange('2026-09-01', '2026-09-01'));
  });

  it('DayBars: a drag past the click threshold does not zoom', () => {
    const rows: ReportLine[] = [
      { group: '2026-09-01', cones: 500, sacks: 10, sackWeightKg: 400, avgSackKg: 40, conesPerSack: 50, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
      { group: '2026-09-02', cones: 520, sacks: 11, sackWeightKg: 440, avgSackKg: 40, conesPerSack: 47, rejectedCones: 5, rejectRatePct: 1, conesInRangePct: 95 },
    ];
    const onSelect = vi.fn<(p: PeriodParams) => void>();
    const { container } = render(<DayBars rows={rows} onSelect={onSelect} />);
    const svg = container.querySelector('svg.chart') as SVGSVGElement;
    const rect = svg.querySelector('rect') as SVGRectElement;
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    const x = Number(rect.getAttribute('x'));
    const w = Number(rect.getAttribute('width'));
    const y = Number(rect.getAttribute('y'));
    const h = Number(rect.getAttribute('height'));
    const cx = x + w / 2;
    const cy = y + h / 2;
    firePointer(body, 'pointerdown', cx, cy);
    firePointer(body, 'pointerup', cx + 200, cy);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('DeviationBars: a day-mode `zoom` prop zooms the same way, from its own refs', () => {
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
    const { container } = render(<DeviationBars rows={rows} ariaLabel="Sacks per day" zoom={{ refs, onSelect }} />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    zoomViaKeyboard(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const p = onSelect.mock.calls[0]![0];
    expect(p.key).toBe('range');
    const expected = dayToShiftRange('2026-09-01', '2026-09-01');
    expect(p.range).toEqual(expected);
  });

  it('DeviationBars: with no `zoom` prop, Enter does nothing (no zoom offered for stations)', () => {
    const rows: DeviationRow[] = [
      { key: 's1', label: 'Station 1', value: 3 },
      { key: 's2', label: 'Station 2', value: -4 },
    ];
    const { container } = render(<DeviationBars rows={rows} ariaLabel="Station bias" />);
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    // Should not throw, and the chart must never claim to be activatable.
    zoomViaKeyboard(body);
    expect(body.className).not.toContain('can-activate');
  });
});
