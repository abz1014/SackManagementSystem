/**
 * CSS-053 follow-up (Stage 3, 12 Oct 2026). User impact: after a reader click-zooms a chart, the "Zoomed in · Back" control is meant
 * to appear beside that chart. The independent re-check found it on only 3 of 8 zoomed pages: on Line and on Weight's default view the
 * zoom changes which chart the page draws (cones per day becomes cones per shift, the over-time chart becomes the distribution), so the
 * chart that comes back has a different id from the one that was clicked, and the control never showed.
 * Plain @testing-library render, like ChartFrame.test.tsx.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChartFrame, type ChartFrameProps } from './ChartFrame';
import { installDomStubs } from '../testkit/domStubs';
import { W } from '../lib/words';
import type { PeriodParams } from '../lib/period';

installDomStubs();

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function firePointer(el: Element, type: 'pointerdown' | 'pointerup', clientX: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
}

const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'night' } } };

function props(chartId: string, onZoom?: (p: PeriodParams) => void): ChartFrameProps {
  return {
    chartId,
    defaultH: 200,
    count: 1,
    hit: (x) => (Math.abs(x - 50) <= 10 ? 0 : null),
    tipFor: () => ({ heading: 'Point', rows: [] }),
    children: () => <svg data-testid="plot" />,
    zoom: onZoom ? { periodFor: () => period, onZoom } : undefined,
  };
}

/** Two charts on one page. The second one is the zoomable one, and the page draws it under another id once zoomed, as Line does. */
function Page({ renameOnZoom }: { renameOnZoom: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  const onZoom = () => {
    window.history.pushState({ zoomFrom: { key: 'shift' } }, '', '/?s=line&p=range');
    setZoomed(true);
  };
  const id = renameOnZoom && zoomed ? 'cones-per-shift' : 'cones-per-day';
  return (
    <div>
      <ChartFrame {...props('first-chart')} />
      <ChartFrame key={id} {...props(id, onZoom)} />
    </div>
  );
}

function clickSecondChart(container: HTMLElement) {
  const bodies = container.querySelectorAll('.chart-frame-body');
  const body = bodies[1]!;
  firePointer(body, 'pointerdown', 50);
  firePointer(body, 'pointerup', 50);
}

describe('CSS-053 follow-up: the Back control follows the chart that was clicked', () => {
  it('shows beside the chart when the page keeps the same chart id after the zoom (unchanged behaviour)', () => {
    const { container } = render(<Page renameOnZoom={false} />);
    expect(screen.queryByRole('button', { name: W.chart.zoomedBack })).toBeNull();
    clickSecondChart(container);
    expect(screen.getAllByRole('button', { name: W.chart.zoomedBack })).toHaveLength(1);
  });

  it('shows beside the chart when the zoom makes the page draw that chart under a different id', () => {
    const { container } = render(<Page renameOnZoom={true} />);
    clickSecondChart(container);
    const buttons = screen.queryAllByRole('button', { name: W.chart.zoomedBack });
    expect(buttons, 'a Zoomed-in Back control exists after the chart was redrawn under a new id').toHaveLength(1);
    // And it sits in the second chart's frame, not the first one's.
    const frames = container.querySelectorAll('.chart-frame');
    expect(frames[1]!.contains(buttons[0]!)).toBe(true);
    expect(frames[0]!.contains(buttons[0]!)).toBe(false);
  });
});
