/**
 * Chart overhaul, wave 3, Task T7 (29 Sep 2026). Covers only what T7 changed
 * in `StationSheet.tsx`'s `DailyMeans` chart: a tooltip on every day (not
 * just flagged ones, and it now includes vs-line/vs-target/cones), keyboard
 * navigation through `ChartFrame`, the drag-to-select brush handing a
 * shift-snapped `PeriodParams` to `onSelectPeriod`, and de-collided gutter
 * labels when the target and the line mean coincide. Everything else about
 * the sheet (the KV block, the flagged-days table, the adjustment ledger,
 * the log form) is unchanged and untested here.
 *
 * `canAdjust: false` throughout: `LogForm` calls `usePlantNow()`, which
 * throws outside `<LiveProvider>` — not needed for anything this file
 * checks, so it is left unmounted rather than dragging in the live-context
 * setup `Line.render.test.tsx` etc. use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { render } from '../testkit/render';
import { installFakeFetch } from '../testkit/fetchRouter';
import { StationSheet, stationGutterLabels } from './StationSheet';
import { rectsIntersect, textPx, type Rect } from '../ui/chartLayout';
import type { AdjustmentList, StationRow, WeightStationRow, WeightStationsData } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const META = {
  serverTimeUtc: '2026-09-07T12:00:00Z',
  lastSyncUtc: '2026-09-07T12:00:00Z',
  version: 'test',
} as const;

const DAYS: WeightStationRow['days'] = [
  { date: '2026-08-25', n: 40, mean: 1930, nelson: [] },
  { date: '2026-08-26', n: 42, mean: 1935, nelson: [] },
  { date: '2026-08-27', n: 38, mean: 1948, nelson: [4] },
  { date: '2026-08-28', n: 44, mean: 1952, nelson: [] },
];

function stationRow(over: Partial<WeightStationRow> = {}): WeightStationRow {
  return {
    station: 7,
    n: 164,
    meanG: 1941,
    vsLineG: 6,
    vsTargetG: -9,
    daysHeld: 4,
    flagged: true,
    rejectRatePct: 1.2,
    lastAdjustedUtc: null,
    days: DAYS,
    medianG: 1940,
    sdG: 8.1,
    restartedOn: null,
    centrelineG: 1935,
    sigmaDayToDay: 4.2,
    longestRun: 4,
    projection: null,
    targetBasis: 'station_material',
    ...over,
  };
}

function weightStationsData(over: Partial<WeightStationsData> = {}): WeightStationsData {
  return {
    from: '2026-08-25',
    to: '2026-09-07',
    days: 14,
    lineMeanG: 1935,
    targetG: 1950,
    productId: 12,
    productLabel: 'Test product',
    thresholdG: 15,
    minDaysHeld: 3,
    lineRejectRatePct: 1.0,
    stations: [stationRow()],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
    limits: null,
    rules: [{ id: 4, label: 'rule 4', minPoints: 4 }],
    targetEffectiveFromUtc: '2026-08-01T00:00:00Z',
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
    ...over,
  } as WeightStationsData;
}

function routes(dataOver: Partial<WeightStationsData> = {}) {
  const stations: StationRow[] = [{ stationId: 7, name: 'Station 7' } as StationRow];
  const adjustments: AdjustmentList = { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 7 };
  return {
    '/api/weight-stations': { data: weightStationsData(dataOver), metadata: META },
    '/api/stations': { stations },
    '/api/calibration/adjustments': adjustments,
  };
}

function renderSheet(opts: { dataOver?: Partial<WeightStationsData>; onSelectPeriod?: (p: unknown) => void } = {}) {
  installFakeFetch(routes(opts.dataOver));
  const noop = () => {};
  return render(
    <StationSheet
      station={7}
      canAdjust={false}
      periodTo="2026-09-07"
      onClose={noop}
      onSeeReadings={noop}
      onSeeRejects={noop}
      onSeeCalibrationReport={noop}
      onSeeShiftReport={noop}
      onSelectPeriod={opts.onSelectPeriod}
    />,
  );
}

async function waitForChart(container: HTMLElement): Promise<HTMLElement> {
  for (let i = 0; i < 20; i++) {
    const body = container.querySelector('.chart-frame-body');
    if (body) return body as HTMLElement;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error('chart-frame-body never rendered');
}

describe('StationSheet DailyMeans — tooltip content', () => {
  it('shows mean, vs line, vs target and cones for a normal day', async () => {
    const { container } = renderSheet();
    const body = await waitForChart(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // first day: 25 Aug, mean 1930

    const tip = container.querySelector('.chart-tip')!;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('25 Aug');
    expect(tip.textContent).toContain('1,930'); // mean
    expect(tip.textContent).toContain('vs line');
    expect(tip.textContent).toContain('vs target');
    expect(tip.textContent).toContain('Cones');
    expect(tip.textContent).toContain('40'); // n
  });

  it('names the fired rule for a flagged day, and nothing for an unflagged one', async () => {
    const { container } = renderSheet();
    const body = await waitForChart(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // day 0, unflagged
    expect(container.querySelector('.chart-tip')!.textContent).not.toContain('rule 4');

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // day 1, unflagged
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // day 2 — 2026-08-27, nelson: [4]
    expect(container.querySelector('.chart-tip')!.textContent).toContain('rule 4');
  });
});

describe('StationSheet DailyMeans — keyboard navigation', () => {
  it('ArrowRight/ArrowLeft move the active day through the readout', async () => {
    const { container } = renderSheet();
    const body = await waitForChart(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(container.querySelector('.readout')!.textContent).toContain('25 Aug');

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(container.querySelector('.readout')!.textContent).toContain('26 Aug');

    fireEvent.keyDown(body, { key: 'ArrowLeft' });
    expect(container.querySelector('.readout')!.textContent).toContain('25 Aug');
  });
});

describe('StationSheet DailyMeans — brush selects a shift-snapped period', () => {
  it('a drag across two days calls onSelectPeriod with the day-snapped range', async () => {
    const onSelectPeriod = vi.fn();
    const { container } = renderSheet({ onSelectPeriod });
    const body = await waitForChart(container);

    // Fallback chart width in jsdom (no real ResizeObserver firing) is
    // useChartSize's DEFAULT_FALLBACK_W, 1036px; 4 days spread across
    // [L, width-R]. A drag from the first day's x to the last day's x
    // selects the whole window.
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    Object.defineProperty(down, 'pointerType', { value: 'mouse' });
    const move = new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 5000, clientY: 0, button: 0 });
    Object.defineProperty(move, 'pointerId', { value: 1 });
    Object.defineProperty(move, 'pointerType', { value: 'mouse' });
    const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 5000, clientY: 0, button: 0 });
    Object.defineProperty(up, 'pointerId', { value: 1 });
    Object.defineProperty(up, 'pointerType', { value: 'mouse' });

    act(() => body.dispatchEvent(down));
    act(() => body.dispatchEvent(move));
    act(() => body.dispatchEvent(up));

    expect(onSelectPeriod).toHaveBeenCalledTimes(1);
    const params = onSelectPeriod.mock.calls[0]![0];
    expect(params.key).toBe('range');
    expect(params.range.from).toEqual({ date: '2026-08-25', shift: 'morning' });
    expect(params.range.to).toEqual({ date: '2026-08-28', shift: 'night' });
  });

  it('does not render a brush affordance when onSelectPeriod is not wired', async () => {
    const { container } = renderSheet();
    const body = await waitForChart(container);
    expect(body.getAttribute('title')).toBeNull();
  });
});

describe('stationGutterLabels — no intersecting boxes when target equals the line mean', () => {
  it('displaces one label off the other and both boxes are non-intersecting', () => {
    const days = DAYS.map((d) => ({ ...d, mean: 1935 }));
    const fontPx = 13;
    const labels = stationGutterLabels(days, 1935, 1935, 14, 150 - 26, fontPx);

    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.displaced)).toBe(true);

    const boxes: Rect[] = labels.map((l) => ({
      x: 0,
      y: l.y - 6,
      w: textPx(l.text.length, fontPx),
      h: 14,
    }));
    expect(rectsIntersect(boxes[0]!, boxes[1]!)).toBe(false);
  });

  it('keeps both labels at their natural y (not displaced) when comfortably apart', () => {
    const days = DAYS;
    const labels = stationGutterLabels(days, 2100, 1800, 14, 150 - 26, 13);
    expect(labels.every((l) => !l.displaced)).toBe(true);
  });
});

describe('StationSheet — existing behaviour stays green', () => {
  it('renders the station headline, KV block and flagged-days table', async () => {
    const { container, findByText } = renderSheet();
    await findByText(/vs line/);
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Station 7');
    expect(container.querySelector('.big')).toBeTruthy();
    expect(container.textContent).toContain('vs line');
    expect(container.textContent).toContain('vs target');
  });

  it('shows the empty state for an unknown station id', async () => {
    installFakeFetch({
      '/api/weight-stations': { data: weightStationsData({ stations: [] }), metadata: META },
      '/api/stations': { stations: [] },
      '/api/calibration/adjustments': { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 99 },
    });
    const { findByText } = render(
      <StationSheet
        station={99}
        canAdjust={false}
        periodTo="2026-09-07"
        onClose={() => {}}
        onSeeReadings={() => {}}
        onSeeRejects={() => {}}
        onSeeCalibrationReport={() => {}}
        onSeeShiftReport={() => {}}
      />,
    );
    await findByText(/no readings|not found/i);
  });
});
