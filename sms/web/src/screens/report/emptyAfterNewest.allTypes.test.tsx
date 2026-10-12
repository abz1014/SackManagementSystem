/**
 * S3 X-3b (12 Oct 2026). User impact: X-3 (9279a09) made an empty period after the newest reading say
 * "No readings in this period - the newest reading is ..." on only 3 of the 18 report types (the ones with a
 * coverage headline). The other 15 kept the bare "Nothing recorded in this period." / their own "no ... in
 * this period" line. Every report section's empty line now goes through report/shared.tsx `Empty`, which
 * Report.tsx feeds with that sentence when (and only when) `periodAfterNewest` is certain.
 * Synthetic payloads: each fixture list is emptied, so every type is genuinely empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { renderWithLive } from '../../testkit/render';
import { LIVE_FIXTURE } from '../../testkit/fixtures';
import { resolvePeriod, type PeriodAnchor } from '../../lib/period';
import { reportEnvelope, type ReportKind } from '../../../../layout-tests/support/mocks';
import { REPORT_TYPES, type Envelope, type LiveData, type ReportFilters, type ReportHeader, type ReportType } from '../../api';
import { ReportScreen } from '../Report';

afterEach(() => { vi.unstubAllGlobals(); });

const LIVE_OCT: Envelope<LiveData> = {
  ...LIVE_FIXTURE,
  data: { lines: [{ ...LIVE_FIXTURE.data.lines[0]!, plantNowUtc: '2026-10-12T10:00:00Z' }] },
};
const ANCHOR: PeriodAnchor = {
  shiftDate: '2026-10-12', shiftCode: 'morning', shiftStartUtc: '2026-10-12T06:00:00.000Z',
  plantNowUtc: '2026-10-12T10:00:00.000Z', dataAsOfUtc: '2026-09-07T16:41:00Z', firstDay: '2026-08-05',
};
const AFTER = resolvePeriod('pick', ANCHOR, { from: '2026-10-01', to: '2026-10-02' });
const INSIDE = resolvePeriod('pick', ANCHOR, { from: '2026-09-01', to: '2026-09-02' });
const QUALIFIED = 'No readings in this period — the newest reading is 4:41 PM, 7 Sep.';

const COVERAGE0 = { daysInPeriod: 2, daysWithData: 0, firstDayWithData: null, lastDayWithData: null, complete: false };
const ZERO_LINE = { group: 'total', cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null };

/** Every array in a fixture becomes empty; counts stay. */
function emptied(v: unknown): unknown {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, emptied(x)]));
  return v;
}

/** Same, and every count becomes 0: the IFL reports test their totals as well as their lists. */
function zeroed(v: unknown): unknown {
  if (Array.isArray(v)) return [];
  if (typeof v === 'number') return 0;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, zeroed(x)]));
  return v;
}

const IFL_ZERO = new Set<ReportType>(['shift-production', 'rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary']);

function bodyFor(type: ReportType): unknown {
  switch (type) {
    case 'product': return { rows: [], unattributed: null, note: null };
    case 'machine-product': return { rows: [], cols: [], changes: [], note: null };
    case 'management-summary':
      return { coverage: { current: COVERAGE0, prior: COVERAGE0 }, kpis: [], rows: [], note: null };
    default: {
      const env = reportEnvelope(type as ReportKind) as { data: { report: Record<string, unknown> } };
      const r = (IFL_ZERO.has(type) ? zeroed(env.data.report) : emptied(env.data.report)) as Record<string, unknown>;
      if ('coverage' in r) r.coverage = COVERAGE0;
      if (type === 'daily' || type === 'shift') r.total = ZERO_LINE;
      return r;
    }
  }
}

function header(reportType: ReportType): ReportHeader {
  return {
    reportType, title: 'T', lineName: 'TP1 · Line 3 · Unit 2', plantName: 'TP1', unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-10-01', to: '2026-10-02', days: 2 }, filters: {},
    generatedAtPlantUtc: '2026-10-12T10:00:00Z', generatedBy: 'test-user', smsVersion: '0.0.0-test',
    definitions: 'KPI-DEFINITIONS.md', approval: 'awaiting', spansGenerations: false, sourceGeneration: 'SEP07', otherGenerationExcluded: null,
  };
}

function render(type: ReportType, period: typeof AFTER) {
  installFakeFetch({
    '/api/live': LIVE_OCT,
    '/api/stations': { stations: [] },
    '/api/products': { products: [] },
    [`/api/reports/${type}`]: { data: { header: header(type), report: bodyFor(type) }, metadata: {} },
  });
  return renderWithLive(
    <ReportScreen
      period={period} user={{ username: 'u', displayName: 'U', role: 'manager' }} type={type} onTypeChange={() => {}}
      filters={{} as ReportFilters} onShiftChange={() => {}} onStationChange={() => {}} onProductChange={() => {}}
      onOpenStation={() => {}} onOpenCode={() => {}}
    />,
  );
}

const main = (c: HTMLElement) => c.querySelector('main') ?? c;
const mainText = (c: HTMLElement) => main(c).textContent ?? '';

describe('every report type - an empty period after the newest reading', () => {
  it('covers all 18 types', () => {
    expect(REPORT_TYPES.length).toBe(18);
  });

  for (const type of REPORT_TYPES as readonly ReportType[]) {
    it(`${type}: names the newest reading, with no bare empty sentence left`, async () => {
      const { container } = render(type, AFTER);
      await waitFor(() => expect(mainText(container)).toContain(QUALIFIED));
      expect(mainText(container)).not.toContain('Nothing recorded in this period.');
    });

    it(`${type}: a genuinely empty period inside the data range makes no claim about the newest reading`, async () => {
      const { container } = render(type, INSIDE);
      await waitFor(() => expect(container.querySelector('.state, h1')).not.toBeNull());
      await new Promise((r) => setTimeout(r, 50));
      expect(mainText(container)).not.toContain('the newest reading is');
    });
  }
});
