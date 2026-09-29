/**
 * Chart overhaul, wave 2, Task T3. Plain `@testing-library/react` render —
 * `ChartFrame` needs no `LiveProvider`, so this deliberately does not go
 * through `testkit/render.tsx` (which mounts the whole `<App/>`). Only
 * `installDomStubs()` is needed, for the silent default `ResizeObserver`
 * `useChartSize` reaches for (`testkit/domStubs.ts`) — nothing here drives
 * a real resize, so the controllable stub is not needed either.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ChartFrame, type ChartFrameProps, type ChartTip } from './ChartFrame';
import { installDomStubs } from '../testkit/domStubs';
import { W } from '../lib/words';
import type { PeriodParams } from '../lib/period';

installDomStubs();

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * jsdom in this project's pinned versions does not construct a real
 * `PointerEvent` from `fireEvent.pointerDown(el, {clientX, pointerId, ...})`
 * — every property comes through `undefined` (verified directly against
 * this repo's jsdom before writing this helper). `ChartFrame` does not
 * expose its handlers, so this dispatches a real `MouseEvent` under the
 * `pointer*` event names instead — `clientX`/`button` DO come through a
 * `MouseEvent` correctly (also verified). `MouseEventInit` has no
 * `pointerId` field, so it is defined directly on the constructed event
 * before dispatch (ChartFrame's own touch-vs-mouse branching reads
 * `e.pointerType`, and `pointerId` distinguishes concurrent pointers in the
 * real DOM, so both are set explicitly rather than left `undefined`).
 */
function firePointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY = 0) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
}

const XS = [10, 30, 50, 70, 90]; // 5 points, wrapper-relative px

function tipFor(i: number): ChartTip | null {
  return {
    heading: `Point ${i}`,
    rows: [{ name: 'value', value: String(i * 10), mark: 'ink' }],
    context: [`context ${i}`],
    hint: 'Open station 1',
  };
}

function hit(x: number): number | null {
  // Nearest of XS within 10px, else null (outside every mark).
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < XS.length; i++) {
    const d = Math.abs(XS[i]! - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best != null && bestD <= 10 ? best : null;
}

function baseProps(over: Partial<ChartFrameProps> = {}): ChartFrameProps {
  return {
    chartId: 'test-chart',
    defaultH: 200,
    count: XS.length,
    hit: (x) => hit(x),
    tipFor,
    children: () => <svg data-testid="plot" />,
    ...over,
  };
}

function getBody(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.chart-frame-body');
  if (!el) throw new Error('chart-frame-body not found');
  return el as HTMLElement;
}

/** The Readout line's own text — scoped so it never matches the (separate) tooltip. */
function readoutText(container: HTMLElement): string {
  const el = container.querySelector('.readout');
  if (!el) throw new Error('.readout not found');
  return el.textContent ?? '';
}

describe('ChartFrame keyboard navigation', () => {
  it('ArrowRight/ArrowLeft move the active point and drive the readout', () => {
    const { container } = render(<ChartFrame {...baseProps()} />);
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(readoutText(container)).toContain('Point 0');

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(readoutText(container)).toContain('Point 1');

    fireEvent.keyDown(body, { key: 'ArrowLeft' });
    expect(readoutText(container)).toContain('Point 0');
  });

  it('Home/End jump to the first/last point', () => {
    const { container } = render(<ChartFrame {...baseProps()} />);
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'End' });
    expect(readoutText(container)).toContain('Point 4');

    fireEvent.keyDown(body, { key: 'Home' });
    expect(readoutText(container)).toContain('Point 0');
  });

  it('Escape clears the active point back to the resting readout', () => {
    const { container } = render(<ChartFrame {...baseProps({ resting: 'Nothing selected' })} />);
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(readoutText(container)).toContain('Point 0');

    fireEvent.keyDown(body, { key: 'Escape' });
    expect(readoutText(container)).toBe('Nothing selected');
  });

  it('Enter calls onActivate with the active index', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    fireEvent.keyDown(body, { key: 'ArrowRight' });
    fireEvent.keyDown(body, { key: 'Enter' });

    expect(onActivate).toHaveBeenCalledWith(1);
  });
});

describe('ChartFrame readout stays resting, hover goes to .sr-only', () => {
  it('the resting sentence is always visible; the hovered text lives in a .sr-only span, mentioning the label once', () => {
    const { container } = render(<ChartFrame {...baseProps({ resting: 'resting sentence' })} />);
    const body = getBody(container);
    body.focus();

    const readout = container.querySelector('.readout')!;
    // At rest: only the resting sentence, no sr-only span yet.
    expect(readout.querySelector('.dim')?.textContent).toBe('resting sentence');
    expect(readout.querySelector('.sr-only')).toBeNull();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 0, tipFor(0) fires

    // The resting sentence is still visibly there (not replaced)...
    expect(readout.querySelector('.dim')?.textContent).toBe('resting sentence');
    // ...and the hovered text is in the sr-only span, mentioning "Point 0" once.
    const sr = readout.querySelector('.sr-only');
    expect(sr).toBeTruthy();
    const heading = 'Point 0';
    const occurrences = sr!.textContent!.split(heading).length - 1;
    expect(occurrences).toBe(1);
    expect(sr!.textContent).toContain('value 0');
  });
});

describe('ChartFrame tooltip', () => {
  it('renders the Tip (heading, rows, context) when a point is active', () => {
    const { container } = render(<ChartFrame {...baseProps()} />);
    const body = getBody(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' });

    const tip = container.querySelector('.chart-tip');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('Point 0');
    expect(tip!.textContent).toContain('value');
    expect(tip!.textContent).toContain('0'); // row value for index 0
    expect(tip!.textContent).toContain('context 0');
  });

  it('shows the hint only when onActivate is supplied', () => {
    const { container, rerender } = render(<ChartFrame {...baseProps()} />);
    const body = getBody(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' });

    expect(container.querySelector('.chart-tip-hint')).toBeNull();

    rerender(<ChartFrame {...baseProps({ onActivate: () => {} })} />);
    const body2 = getBody(container);
    body2.focus();
    fireEvent.keyDown(body2, { key: 'ArrowRight' });
    expect(container.querySelector('.chart-tip-hint')).toBeTruthy();
  });

  it('no tooltip renders when nothing is active', () => {
    const { container } = render(<ChartFrame {...baseProps()} />);
    expect(container.querySelector('.chart-tip')).toBeNull();
  });
});

describe('ChartFrame click-to-zoom (chart overhaul wave 4, Task W1, 29 Sep 2026 — replaces the drag-to-select brush)', () => {
  /** Indices 0-3 zoom to a whole day (`periodFor` returns a same-date
   *  morning..night range); index 4 (XS[4]=90) has nothing to zoom to,
   *  the "bins and products do nothing" case from the owner's brief. */
  function periodForIndex(i: number): PeriodParams | null {
    if (i >= 4) return null;
    const date = `2026-09-0${i + 1}`;
    return { key: 'range', range: { from: { date, shift: 'morning' }, to: { date, shift: 'night' } } };
  }

  it('a click on a mark zooms: onZoom is called with periodFor(i)', () => {
    const onZoom = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: periodForIndex, onZoom } })} />,
    );
    const body = getBody(container);

    // XS[2] = 50 — a plain click, no movement between down and up.
    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 50);

    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledWith(periodForIndex(2));
  });

  it('a drag over 6px does not zoom', () => {
    const onZoom = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: periodForIndex, onZoom } })} />,
    );
    const body = getBody(container);

    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 60); // 10px — a real drag

    expect(onZoom).not.toHaveBeenCalled();
  });

  it('Enter zooms the keyboard-active mark', () => {
    const onZoom = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: periodForIndex, onZoom } })} />,
    );
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 0
    fireEvent.keyDown(body, { key: 'Enter' });

    expect(onZoom).toHaveBeenCalledWith(periodForIndex(0));
  });

  it('a mark whose periodFor returns null (bins/products) does not zoom on click', () => {
    const onZoom = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: periodForIndex, onZoom } })} />,
    );
    const body = getBody(container);

    firePointer(body, 'pointerdown', 90); // XS[4] — periodForIndex(4) is null
    firePointer(body, 'pointerup', 90);

    expect(onZoom).not.toHaveBeenCalled();
  });

  it('onActivate wins over zoom when both are supplied', () => {
    const onActivate = vi.fn();
    const onZoom = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ onActivate, zoom: { periodFor: periodForIndex, onZoom } })} />,
    );
    const body = getBody(container);

    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 50);

    expect(onActivate).toHaveBeenCalledWith(2);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('never renders a .chart-brush element', () => {
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: periodForIndex, onZoom: vi.fn() } })} />,
    );
    const body = getBody(container);
    firePointer(body, 'pointerdown', 20);
    firePointer(body, 'pointermove', 80);
    firePointer(body, 'pointerup', 80);
    expect(container.querySelector('.chart-brush')).toBeNull();
  });
});

describe('ChartFrame mouse click activation (re-audit FIX 1, 29 Sep 2026)', () => {
  it('a click on a mark calls onActivate with the right index', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);

    // XS[2] = 50 — a plain click, no movement between down and up.
    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 50);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('no onActivate supplied: a click does not throw and does nothing special', () => {
    const { container } = render(<ChartFrame {...baseProps()} />); // no onActivate
    const body = getBody(container);

    expect(() => {
      firePointer(body, 'pointerdown', 50);
      firePointer(body, 'pointerup', 50);
    }).not.toThrow();
  });

  it('a small movement below the click/drag threshold still counts as a click', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);

    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 52); // 2px — well under CLICK_MAX_MOVE_PX (6)

    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('a movement at/above the threshold does not activate', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);

    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 60); // 10px — a real drag

    expect(onActivate).not.toHaveBeenCalled();
  });
});

/** Simulates a single touch tap (pointerdown then pointerup) at `x` on `body`. */
function touchTap(body: HTMLElement, x: number) {
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 });
  Object.defineProperty(down, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(down, 'pointerType', { value: 'touch', configurable: true });
  act(() => body.dispatchEvent(down));
  const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 });
  Object.defineProperty(up, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(up, 'pointerType', { value: 'touch', configurable: true });
  act(() => body.dispatchEvent(up));
}

describe('ChartFrame touch tap-then-activate', () => {
  it('first tap pins the mark (tooltip), second tap on the SAME pinned mark calls onActivate', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);

    touchTap(body, 50); // first tap: pins point 2, no activation
    expect(onActivate).not.toHaveBeenCalled();
    expect(container.querySelector('.chart-tip')?.textContent).toContain('Point 2');

    touchTap(body, 50); // second tap on the same pinned mark: activates
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('a tap on a DIFFERENT mark moves the pin instead of activating', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);

    touchTap(body, 50); // pins point 2
    expect(container.querySelector('.chart-tip')?.textContent).toContain('Point 2');

    touchTap(body, 30); // a different mark (point 1): moves the pin, no activation
    expect(onActivate).not.toHaveBeenCalled();
    expect(container.querySelector('.chart-tip')?.textContent).toContain('Point 1');
  });

  it('with zoom instead of onActivate: first tap pins, second tap on the same pin zooms', () => {
    const onZoom = vi.fn();
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'night' } } };
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: () => period, onZoom } })} />,
    );
    const body = getBody(container);

    touchTap(body, 50);
    expect(onZoom).not.toHaveBeenCalled();

    touchTap(body, 50);
    expect(onZoom).toHaveBeenCalledWith(period);
  });
});

describe('ChartFrame back navigation', () => {
  it('double-click calls onBack', () => {
    const onBack = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onBack })} />);
    const body = getBody(container);

    fireEvent.doubleClick(body);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keyboard '-' calls onBack", () => {
    const onBack = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onBack })} />);
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: '-' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('double-clicking the resize handle resets height, not onBack', () => {
    const onBack = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onBack, defaultH: 300 })} />);
    const handle = container.querySelector('.chart-resize')!;

    fireEvent.doubleClick(handle);
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe('ChartFrame resize handle', () => {
  it('ArrowUp/ArrowDown change the height and persist it (localStorage)', () => {
    const { container } = render(<ChartFrame {...baseProps({ chartId: 'resize-test', defaultH: 300 })} />);
    const handle = container.querySelector('.chart-resize')!;

    expect(handle.getAttribute('aria-valuenow')).toBe('300');

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(handle.getAttribute('aria-valuenow')).toBe('320');

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(handle.getAttribute('aria-valuenow')).toBe('280');

    expect(localStorage.getItem('sms.chartH.resize-test')).toBe('280');
  });

  it('double-click resets the height to defaultH', () => {
    const { container } = render(<ChartFrame {...baseProps({ chartId: 'resize-test-2', defaultH: 250 })} />);
    const handle = container.querySelector('.chart-resize')!;

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(handle.getAttribute('aria-valuenow')).toBe('270');

    fireEvent.doubleClick(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('250');
  });
});

describe('ChartFrame print classes', () => {
  it('renders the chart-frame/chart-frame-body classes for app.css to key off', () => {
    const { container } = render(<ChartFrame {...baseProps()} />);
    expect(container.querySelector('.chart-frame')).toBeTruthy();
    expect(container.querySelector('.chart-frame-body')).toBeTruthy();
  });

  it('does not render the resize handle or tooltip while printing, and a click does not zoom', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === 'print',
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const onZoom = vi.fn();
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'night' } } };
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: () => period, onZoom } })} />,
    );

    expect(container.querySelector('.chart-resize')).toBeNull();

    const body = getBody(container);
    firePointer(body, 'pointerdown', 20);
    firePointer(body, 'pointerup', 20);
    expect(onZoom).not.toHaveBeenCalled();
    expect(container.querySelector('.chart-tip')).toBeNull();
  });
});

describe('ChartFrame zoom tooltip hint', () => {
  function tipForNoHint(i: number): ChartTip | null {
    return { heading: `Point ${i}`, rows: [{ name: 'value', value: String(i * 10) }] };
  }

  function focusAndHover(container: HTMLElement) {
    const body = getBody(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 0
  }

  it('same shift (from === to) -> "Click to show this shift"', () => {
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'morning' } } };
    const { container } = render(
      <ChartFrame {...baseProps({ tipFor: tipForNoHint, zoom: { periodFor: () => period, onZoom: vi.fn() } })} />,
    );
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')?.textContent).toBe(W.chart.clickToShowShift);
  });

  it('same date, morning..night -> "Click to show this day"', () => {
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'night' } } };
    const { container } = render(
      <ChartFrame {...baseProps({ tipFor: tipForNoHint, zoom: { periodFor: () => period, onZoom: vi.fn() } })} />,
    );
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')?.textContent).toBe(W.chart.clickToShowDay);
  });

  it('anything else -> "Click to show these shifts"', () => {
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'evening' }, to: { date: '2026-09-02', shift: 'morning' } } };
    const { container } = render(
      <ChartFrame {...baseProps({ tipFor: tipForNoHint, zoom: { periodFor: () => period, onZoom: vi.fn() } })} />,
    );
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')?.textContent).toBe(W.chart.clickToShowRange);
  });

  it("zoom's own hint(i) overrides the built-in copy", () => {
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'morning' } } };
    const { container } = render(
      <ChartFrame
        {...baseProps({ tipFor: tipForNoHint, zoom: { periodFor: () => period, onZoom: vi.fn(), hint: () => 'Custom hint' } })}
      />,
    );
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')?.textContent).toBe('Custom hint');
  });

  it("the tip's own hint (from tipFor) takes priority over the zoom-based hint", () => {
    // baseProps' default tipFor always supplies hint: 'Open station 1'.
    const period: PeriodParams = { key: 'range', range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-01', shift: 'morning' } } };
    const { container } = render(
      <ChartFrame {...baseProps({ zoom: { periodFor: () => period, onZoom: vi.fn() } })} />,
    );
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')?.textContent).toBe('Open station 1');
  });

  it('no hint when periodFor returns null (bins/products) and no onActivate', () => {
    const { container } = render(
      <ChartFrame {...baseProps({ tipFor: tipForNoHint, zoom: { periodFor: () => null, onZoom: vi.fn() } })} />,
    );
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')).toBeNull();
  });

  it('no hint without zoom or onActivate at all', () => {
    const { container } = render(<ChartFrame {...baseProps({ tipFor: tipForNoHint })} />);
    focusAndHover(container);
    expect(container.querySelector('.chart-tip-hint')).toBeNull();
  });
});
