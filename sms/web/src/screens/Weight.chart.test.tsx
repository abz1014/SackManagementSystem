/**
 * Chart overhaul, wave 3, Task T6 (29 Sep 2026). Covers only what T6 changed
 * in `Weight.tsx`: the OverTime chart's `ChartFrame` tooltip and de-collided
 * gutter labels (`overTimeGutterLabels`), its drag-to-select brush handing a
 * shift-snapped `PeriodParams` built from the API's own `firstShiftDate` /
 * `firstShiftCode` / `lastShiftDate` / `lastShiftCode` subgroup fields
 * (962a18b) to `onSelectPeriod`, the Distribution chart's `packRow`-based
 * reference labels (`distributionRefLabels`), and the Sparkline's new hover
 * tooltip. Everything else about the screen (the headline, the figures, the
 * station table) is unchanged and covered by `Weight.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { render } from '../testkit/render';
import { META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { Envelope, SpcData, Subgroup, WeightStationsData } from '../api';
import {
  WeightScreen, Sparkline, overTimeGutterLabels, distributionRefLabels,
  distRefRowHeight, type DistRefLabelIn,
} from './Weight';
import { rectsIntersect, textPx, type Rect } from '../ui/chartLayout';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T23:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

function noop(): void {}

function baseProps(over: Partial<Parameters<typeof WeightScreen>[0]> = {}) {
  return {
    period: PERIOD,
    mode: 'time' as const,
    onModeChange: noop,
    chartType: 'cone' as const,
    onChartTypeChange: noop,
    chartStation: null,
    onChartStationChange: noop,
    onOpenStation: noop,
    onSeeOutside: noop,
    ...over,
  };
}

const STATIONS_OK = { stations: [] };

const WEIGHT_STATIONS_OK: Envelope<WeightStationsData> = {
  data: {
    from: '2026-08-24',
    to: '2026-09-07',
    days: 14,
    lineMeanG: 1948,
    targetG: 1950,
    productId: 231,
    productLabel: '201-IH0-SD',
    thresholdG: 5,
    minDaysHeld: 3,
    lineRejectRatePct: 2.1,
    stations: [],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
    limits: { loG: 1900, hiG: 2000 },
    rules: [],
    targetEffectiveFromUtc: '2026-09-01T00:00:00Z',
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
  },
  metadata: META_FIXTURE,
};

/** Two subgroups: an ordinary morning one, and one that straddles the
 *  evening→night shift boundary — the "night-straddling group" the brief
 *  asks the brush test to cover. */
const SUBGROUPS: Subgroup[] = [
  {
    ts: '2026-09-07T06:00:00.000Z', n: 40, mean: 1949, s: 2, xUcl: 1960, xLcl: 1940,
    sUcl: null, sLcl: null, xViolates: false, sViolates: false, nelson: [],
    firstShiftDate: '2026-09-07', firstShiftCode: 'morning',
    lastShiftDate: '2026-09-07', lastShiftCode: 'morning',
  },
  {
    ts: '2026-09-07T21:45:00.000Z', n: 38, mean: 1954, s: 2.4, xUcl: 1960, xLcl: 1940,
    sUcl: null, sLcl: null, xViolates: true, sViolates: false, nelson: [1],
    firstShiftDate: '2026-09-07', firstShiftCode: 'evening',
    lastShiftDate: '2026-09-07', lastShiftCode: 'night',
  },
];

function spcFixture(over: Partial<SpcData> = {}): Envelope<SpcData> {
  return {
    data: {
      specAgreement: null,
      type: 'cone',
      unit: 'g',
      station: null,
      implausible: 0,
      count: 78,
      mean: 1951.5,
      median: 1951,
      stdevOverall: 4.1,
      stdevWithin: 3.0,
      bucketMinutes: 30,
      bucketLabel: '30-minute',
      grandMean: 1951.5,
      sChartCenter: 1951.5,
      xbarOutOfControl: 1,
      nelsonFlagged: 0,
      subgroups: SUBGROUPS,
      stations: [],
      practicalThresholdG: 5,
      distinguishableStationCount: 0,
      flaggedStationCount: 0,
      histogram: [
        { start: 1930, end: 1940, count: 5 },
        { start: 1940, end: 1950, count: 30 },
        { start: 1950, end: 1960, count: 35 },
        { start: 1960, end: 1970, count: 8 },
      ],
      spec: { usl: 1970, lsl: 1930, nominal: 1950, source: 'product', productLabel: '201-IH0-SD' },
      capability: { cp: null, cpk: null, pp: null, ppk: null },
      generation: null,
      otherGenerationExcluded: 0,
      spansGenerations: false,
      xLimits: { valid: true, mrBar: 2.5, sigmaBetween: 2.2, halfWidth: 6.6, pairs: 400 },
      ...over,
    } as SpcData,
    metadata: META_FIXTURE,
  };
}

function routes(spcOver: Partial<SpcData> = {}) {
  return {
    '/api/weight-stations': WEIGHT_STATIONS_OK,
    '/api/spc': spcFixture(spcOver),
    '/api/production': { data: { groupBy: 'none', rows: [], states: null, implausible: 0, unattributed: null }, metadata: META_FIXTURE },
    '/api/stations': STATIONS_OK,
  };
}

async function waitForChart(container: HTMLElement): Promise<HTMLElement> {
  for (let i = 0; i < 20; i++) {
    const bodies = container.querySelectorAll('.chart-frame-body');
    if (bodies.length > 0) return bodies[0] as HTMLElement;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error('chart-frame-body never rendered');
}

describe('Weight Distribution — honours ChartFrame\'s resizable size.height (regression, 29 Sep 2026)', () => {
  afterEach(() => {
    try {
      localStorage.removeItem('sms.chartH.weight-distribution');
    } catch {
      /* jsdom localStorage always available in this harness; defensive only */
    }
  });

  it('draws the svg at the height dragged/persisted for this chart, not a hardcoded 250', async () => {
    // ChartFrame/useChartSize persists a dragged height under this key
    // (`sms.chartH.<chartId>`, `useChartSize.ts`) and reads it back on
    // mount — the same mechanism `layout-tests/charts.spec.ts`'s
    // ".chart-resize" test exercises against the OverTime chart in a real
    // browser. Before this fix, `Distribution` never read `size.height` at
    // all (`const H = 250` was a closed-over module constant), so the drag
    // handle moved the CONTAINER while the drawing inside stayed pinned —
    // this is that defect's regression test at the component level.
    localStorage.setItem('sms.chartH.weight-distribution', '400');
    installFakeFetch(routes());
    const { container } = render(<WeightScreen {...baseProps({ mode: 'dist' })} />);
    await waitForChart(container);
    const svg = container.querySelector('.chart-frame svg')!;
    expect(svg.getAttribute('height')).toBe('400');
    expect(svg.getAttribute('viewBox')).toMatch(/ 400$/);
  });

  it('falls back to the 250 default when nothing is stored', async () => {
    installFakeFetch(routes());
    const { container } = render(<WeightScreen {...baseProps({ mode: 'dist' })} />);
    await waitForChart(container);
    const svg = container.querySelector('.chart-frame svg')!;
    expect(svg.getAttribute('height')).toBe('250');
  });
});

describe('Weight OverTime — tooltip content', () => {
  it('states the group\'s time span, mean with unit, n cones, vs target, and the limits in force', async () => {
    installFakeFetch(routes());
    const { container } = render(<WeightScreen {...baseProps()} />);
    const body = await waitForChart(container);
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // first subgroup: 06:00, mean 1949

    const tip = container.querySelector('.chart-tip')!;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('06:00'); // time span start
    expect(tip.textContent).toContain('1,949'); // mean
    expect(tip.textContent).toContain('40'); // n cones
    expect(tip.textContent).toContain('vs target');
    expect(tip.textContent).toContain('1'); // vs target = 1949 - 1950 = -1g, signed value contains '1'
    expect(tip.textContent).toContain('upper limit');
    expect(tip.textContent).toContain('lower limit');
  });

  it('names the rule-1 violation for a flagged group only', async () => {
    installFakeFetch(routes());
    const { container } = render(<WeightScreen {...baseProps()} />);
    const body = await waitForChart(container);
    body.focus();

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // group 0: not xViolates
    expect(container.querySelector('.chart-tip')!.textContent).not.toContain('3σ');

    fireEvent.keyDown(body, { key: 'ArrowRight' }); // group 1: xViolates true
    expect(container.querySelector('.chart-tip')!.textContent).toContain('3σ');
  });
});

describe('Weight OverTime — brush selects a shift-snapped period from the API\'s own subgroup fields', () => {
  it('a drag across both groups snaps from the first group\'s FIRST shift to the straddling group\'s LAST shift (night)', async () => {
    const onSelectPeriod = vi.fn();
    installFakeFetch(routes());
    const { container } = render(<WeightScreen {...baseProps({ onSelectPeriod })} />);
    const body = await waitForChart(container);

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
    // The straddling group's own LAST shift is 'night', not its first
    // ('evening') — proving the brush reads lastShiftCode, not firstShiftCode,
    // off the LAST selected subgroup.
    expect(params.range.from).toEqual({ date: '2026-09-07', shift: 'morning' });
    expect(params.range.to).toEqual({ date: '2026-09-07', shift: 'night' });
  });

  it('renders no brush affordance when onSelectPeriod is not wired', async () => {
    installFakeFetch(routes());
    const { container } = render(<WeightScreen {...baseProps()} />);
    const body = await waitForChart(container);
    expect(body.getAttribute('title')).toBeNull();
  });
});

describe('overTimeGutterLabels — geometry: labels never intersect, even off-scale', () => {
  it('USL, target and LSL within 2g of each other — all in range — are still non-intersecting', () => {
    const fontPx = 12;
    const top = 16;
    const bottom = 204;
    const labels = overTimeGutterLabels(
      { usl: 1951, lsl: 1949 },
      1950,
      [1945, 1955],
      top, bottom, fontPx, 'g',
    );
    expect(labels).toHaveLength(3);
    const boxes: Rect[] = labels.map((l) => ({
      x: 0,
      y: l.labelY - fontPx * 0.7,
      w: textPx(l.text.length, fontPx),
      h: fontPx * 1.4,
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(rectsIntersect(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });

  it('two labels off the SAME edge ("off scale") are still de-collided from each other', () => {
    const fontPx = 12;
    const top = 16;
    const bottom = 204;
    // target and USL both far above the [lo, hi] domain — both pin to `top`.
    const labels = overTimeGutterLabels(
      { usl: 2100, lsl: 1949 },
      2050,
      [1945, 1955],
      top, bottom, fontPx, 'g',
    );
    const usl = labels.find((l) => l.kind === 'usl')!;
    const targetLabel = labels.find((l) => l.kind === 'target')!;
    expect(usl.text).toContain('off scale');
    expect(targetLabel.text).toContain('off scale');
    expect(usl.labelY).not.toBe(targetLabel.labelY);
    const boxes: Rect[] = labels.map((l) => ({
      x: 0, y: l.labelY - fontPx * 0.7, w: textPx(l.text.length, fontPx), h: fontPx * 1.4,
    }));
    expect(rectsIntersect(boxes[0]!, boxes[1]!)).toBe(false);
  });
});

describe('distributionRefLabels — packRow without overlap at any chart width', () => {
  function labelRect(l: { labelX: number; anchor: 'start' | 'middle' | 'end'; row: 0 | 1; text: string }, fontPx: number): Rect {
    const w = textPx(l.text.length, fontPx);
    const x0 = l.anchor === 'start' ? l.labelX : l.anchor === 'end' ? l.labelX - w : l.labelX - w / 2;
    const rowH = distRefRowHeight(fontPx);
    return { x: x0, y: l.row * rowH, w, h: rowH };
  }

  it.each([300, 900])('lower limit close to target, both far from upper limit, at width %d never overlap', (width) => {
    const fontPx = 12;
    // `lsl` and `target` sit close enough that row 0 alone cannot hold both
    // (their ~100-150px-wide labels overlap at a 40px x-gap) — packRow must
    // move one to row 1. `usl` sits far enough right that it never collides
    // with either on row 0. This is the two-row mechanism packRow offers,
    // not the (separately accepted) `overflow` case of three labels with no
    // room for any of them — see `packRow`'s own doc comment in
    // `chartLayout.ts` for why `overflow` exists at all.
    const items: DistRefLabelIn[] = [
      { key: 'lsl', x: 60, text: 'lower limit 1,930 g' },
      { key: 'target', x: 100, text: 'target 1,950 g' },
      { key: 'usl', x: 250, text: 'upper limit 1,970 g' },
    ];
    const out = distributionRefLabels(items, [8, width - 8], fontPx);
    expect(out).toHaveLength(3);
    const boxes = out.map((l) => labelRect(l, fontPx));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(rectsIntersect(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });
});

/**
 * Regression, chart overhaul wave 3 Task T9 red-team (29 Sep 2026):
 * `layout-tests/charts.spec.ts`'s "Weight: no chart text/mark overlap at
 * 600x900"/"900x1000" caught "target 1,960 g" overlapping "upper limit
 * 1,970 g" in a REAL browser render even though `distributionRefLabels`
 * correctly moved one label to row 1. The cause was `Distribution`'s own row
 * spacing (`DIST_REF_ROW_H`, a bare constant 13 — `BASE_FONT_PX` itself)
 * being SMALLER than the real rendered height of 13px text (~16-18px,
 * `fontPx * 1.4`): the two rows were spaced 13px apart while each label's
 * own box was taller than that gap. The test above models a label's box
 * height as the SAME `rowH` used to space rows — self-consistent, so it
 * could never have caught this; it only asserts `packRow`'s horizontal
 * de-collision. This test instead models the label's rendered box the way
 * `overTimeGutterLabels`' own tests above do (`fontPx * 1.4`, independent of
 * row spacing) at the row `y` `Weight.tsx`'s `Distribution` actually draws
 * text at (`REF_TOP + distRefRowHeight(fontPx) * (row + 1)`), so a too-small
 * `distRefRowHeight` would fail it exactly as the Playwright suite failed.
 */
describe('distributionRefLabels — row spacing matches the real rendered text height (regression)', () => {
  const REF_TOP = 16;

  function realLabelBox(
    l: { labelX: number; anchor: 'start' | 'middle' | 'end'; row: 0 | 1; text: string },
    fontPx: number,
    rowH: number,
  ): Rect {
    const w = textPx(l.text.length, fontPx);
    const x0 = l.anchor === 'start' ? l.labelX : l.anchor === 'end' ? l.labelX - w : l.labelX - w / 2;
    const labelY = REF_TOP + rowH * (l.row + 1);
    return { x: x0, y: labelY - fontPx * 0.7, w, h: fontPx * 1.4 };
  }

  it.each([600, 900])(
    '"target 1,960 g" and "upper limit 1,970 g" never overlap at chart width %d',
    (chartWidth) => {
      // BASE_FONT_PX from useChartSize.ts — the unscaled default this
      // screen renders at outside Wall mode, matching what the Playwright
      // suite observed (`--ui-scale` unset).
      const fontPx = 13;
      const rowH = distRefRowHeight(fontPx);
      // x positions close enough to force the same-row collision that made
      // packRow move "upper limit" to row 1 in the first place — the exact
      // shape the real chart hit at both 600 and 900px.
      const items: DistRefLabelIn[] = [
        { key: 'target', x: chartWidth * 0.42, text: 'target 1,960 g' },
        { key: 'usl', x: chartWidth * 0.55, text: 'upper limit 1,970 g' },
      ];
      const out = distributionRefLabels(items, [8, chartWidth - 8], fontPx);
      const boxes = out.map((l) => realLabelBox(l, fontPx, rowH));
      expect(rectsIntersect(boxes[0]!, boxes[1]!)).toBe(false);
    },
  );
});

describe('Sparkline — hover tooltip', () => {
  it('shows "day · mean g" for the hovered point', () => {
    const days = [
      { date: '2026-09-01', n: 40, mean: 1948, nelson: [] },
      { date: '2026-09-02', n: 41, mean: 1951, nelson: [] },
      { date: '2026-09-03', n: 39, mean: 1953, nelson: [] },
    ];
    const { container } = render(<Sparkline days={days} domain={[1940, 1960]} lineMeanG={1950} />);
    const hits = container.querySelectorAll('rect.hit');
    expect(hits.length).toBe(3);
    fireEvent.mouseEnter(hits[1]!);
    const tip = container.querySelector('.chart-tip')!;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('2 Sep');
    expect(tip.textContent).toContain('1,951');
  });

  it('no tooltip renders before any hover', () => {
    const days = [
      { date: '2026-09-01', n: 40, mean: 1948, nelson: [] },
      { date: '2026-09-02', n: 41, mean: 1951, nelson: [] },
      { date: '2026-09-03', n: 39, mean: 1953, nelson: [] },
    ];
    const { container } = render(<Sparkline days={days} domain={[1940, 1960]} lineMeanG={1950} />);
    expect(container.querySelector('.chart-tip')).toBeNull();
  });
});
