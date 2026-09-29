/**
 * Chart overhaul, wave 3, Task T4 (29 Sep 2026). Covers what changed in
 * `chart.tsx` this task: RefLine's gutter de-collision, the RULE 3 header
 * text, CategoryBars' new ChartFrame-based tooltip, and its brush commit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CategoryBars, RefLine, RefLineGutterProvider, type BarDatum } from './chart';
import { rectsIntersect, type Rect } from './chartLayout';
import { installDomStubs, installControllableResizeObserver, fireResize } from '../testkit/domStubs';
import type { ShiftRef } from '../lib/period';

installDomStubs();
// Overwrites the silent stub `installDomStubs()` installed above, for this
// file only (module state is per test file under vitest's default
// isolation — see `domStubs.ts`'s own doc comment). Safe for every other
// test in this file: without an explicit `fireResize` call the observer
// never fires, so nothing here changes for a test that never resizes.
installControllableResizeObserver();

afterEach(() => {
  cleanup();
});

/* --------------------------------------------------------------- RULE 3 */

describe('RULE 3 header text', () => {
  it('states the floating-tooltip-plus-readout rule, replacing the old readout-only text', () => {
    // `import.meta.url` is unusable for this: this file is jsdom-environment
    // (`.test.tsx`, `vitest.config.ts`'s `environmentMatchGlobs`), and jsdom
    // resolves relative module URLs against its own fake `http://localhost/`
    // document base rather than the real file:// one — confirmed by hand:
    // `new URL('.', import.meta.url).protocol` is `'http:'` here, not
    // `'file:'`. `__dirname` is unaffected (it comes from vite-node's CJS
    // interop shim, not from document base resolution) and always points at
    // this file's own real directory.
    const src = readFileSync(join(__dirname, 'chart.tsx'), 'utf8');
    expect(src).toContain(
      "RULE 3 — A floating tooltip, positioned so it never covers the hovered\n * mark (chartLayout.ts's placeTip), plus the existing readout line above the\n * chart. The readout is not removed: it is the aria-live, screen-reader and\n * wall-display path (a tooltip is invisible to all three), so every value the\n * tooltip states is stated in the readout too, in words rather than a\n * floating box.",
    );
    // And the OLD rule 3 statement — "THE HOVER READOUT IS A LINE OF TEXT
    // ABOVE THE CHART, never a floating tooltip" — no longer appears AS THE
    // RULE ITSELF. (A historical note below may still reference its old
    // wording in passing, per this codebase's "dated, superseded-not-deleted"
    // convention — this checks the rule statement, not every mention.)
    expect(src).not.toContain('RULE 3 — THE HOVER READOUT IS A LINE OF TEXT');
  });
});

/* -------------------------------------------------------- RefLine gutter */

function labelBox(text: string): Rect {
  const el = screen.getByText(text);
  const x = Number(el.getAttribute('x'));
  const y = Number(el.getAttribute('y'));
  const fontSize = Number(el.getAttribute('font-size')) || 12;
  // A conservative box, deliberately SMALLER than the gutter's own lineH
  // (fontSize * 1.3 in `RefLineGutterProvider`): using the full lineH here
  // would make two correctly-separated labels' boxes touch at EXACTLY the
  // same float value the de-collision math produced, and `12 * 1.3 !==
  // 15.6` in IEEE 754 — a 1e-14 rounding wobble was enough to flip
  // `rectsIntersect` to true on an otherwise-correct layout. Height from the
  // glyph size alone (no line-height padding) leaves real margin either way.
  return { x, y: y - fontSize, w: text.length * fontSize * 0.6, h: fontSize };
}

describe('RefLine placement="gutter"', () => {
  it('de-collides two labels registered at the same y', () => {
    render(
      <svg>
        <RefLineGutterProvider top={0} bottom={300} fontPx={12}>
          <RefLine y={100} x1={0} x2={200} label="row median" placement="gutter" />
          <RefLine y={100} x1={0} x2={200} label="Flag threshold" placement="gutter" tone="accent" />
        </RefLineGutterProvider>
      </svg>,
    );

    const a = labelBox('row median');
    const b = labelBox('Flag threshold');
    expect(rectsIntersect(a, b)).toBe(false);
    // Both were asked for y=100; at least one had to move to avoid the other.
    expect(a.y === b.y - 12 * 1.3 || b.y === a.y - 12 * 1.3 ? true : a.y !== b.y).toBe(true);
  });

  it('draws a leader tick for a label pushed off its natural y', () => {
    const { container } = render(
      <svg>
        <RefLineGutterProvider top={0} bottom={40} fontPx={12}>
          <RefLine y={20} x1={0} x2={200} label="a" placement="gutter" />
          <RefLine y={20} x1={0} x2={200} label="b" placement="gutter" />
        </RefLineGutterProvider>
      </svg>,
    );
    expect(container.querySelectorAll('.refline-leader').length).toBeGreaterThan(0);
  });

  it('falls back to the natural y, still rendering the label, with no provider', () => {
    render(
      <svg>
        <RefLine y={55} x1={0} x2={200} label="standalone" placement="gutter" />
      </svg>,
    );
    const el = screen.getByText('standalone');
    expect(Number(el.getAttribute('y'))).toBeCloseTo(55 + 12 * 0.35, 5);
  });

  it('deprecated labelInside maps onto gutter mode', () => {
    render(
      <svg>
        <RefLine y={30} x1={0} x2={100} label="legacy" labelInside />
      </svg>,
    );
    // Old labelInside drew at x2-2 with a paper-coloured stroke halo; gutter
    // mode draws at x2+8 (gutterX default) with no stroke halo.
    const el = screen.getByText('legacy');
    expect(el.getAttribute('x')).toBe('108');
    expect(el.getAttribute('stroke')).toBeNull();
  });
});

/* ------------------------------------------------------------ CategoryBars */

const DATA: BarDatum[] = [
  { key: 'd1', label: '1 Sep', value: 10 },
  { key: 'd2', label: '2 Sep', value: 20 },
  { key: 'd3', label: '3 Sep', value: 5 },
];

function renderBars(extra: Partial<Parameters<typeof CategoryBars>[0]> = {}) {
  return render(
    <CategoryBars data={DATA} ariaLabel="Test chart" resting="resting text" valueFmt={(v) => `${v} cones`} {...extra} />,
  );
}

/** The `.chart-tip` box `ChartFrame` renders on hover/focus — scoped so a
 *  query for a bar's own label text doesn't also match that same text
 *  rendered as an x-axis tick underneath the bars. */
function tip(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.chart-tip');
  if (!el) throw new Error('no .chart-tip rendered');
  return el as HTMLElement;
}

/** `ChartFrame`'s own focusable/keyboard-driven wrapper div. Found by class,
 *  not `getByRole('img')`: `CategoryBars`' inner `<svg>` carries the SAME
 *  `role="img"`/`aria-label` as this wrapper (see chart.tsx's own comment on
 *  that svg for why), so an accessible-role query here matches both. */
function frameBody(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.chart-frame-body');
  if (!el) throw new Error('no .chart-frame-body rendered');
  return el as HTMLElement;
}

describe('CategoryBars tooltip', () => {
  it('shows the bar label and value on keyboard focus + ArrowRight', () => {
    const { container } = renderBars();
    const body = frameBody(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' });

    // Tooltip heading is the bar's own label.
    expect(tip(container).querySelector('.chart-tip-h')?.textContent).toBe('1 Sep');
    // Tooltip's value row, formatted through the caller's valueFmt.
    expect(tip(container).textContent).toContain('10 cones');

    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(tip(container).querySelector('.chart-tip-h')?.textContent).toBe('2 Sep');
    expect(tip(container).textContent).toContain('20 cones');
  });

  it('appends the caller-supplied extra tip rows', () => {
    const { container } = renderBars({
      tip: (i) => (i === 0 ? { heading: 'ignored', rows: [{ name: 'Rejects', value: '2' }] } : null),
    });
    const body = frameBody(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(tip(container).textContent).toContain('Rejects');
    expect(tip(container).textContent).toContain('2');
    // Heading still comes from the bar's own label, not the caller's tip.
    expect(tip(container).querySelector('.chart-tip-h')?.textContent).toBe('1 Sep');
  });

  it('shows the resting text when nothing is hovered/focused', () => {
    const { container } = renderBars();
    expect(container.querySelector('.readout')?.textContent).toBe('resting text');
  });
});

describe('CategoryBars brush', () => {
  it('commits a snapped PeriodParams via keyboard (Shift+ArrowRight, then +)', () => {
    const refs: [ShiftRef, ShiftRef][] = [
      [{ date: '2026-09-01', shift: 'morning' }, { date: '2026-09-01', shift: 'night' }],
      [{ date: '2026-09-02', shift: 'morning' }, { date: '2026-09-02', shift: 'night' }],
      [{ date: '2026-09-03', shift: 'morning' }, { date: '2026-09-03', shift: 'night' }],
    ];
    const onSelect = vi.fn();
    const { container } = renderBars({ brush: { refs, onSelect } });

    const body = frameBody(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // active 0
    fireEvent.keyDown(body, { key: 'ArrowRight', shiftKey: true }); // active 1, anchor 0
    fireEvent.keyDown(body, { key: '+' }); // commit [0,1]

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      key: 'range',
      range: {
        from: { date: '2026-09-01', shift: 'morning' },
        to: { date: '2026-09-02', shift: 'night' },
      },
    });
  });

  it('does not render a brush affordance when no brush prop is given', () => {
    const { container } = renderBars();
    expect(container.querySelector('.chart-brush')).toBeNull();
  });
});

/* --------------------------------------------------- CategoryBars ticks */

/**
 * Layout defect fix (chart overhaul wave 3, `layout-tests/charts.spec.ts`'s
 * Line-600 case, 29 Sep 2026): "Morning"/"Evening" overlapped at 600px. The
 * old tick count came from `fittingTicks`, an estimate of how many labels
 * fit the WHOLE plot width — with few categories that estimate can say
 * "keep every one" while a single label is still wider than the one bar
 * SLOT it actually has to sit in. The fix measures the widest label with
 * `textPx` (the same estimator `chartLayout.ts` uses elsewhere) against the
 * real per-bar slot from the current layout, so it can only ever keep as
 * many ticks as their own slots can hold.
 *
 * 360px stands in for a real chart body inside a 600px viewport (nav rail +
 * page padding leave less than the full viewport for the chart) — the width
 * at which seven shift bars ("Morning"/"Evening"/"Night", cycled, matching
 * Line's real per-shift chart) is tight enough to force thinning.
 */
describe('CategoryBars tick thinning', () => {
  const SHIFT_DATA: BarDatum[] = Array.from({ length: 7 }, (_, i) => ({
    key: `s${i}`,
    label: ['Morning', 'Evening', 'Night'][i % 3]!,
    value: 1200 + i * 47,
  }));

  function flushWidth(el: Element, width: number) {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    try {
      act(() => fireResize(el, width));
    } finally {
      rafSpy.mockRestore();
    }
  }

  it('at 600px (a 360px chart body), shown x-axis labels never sit closer than the label\'s own measured width', () => {
    const { container } = renderBars({ data: SHIFT_DATA, ariaLabel: 'Cones weighed per shift' });
    const body = frameBody(container);
    flushWidth(body, 360);

    const svg = container.querySelector('svg.chart')!;
    // x-axis tick text sits at the bottom of the plot, distinct from the
    // bars/grid text above it — `y` close to the svg's own height.
    const svgHeight = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const ticks = Array.from(svg.querySelectorAll('text')).filter((t) => Number(t.getAttribute('y')) > svgHeight - 20);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThan(SHIFT_DATA.length); // thinning actually happened at this width

    const fontPx = Number(ticks[0]!.getAttribute('font-size')) || 13;
    const minPitch = Math.ceil(7 * fontPx * 0.6 + 4) + 12; // textPx('Evening'.length, fontPx) + the same padding CategoryBars adds
    const xs = ticks.map((t) => Number(t.getAttribute('x'))).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(minPitch - 1e-6);
    }
  });

  it('at a full 1036px fallback width, every shift tick still fits and none is dropped', () => {
    const { container } = renderBars({ data: SHIFT_DATA, ariaLabel: 'Cones weighed per shift' });
    // No fireResize: stays at useChartSize's 1036px fallback, comfortably
    // wide for seven short shift labels — a regression guard against
    // over-thinning once the fix is in place.
    const svg = container.querySelector('svg.chart')!;
    const svgHeight = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const ticks = svg.querySelectorAll('text');
    const bottomTicks = Array.from(ticks).filter((t) => Number(t.getAttribute('y')) > svgHeight - 20);
    expect(bottomTicks.length).toBe(SHIFT_DATA.length);
  });
});

describe('CategoryBars empty state', () => {
  it('renders NoChartData instead of ChartFrame for an empty data set', () => {
    render(<CategoryBars data={[]} ariaLabel="Empty chart" resting="—" />);
    expect(screen.queryByRole('img', { name: 'Empty chart' })).toBeNull();
    // getByText throws if the text is absent — reaching the next line proves it rendered.
    expect(screen.getByText('Nothing to draw for this period.').tagName).toBe('P');
  });
});
