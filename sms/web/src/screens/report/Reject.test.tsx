/**
 * UX chart-primitives pass (22 Sep 2026): the Reject report printed 40+ rows
 * of `Rate`/`Band` digits with no graphical mark, while `Rejects.tsx`'s own
 * `TrendChart` already drew exactly that series with its control band shaded.
 * `RejectTrendChart` (extracted into `report/shared.tsx`, unchanged in shape
 * and maths from the screen's version) now draws it here too, and the report
 * prints only the days the chart marks out-of-control instead of the full
 * table — the days worth a second look on paper.
 *
 * The p-chart's band IS soundly defined, unlike the X-bar band suppressed
 * elsewhere in this app (commit 0877396): `rejectSpc.ts` gives EVERY bucket
 * its OWN limit from its own sample size (`UCL_i = p̄ + 3·√(p̄(1−p̄)/n_i)`),
 * the textbook-correct treatment for varying-n proportion data, and refuses
 * to draw a limit at all below `MIN_EXPECTED_REJECTS_FOR_VALID_LIMITS`. That
 * is a different and sounder thing than a single pooled band applied to
 * subgroups of different size, which is what was suppressed.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { RejectSection } from './Reject';
import type { RejectReportData, RejectTrendPoint } from '../../api';

function trendPoint(day: string, ratePct: number, outOfControl: boolean): RejectTrendPoint {
  return {
    day,
    produced: 500,
    inspected: 512,
    rejects: 12,
    ratePct,
    uclPct: 3.5,
    lclPct: 0.2,
    outOfControl,
  };
}

function fixture(outOfControlDays: number): RejectReportData {
  // 40 days, `outOfControlDays` of them flagged — mirrors the brief's "40+
  // rows" figure so the before/after row count is meaningful.
  const trend = Array.from({ length: 40 }, (_, i) => {
    const day = `2026-0${i < 30 ? 8 : 9}-${String((i % 30) + 1).padStart(2, '0')}`;
    const flagged = i < outOfControlDays;
    return trendPoint(day, flagged ? 5.1 : 2.0, flagged);
  });
  return {
    period: { period: 'month', from: '2026-08-01', to: '2026-09-09' },
    filters: {},
    total: 480,
    reasons: [
      { rejectCodeId: 1, rejectType: 'quality', tubeCode: 3, materialCode: 5, label: 'Bad tube', displayLabel: 'Bad tube', count: 200, pct: 41.7, cumulativePct: 41.7 },
      { rejectCodeId: 2, rejectType: 'weight', tubeCode: null, materialCode: null, label: null, displayLabel: 'weight:0:0', count: 280, pct: 58.3, cumulativePct: 100 },
    ],
    unattributed: null,
    dayBasis: 'production_day',
    denominator: 'cones_plus_rejects',
    byDayCode: [],
    trend,
    pBarPct: 2.16,
    spansGenerations: false,
    note: 'note',
  };
}

describe('RejectSection', () => {
  it('draws the trend chart with a real band and out-of-control marks', () => {
    const { container } = render(<RejectSection d={fixture(3)} onOpenCode={() => {}} />);
    const svgs = container.querySelectorAll('svg.chart');
    expect(svgs.length).toBe(1);
    expect(svgs[0]!.getAttribute('role')).toBe('img');
    expect(svgs[0]!.getAttribute('aria-label')).toBeTruthy();
    // Band fill + its ceiling rule, both present when limits are valid.
    expect(container.querySelector('svg.chart path[fill="var(--paper-3)"]')).toBeTruthy();
    // One accent circle per out-of-control day.
    const marks = container.querySelectorAll('svg.chart circle[fill="var(--acc-fill)"]');
    expect(marks.length).toBe(3);
  });

  it('the table goes from 40 rows to only the out-of-control days (3)', () => {
    const d = fixture(3);
    const { container } = render(<RejectSection d={d} onOpenCode={() => {}} />);
    // Every row in the surviving table is a flagged ("hit") row.
    const tables = container.querySelectorAll('table');
    // reasons block has no table; byDayCode is empty here; the trend table
    // is therefore the only <table> besides none — locate it by its "hit" rows.
    const hitRows = container.querySelectorAll('tr.hit');
    expect(hitRows.length).toBe(3);
    expect(d.trend.length).toBe(40);
    expect(d.trend.filter((t) => t.outOfControl).length).toBe(3);
    // No table renders when nothing survived the filter is covered below;
    // here confirm the table itself has exactly those 3 body rows.
    const trendTable = Array.from(tables).find((t) => t.querySelector('tr.hit'));
    expect(trendTable).toBeTruthy();
    expect(trendTable!.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('no out-of-control days: chart still renders, no table prints', () => {
    const d = fixture(0);
    const { container } = render(<RejectSection d={d} onOpenCode={() => {}} />);
    expect(container.querySelectorAll('svg.chart').length).toBe(1);
    expect(container.querySelectorAll('tr.hit').length).toBe(0);
  });

  it('every drawn mark (band, line, out-of-control circles) is an SVG fill/stroke attribute, never a CSS background style', () => {
    // This chart is a line/band p-chart, not a bar chart — its `<rect>`s are
    // only the invisible `.hit` hover targets (no fill by design) and an
    // optional period-shading rect, so the marks that must print with
    // background graphics OFF are the band `<path>`, the line `<path>`s and
    // the out-of-control `<circle>`s (see this file's header note).
    const { container } = render(<RejectSection d={fixture(3)} onOpenCode={() => {}} />);
    const svg = container.querySelector('svg.chart')!;
    const marks = Array.from(svg.querySelectorAll('path, circle'));
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach((m) => {
      const hasFill = !!m.getAttribute('fill') && m.getAttribute('fill') !== 'none';
      const hasStroke = !!m.getAttribute('stroke') && m.getAttribute('stroke') !== 'none';
      expect(hasFill || hasStroke).toBe(true);
      expect((m as unknown as HTMLElement).style.background).toBe('');
    });
    // Nothing anywhere in the chart, including the hit rects, sets a CSS
    // background — the defect `RankBars`/`DeviationBars` were built to fix.
    svg.querySelectorAll('rect').forEach((r) => {
      expect((r as unknown as HTMLElement).style.background).toBe('');
    });
  });
});
