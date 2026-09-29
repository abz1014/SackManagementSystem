/**
 * Chart overhaul, wave 2, Task T3. Plain `@testing-library/react` render —
 * `ChartFrame` needs no `LiveProvider`, so this deliberately does not go
 * through `testkit/render.tsx` (which mounts the whole `<App/>`). Only
 * `installDomStubs()` is needed, for the silent default `ResizeObserver`
 * `useChartSize` reaches for (`testkit/domStubs.ts`) — nothing here drives
 * a real resize, so the controllable stub is not needed either.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ChartFrame, type ChartFrameProps, type ChartTip } from './ChartFrame';
import { installDomStubs } from '../testkit/domStubs';

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
 * this repo's jsdom before writing this helper). `useChartBrush.test.tsx`
 * sidesteps this by calling the hook's handlers with plain object literals;
 * `ChartFrame` does not expose its handlers, so this dispatches a real
 * `MouseEvent` under the `pointer*` event names instead — `clientX`/
 * `button` DO come through a `MouseEvent` correctly (also verified), and
 * `pointerId`/`pointerType` land `undefined` on both sides of every
 * `e.pointerId !== s.pointerId` comparison the brush hook makes, which
 * holds (`undefined !== undefined` is `false`) exactly as a real single
 * mouse pointer would.
 *
 * `pointerId` is the one property that must NOT be left `undefined`:
 * `useChartBrush`'s own move/up handlers gate on
 * `s.pointerId == null || e.pointerId !== s.pointerId` — with a real
 * pointer, `s.pointerId` is captured on down and compared on every move/up;
 * left `undefined` on both sides, the loose `== null` check reads that as
 * "no pointer captured" and drops every move/up silently (verified: this
 * was the first cut of this helper, and it produced exactly that silent
 * drop). `MouseEventInit` has no `pointerId` field, so it is defined
 * directly on the constructed event before dispatch.
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

describe('ChartFrame brush', () => {
  it('a mouse drag commits sorted indices via the brush prop', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ brush: { onCommit, xs: XS } })} />,
    );
    const body = getBody(container);

    firePointer(body, 'pointerdown', 70);
    firePointer(body, 'pointermove', 20);
    firePointer(body, 'pointerup', 20);

    expect(onCommit).toHaveBeenCalledTimes(1);
    // drag ran right-to-left (70 -> 20), pixel span [20,70]: commits sorted
    // low index first. XS[0]=10 is OUTSIDE that span; XS[1]=30..XS[3]=70 are in it.
    const [i0, i1] = onCommit.mock.calls[0]!;
    expect(i0).toBeLessThanOrEqual(i1);
    expect(i0).toBe(1);
    expect(i1).toBe(3);
  });

  it("keyboard '+' commits the brush over the current active point", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ brush: { onCommit, xs: XS } })} />,
    );
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 0
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 1
    fireEvent.keyDown(body, { key: '+' });

    expect(onCommit).toHaveBeenCalledWith(1, 1);
  });

  it("keyboard shift+arrow extends the range, and '+' commits it", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ brush: { onCommit, xs: XS } })} />,
    );
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 0
    fireEvent.keyDown(body, { key: 'ArrowRight', shiftKey: true }); // anchor=0, active=1
    fireEvent.keyDown(body, { key: 'ArrowRight', shiftKey: true }); // active=2
    fireEvent.keyDown(body, { key: '+' });

    expect(onCommit).toHaveBeenCalledWith(0, 2);
  });
});

describe('ChartFrame brush commit does not warn during render (FIX 1 regression)', () => {
  /**
   * Stands in for `App`'s `zoomTo`/`Session` — a PARENT component whose own
   * setState runs off `ChartFrame`'s `onCommit`. Before the fix,
   * `useChartBrush`'s `commitOrCancel` called `onCommit` from inside a
   * `setBrush` functional updater, which React treats as render-phase work;
   * calling a parent's setState from there is exactly what produces
   * "Cannot update a component (`Session`) while rendering a different
   * component (`ChartFrame`)".
   */
  function Harness(props: { brush: { xs: number[] } }) {
    const [committed, setCommitted] = useState<[number, number] | null>(null);
    return (
      <div>
        <p data-testid="committed">{committed ? `${committed[0]}-${committed[1]}` : 'none'}</p>
        <ChartFrame
          {...baseProps({
            brush: {
              xs: props.brush.xs,
              onCommit: (i0, i1) => setCommitted([i0, i1]),
            },
          })}
        />
      </div>
    );
  }

  it('a pointer-drag brush commit triggers no console.error warning', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, getByTestId } = render(<Harness brush={{ xs: XS }} />);
    const body = getBody(container);

    firePointer(body, 'pointerdown', 70);
    firePointer(body, 'pointermove', 20);
    firePointer(body, 'pointerup', 20);

    expect(getByTestId('committed').textContent).toBe('1-3');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a keyboard (Shift+Arrow then '+') brush commit triggers no console.error warning", () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, getByTestId } = render(<Harness brush={{ xs: XS }} />);
    const body = getBody(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active = 0
    fireEvent.keyDown(body, { key: 'ArrowRight', shiftKey: true }); // anchor=0, active=1
    fireEvent.keyDown(body, { key: 'ArrowRight', shiftKey: true }); // active=2
    fireEvent.keyDown(body, { key: '+' });

    expect(getByTestId('committed').textContent).toBe('0-2');
    expect(errorSpy).not.toHaveBeenCalled();
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

  it('a drag-brush does NOT call onActivate', () => {
    const onActivate = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ onActivate, brush: { onCommit, xs: XS } })} />,
    );
    const body = getBody(container);

    firePointer(body, 'pointerdown', 70);
    firePointer(body, 'pointermove', 20);
    firePointer(body, 'pointerup', 20);

    expect(onCommit).toHaveBeenCalledTimes(1); // the brush itself still commits
    expect(onActivate).not.toHaveBeenCalled();
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

  it('a movement at/above the threshold, even with no brush configured, does not activate', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />); // no brush prop at all
    const body = getBody(container);

    firePointer(body, 'pointerdown', 50);
    firePointer(body, 'pointerup', 60); // 10px — a real drag, no brush to catch it

    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe('ChartFrame touch tap-then-activate', () => {
  it('first tap pins the mark (tooltip), second tap on the SAME pinned mark calls onActivate', () => {
    const onActivate = vi.fn();
    const { container } = render(<ChartFrame {...baseProps({ onActivate })} />);
    const body = getBody(container);

    const tap = (x: number) => {
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 });
      Object.defineProperty(down, 'pointerId', { value: 1, configurable: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch', configurable: true });
      act(() => body.dispatchEvent(down));
      const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 });
      Object.defineProperty(up, 'pointerId', { value: 1, configurable: true });
      Object.defineProperty(up, 'pointerType', { value: 'touch', configurable: true });
      act(() => body.dispatchEvent(up));
    };

    tap(50); // first tap: pins point 2, no activation
    expect(onActivate).not.toHaveBeenCalled();
    expect(container.querySelector('.chart-tip')?.textContent).toContain('Point 2');

    tap(50); // second tap on the same pinned mark: activates
    expect(onActivate).toHaveBeenCalledWith(2);
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

  it('does not render the resize handle, tooltip or brush while printing', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === 'print',
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const onCommit = vi.fn();
    const { container } = render(
      <ChartFrame {...baseProps({ brush: { onCommit, xs: XS } })} />,
    );

    expect(container.querySelector('.chart-resize')).toBeNull();

    const body = getBody(container);
    firePointer(body, 'pointerdown', 20);
    firePointer(body, 'pointermove', 80);
    firePointer(body, 'pointerup', 80);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
