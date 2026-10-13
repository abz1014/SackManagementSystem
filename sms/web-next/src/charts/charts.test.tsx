import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { installDomStubs } from '../../../web/src/testkit/domStubs';
import type { PeriodParams } from '../bridge/chart';
import { BarChart, Histogram, LineChart, Pareto, Sparkline } from './index';

installDomStubs();
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const rows = [
  { label: 'Code A', count: 60, cumulativePct: 60 },
  { label: 'Code B', count: 25, cumulativePct: 85 },
  { label: 'Code C', count: 15, cumulativePct: 100 },
];
const common = { unit: 'cones' };

function pointer(el: Element, type: string, clientX: number, clientY = 20) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe('Pareto', () => {
  it('draws the cumulative line from the supplied percentages and labels the right axis', () => {
    const { container } = render(<Pareto chartId="p1" title="Reject reasons" {...common} rows={rows} />);
    expect(screen.getAllByText('Cumulative share (%)').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('circle.ck-dot')).toHaveLength(3);
    expect(container.querySelector('path.ck-line')).not.toBeNull();
    // vital few: 80 % is reached by the second reason (lib/pareto)
    expect(screen.getAllByText('2 of 3 reasons make up most of the rejects.').length).toBeGreaterThan(0);
  });
  it('shows the legend with both series', () => {
    render(<Pareto chartId="p2" title="Reject reasons" {...common} rows={rows} />);
    const legend = screen.getByLabelText('Legend');
    expect(within(legend).getByText('Cumulative share')).toBeTruthy();
  });
});

describe('limit band', () => {
  it('is labelled In limits with named, valued limit lines', () => {
    render(
      <LineChart
        chartId="l1"
        title="Cone weight"
        unit="g"
        categories={['a', 'b', 'c']}
        series={[{ name: 'Mean', values: [1950, 1955, 2100] }]}
        limits={{ lower: 1910, upper: 1990, lowerText: '1,910 g', upperText: '1,990 g' }}
      />,
    );
    expect(screen.getByTestId('limit-band')).toBeTruthy();
    expect(screen.getByText('In limits')).toBeTruthy();
    expect(screen.getByText('Upper limit 1,990 g')).toBeTruthy();
    expect(screen.getByText('Lower limit 1,910 g')).toBeTruthy();
  });
  it('rings a point outside the limits', () => {
    const { container } = render(
      <LineChart chartId="l2" title="w" unit="g" categories={['a', 'b']} series={[{ name: 'Mean', values: [1950, 2100] }]} limits={{ lower: 1910, upper: 1990, lowerText: '1,910 g', upperText: '1,990 g' }} />,
    );
    expect(container.querySelectorAll('circle.ck-ring')).toHaveLength(1);
  });
});

describe('table view on every chart', () => {
  const cases: [string, JSX.Element][] = [
    ['bar', <BarChart key="b" chartId="t1" title="Bars" unit="cones" categories={['a', 'b']} series={[{ name: 'Cones', values: [1, 2] }]} />],
    ['pareto', <Pareto key="p" chartId="t2" title="Pareto" unit="cones" rows={rows} />],
    ['line', <LineChart key="l" chartId="t3" title="Lines" unit="g" categories={['a', 'b']} series={[{ name: 'Mean', values: [1, 2] }]} />],
    ['histogram', <Histogram key="h" chartId="t4" title="Hist" unit="cones" valueUnit="g" bins={[{ from: 1900, to: 1910, count: 3 }, { from: 1910, to: 1920, count: 5 }]} />],
  ];
  for (const [name, el] of cases) {
    it(`${name}: toggles to a real table and back`, () => {
      const { container } = render(el);
      fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
      expect(container.querySelector('table.ck-table')).not.toBeNull();
      expect(container.querySelector('svg.ck-svg')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }));
      expect(container.querySelector('svg.ck-svg')).not.toBeNull();
    });
  }
  it('sparkline carries a hidden table', () => {
    const { container } = render(<Sparkline label="Cones per hour" unit="cones" values={[1, 2, 3]} />);
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(3);
  });
});

describe('histogram', () => {
  it('states the bin width', () => {
    render(<Histogram chartId="h2" title="Distribution" unit="cones" valueUnit="g" bins={[{ from: 1900, to: 1910, count: 3 }, { from: 1910, to: 1920, count: 5 }]} />);
    expect(screen.getAllByText(/Each bar is 10 g wide\./).length).toBeGreaterThan(0);
  });
});

/** Plot svgs only: the empty-state icon is a decorative svg inside an aria-hidden span. */
const plots = (c: HTMLElement) => Array.from(c.querySelectorAll('svg')).filter((s) => !s.closest('[aria-hidden="true"]'));

describe('states', () => {
  const props = { chartId: 's', title: 'Reject chart', unit: 'cones', categories: ['a'], series: [{ name: 'x', values: [1] }] };
  it('loading draws a skeleton and no plot', () => {
    const { container } = render(<BarChart {...props} status="loading" />);
    expect(container.querySelector('.skel')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });
  it('error names the part, offers retry, draws no plot', () => {
    const retry = vi.fn();
    const { container } = render(<BarChart {...props} status="error" errorPart="the reject chart" onRetry={retry} />);
    expect(screen.getByText(/Couldn't load the reject chart\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
  });
  it('empty says so with an action and draws no plot', () => {
    const go = vi.fn();
    const { container } = render(<LineChart chartId="e" title="T" unit="g" categories={[]} series={[]} emptyAction={{ label: 'Show newest data', onClick: go }} />);
    expect(screen.getByText('Nothing in this period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show newest data' }));
    expect(go).toHaveBeenCalled();
    expect(plots(container)).toHaveLength(0);
  });
  it('an all-null series is empty, not a flat plot', () => {
    const { container } = render(<BarChart {...props} series={[{ name: 'x', values: [null] }]} />);
    expect(plots(container)).toHaveLength(0);
  });
});

describe('legend and zoom', () => {
  it('shows a legend for two series, none for one', () => {
    const two = render(<BarChart chartId="g2" title="T" unit="g" categories={['a']} series={[{ name: 'One', values: [1] }, { name: 'Two', values: [2] }]} />);
    expect(two.container.querySelector('.ck-legend')).not.toBeNull();
    two.unmount();
    const one = render(<BarChart chartId="g1" title="T" unit="g" categories={['a']} series={[{ name: 'One', values: [1] }]} />);
    expect(one.container.querySelector('.ck-legend')).toBeNull();
  });
  it('a click on a bar calls onZoom with a range PeriodParams', () => {
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-02', shift: 'morning' }, to: { date: '2026-09-02', shift: 'night' } } };
    const onZoom = vi.fn();
    const { container } = render(
      <BarChart chartId="z" title="Cones per day" unit="cones" categories={['1 Sep', '2 Sep']} series={[{ name: 'Cones', values: [5, 9] }]} periodFor={(i) => (i === 1 ? period : null)} onZoom={onZoom} />,
    );
    const body = container.querySelector('.chart-frame-body') as HTMLElement;
    const w = Number(container.querySelector('svg.ck-svg')?.getAttribute('width'));
    const x = w - 40; // inside the second (right-hand) slot
    pointer(body, 'pointermove', x);
    pointer(body, 'pointerdown', x);
    pointer(body, 'pointerup', x);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls[0]?.[0]).toMatchObject({ key: 'range', range: { from: { shift: 'morning' }, to: { shift: 'night' } } });
  });
});
