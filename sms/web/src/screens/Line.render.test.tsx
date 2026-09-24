/**
 * Line — the structural missing-field guard (WS-CH, 23 Sep 2026 red-team
 * remediation, defect 1).
 *
 * `missingField.fuzz.test.tsx` (owned by a different worker) recorded this as
 * a KNOWN_DEFECT: `ae7a59b`'s `dataIssues`-driven `couldNotRead` fires only
 * when the SERVER names the missing field in `dataIssues[]`. A key deleted
 * downstream of that check — a stale cache entry, a partial write, a field
 * renamed under an old client — carries no `dataIssues` entry at all, and
 * `r?.cones ?? 0` cannot tell that apart from a genuine empty period. This
 * file is the two-sided regression test for the fix in `Line.tsx`'s
 * `fieldMissing()`: a structural check independent of, and in addition to,
 * `issueFor()`'s server-flagged check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, stripFields } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import type { Envelope, ProductionData, ProductionRow } from '../api';
import { LineScreen } from './Line';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsTo: '2026-09-07T23:59:59.000Z',
  live: true,
  days: 1,
};

const STATIONS_OK = { stations: [] };

const BASE_ROUTES = {
  '/api/live': LIVE_FIXTURE,
  '/api/stations': STATIONS_OK,
  '/api/product-at': { product: null, limits: null, neverRecorded: true },
  '/api/products': { products: [] },
  '/api/attention': {
    data: {
      window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
      period: { from: '2026-09-07', to: '2026-09-07', shift: null },
      findings: [], totalFindings: 0, thresholds: { driftG: 15, minDaysHeld: 3 },
    },
    metadata: META_FIXTURE,
  },
  '/api/machines/running': {
    data: {
      asOfUtc: '2026-09-07T16:40:00Z',
      windowMs: 7_200_000,
      windowStartUtc: '2026-09-07T14:40:00Z',
      machines: [],
      materialsRunning: 0,
      generation: LIVE_FIXTURE.data.lines[0]!.generation,
    },
    metadata: META_FIXTURE,
  },
};

function productionRoute(row: ProductionRow, dataIssues: ProductionData['dataIssues'] = []): Envelope<ProductionData> {
  return {
    data: { groupBy: 'none', rows: [row], unattributed: null, states: null, implausible: null, dataIssues },
    metadata: META_FIXTURE,
  };
}

function props() {
  return {
    period: PERIOD,
    onNavigate: noop,
    onOpenStation: noop,
    onOpenReading: noop,
    onOpenProduct: noop,
    canWrite: false,
  };
}

describe('Line — periodFigures catches a structurally missing field with NO dataIssues entry', () => {
  it('cones KEY absent, dataIssues EMPTY: the cones tile reads "—" with the could-not-read note, never a bare "0"', async () => {
    const holedRow = stripFields(
      { group: 'total', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 } as ProductionRow,
      ['cones'],
    );
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(holedRow, []) });

    const { findAllByText, container } = renderWithLive(<LineScreen {...props()} />);

    // The cones tile specifically: value '—', note is the could-not-read
    // sentence, never the digit '0' as the cones VALUE.
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBeGreaterThan(0);

    const figVals = Array.from(container.querySelectorAll('.fig-val')).map((el) => el.textContent);
    expect(figVals[0]).toMatch(/^—/); // the cones tile is the first of the four figures
    expect(figVals[0]).not.toMatch(/^0/);
  });

  it('two-sided partner: cones PRESENT as a genuine 0, dataIssues EMPTY: the tile reads the real "0", never a dash', async () => {
    const realRow: ProductionRow = {
      group: 'total', cones: 0, rejectedCones: 0, unmatchedRejects: 0,
      sacks: 800, sackWeightKg: 22_000, conesInRangePct: null, sacksPassedScalePct: null,
    };
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(realRow, []) });

    const { findAllByText, container } = renderWithLive(<LineScreen {...props()} />);
    await findAllByText('0'); // wait for the figures to land

    const figVals = Array.from(container.querySelectorAll('.fig-val')).map((el) => el.textContent);
    expect(figVals[0]).toMatch(/^0/);
    expect(container.textContent ?? '').not.toContain(W.fig.couldNotRead);
  });

  it('sacks/sackWeightKg KEY absent (either half), dataIssues EMPTY: the sacks tile reads "—" with the could-not-read note', async () => {
    const holedRow = stripFields(
      { group: 'total', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 } as ProductionRow,
      ['sackWeightKg'],
    );
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(holedRow, []) });

    const { findAllByText, container } = renderWithLive(<LineScreen {...props()} />);
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBeGreaterThan(0);

    const figVals = Array.from(container.querySelectorAll('.fig-val')).map((el) => el.textContent);
    expect(figVals[1]).toMatch(/^—/); // the sacks tile is the second of the four figures
  });

  it('rejectedCones KEY absent, dataIssues EMPTY: the rejected tile reads "—", never a bare "0" or a fabricated rate', async () => {
    const holedRow = stripFields(
      { group: 'total', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 } as ProductionRow,
      ['rejectedCones'],
    );
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(holedRow, []) });

    const { findAllByText, container } = renderWithLive(<LineScreen {...props()} />);
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBeGreaterThan(0);

    const figVals = Array.from(container.querySelectorAll('.fig-val')).map((el) => el.textContent);
    expect(figVals[2]).toMatch(/^—/); // the rejected tile is the third of the four figures
  });

  // WS-B7 (24 Sep 2026): `unmatchedRejects ?? rejected` used to fall back
  // silently to the pre-fix double-counting formula (see the block comment
  // above `unmatchedRejectsMissing` in Line.tsx) whenever the field itself
  // went missing from the payload — a payload shape `dataIssues` never
  // names, exactly the same structural gap `fieldMissing` closes elsewhere
  // in this file. The rejected COUNT is still readable (rejectedCones is
  // present); only the RATE, which depends on unmatchedRejects, must go
  // unreadable.
  it('unmatchedRejects KEY absent, rejectedCones PRESENT: the rate note reads could-not-read, never a computed percentage', async () => {
    const holedRow = stripFields(
      { group: 'total', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 } as ProductionRow,
      ['unmatchedRejects'],
    );
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(holedRow, []) });

    const { findAllByText, container } = renderWithLive(<LineScreen {...props()} />);
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBeGreaterThan(0);

    const figVals = Array.from(container.querySelectorAll('.fig-val')).map((el) => el.textContent);
    // The rejected COUNT is still readable — rejectedCones itself is present.
    expect(figVals[2]).toMatch(/^400/);
    // But no computed rate (e.g. "2% of everything weighed" from the old
    // rejected/(cones+rejected) fallback) may appear anywhere on screen.
    expect(container.textContent ?? '').not.toMatch(/\d+(\.\d+)?%\s*of everything weighed/i);
  });
});

// Task #8 (24 Sep 2026): MachinesBlock used to render a binary
// quiet/not-quiet row (`W.cone.quietWindow`, "nothing in this window") for
// every station with no cone inside the 2 h window — a station silent for
// a week read identically to one that stopped 90 minutes ago. It now grades
// the row from `machinesRunning.ts`'s new `state`/`lastSeenUtc` via
// `machineStateText`, exported from Line.tsx for Product/Running to reuse.
describe('Line — MachinesBlock renders the graded per-machine state, not a flat quiet/not-quiet', () => {
  it('a quiet, a stale and a silent machine each render their own words, anchored on asOfUtc (never the browser clock)', async () => {
    const asOfUtc = '2026-09-07T16:40:00Z';
    const machinesRoute = {
      data: {
        asOfUtc,
        windowMs: 7_200_000,
        windowStartUtc: '2026-09-07T14:40:00Z',
        machines: [
          {
            station: 1, stationName: 'Station 1', machineName: 'M1', materialId: null, productName: null,
            cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false,
            quiet: true, lastSeenUtc: '2026-09-07T13:40:00Z', state: 'quiet', // 3 h before asOfUtc
          },
          {
            station: 2, stationName: 'Station 2', machineName: 'M2', materialId: null, productName: null,
            cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false,
            quiet: true, lastSeenUtc: '2026-09-04T16:40:00Z', state: 'stale', // 3 days before
          },
          {
            station: 3, stationName: 'Station 3', machineName: 'M3', materialId: null, productName: null,
            cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false,
            quiet: true, lastSeenUtc: null, state: 'silent', // never seen
          },
        ],
        materialsRunning: 0,
        generation: LIVE_FIXTURE.data.lines[0]!.generation,
      },
      metadata: META_FIXTURE,
    };
    installFakeFetch({ ...BASE_ROUTES, '/api/machines/running': machinesRoute });

    const { findByText, container } = renderWithLive(<LineScreen {...props()} />);

    await findByText(W.machineState.silent);
    expect(container.textContent ?? '').toContain(W.machineState.quiet('3 h', '1:40 PM'));
    expect(container.textContent ?? '').toContain(W.machineState.stale('Fri 4 Sept'));
    // The old flat sentence must not appear now that a graded word is available.
    expect(container.textContent ?? '').not.toContain(W.cone.quietWindow);
  });
});

/* ===================================================================== *
 * WS-RG2 (23 Sep 2026 verification pass, gap 1) — the two-sided structural *
 * guard extended past periodFigures/kpiBlockNote (affa9bd) to the three    *
 * remaining Line.tsx call sites the verification pass found still on bare *
 * `?? 0`: OutputSpread (the per-day/per-shift bar chart), StationCompare   *
 * (the deviation-from-median chart) and StationRowGrid (the fourteen-box   *
 * grid). See each function's own comment in Line.tsx for why it CAN lie   *
 * in rendered text and is therefore fixed, not left as a documented       *
 * exception (unlike, e.g., a bar's raw pixel height on its own).          *
 * ===================================================================== */

const STATION_ROWS_OK: ProductionRow[] = [
  { group: '1', cones: 800, rejectedCones: 10, unmatchedRejects: 8, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null },
  { group: '2', cones: 750, rejectedCones: 5, unmatchedRejects: 5, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null },
  { group: '3', cones: 700, rejectedCones: 3, unmatchedRejects: 2, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null },
];

const SPREAD_ROWS_OK: ProductionRow[] = [
  { group: '2026-09-06', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 },
  { group: '2026-09-07', cones: 22_000, rejectedCones: 420, unmatchedRejects: 360, sacks: 850, sackWeightKg: 23_000, conesInRangePct: 97, sacksPassedScalePct: 95 },
];

const TOTALS_ROW_OK: ProductionRow = {
  group: 'total', cones: 42_000, rejectedCones: 820, unmatchedRejects: 710, sacks: 1650, sackWeightKg: 45_000, conesInRangePct: 97, sacksPassedScalePct: 95,
};

function groupedRoute(rows: ProductionRow[], groupBy: ProductionData['groupBy']): Envelope<ProductionData> {
  return { data: { groupBy, rows, unattributed: null, states: null, implausible: null, dataIssues: [] }, metadata: META_FIXTURE };
}

/**
 * `/api/production` answers three DIFFERENT groupings from ONE route
 * (`totals`, `perStation`, `perSpread` — Line.tsx:94-114) — a static fixture
 * would hand a station-grouped row set to the totals query and vice versa,
 * so this keys off `groupBy` the same way the existing REJECTS fuzz cases
 * above key off `rejectType`.
 */
function productionRouter(opts: { totals?: ProductionRow; stations?: ProductionRow[]; spread?: ProductionRow[] }) {
  return (req: RouteRequest) => {
    const groupBy = req.search.get('groupBy');
    if (groupBy === 'station') return groupedRoute(opts.stations ?? STATION_ROWS_OK, 'station');
    if (groupBy === 'day' || groupBy === 'shift') return groupedRoute(opts.spread ?? SPREAD_ROWS_OK, groupBy);
    return groupedRoute([opts.totals ?? TOTALS_ROW_OK], 'none');
  };
}

describe('OutputSpread — a structurally holed day is withheld from the whole chart, never drawn from a partly-fabricated dataset', () => {
  it('one day\'s `cones` KEY absent: the chart is replaced by the same sentence a failed refresh uses, not drawn with a false "0" bar', async () => {
    const holedSpread = [SPREAD_ROWS_OK[0]!, stripFields(SPREAD_ROWS_OK[1]!, ['cones'])];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ spread: holedSpread }) });

    const { container, findByText } = renderWithLive(<LineScreen {...props()} />);
    await findByText(W.conesPerDayUnavailable);

    // Never drawn with the holed day silently read as a false zero: OutputSpread's
    // own chart specifically (period.days === 1 here, so the per-shift aria
    // label — StationCompare's own svg is a DIFFERENT chart and stays), and
    // the resting sentence (which would have stated a false "busiest 0 cones
    // on 7 Sept" from the stripped row) is absent.
    expect(container.querySelector(`svg[aria-label="${W.conesPerShiftAria}"]`)).toBeNull();
    expect(container.textContent ?? '').not.toContain('busiest 0');
  });

  it('two-sided partner: every day\'s fields PRESENT (including a genuine 0-cone day) draws the real chart, not the caveat', async () => {
    const zeroDay = [SPREAD_ROWS_OK[0]!, { ...SPREAD_ROWS_OK[1]!, cones: 0 }];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ spread: zeroDay }) });

    const { container, queryByText } = renderWithLive(<LineScreen {...props()} />);
    await vi.waitFor(() => expect(container.querySelector(`svg[aria-label="${W.conesPerShiftAria}"]`)).not.toBeNull());
    expect(queryByText(W.conesPerDayUnavailable)).toBeNull();
  });
});

describe('StationRowGrid — a station row present but missing its own cones/rejectedCones key never reads as a false zero', () => {
  it('station 2\'s `cones` KEY absent: its own cell reads "—", the other two stations still read their real counts', async () => {
    const holedStations = [STATION_ROWS_OK[0]!, stripFields(STATION_ROWS_OK[1]!, ['cones']), STATION_ROWS_OK[2]!];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ stations: holedStations }) });

    const { container } = renderWithLive(<LineScreen {...props()} />);
    await vi.waitFor(() => expect(container.querySelectorAll('.st-val').length).toBeGreaterThan(0));

    const vals = Array.from(container.querySelectorAll('.st-val')).map((el) => el.textContent);
    // ids sorted ascending (Line.tsx stationIds): station 1, 2, 3 in order.
    expect(vals).toEqual(['800', '—', '700']);
  });

  it('two-sided partner: station 2\'s `cones` PRESENT as a genuine 0 reads the real "0", never a dash', async () => {
    const zeroStation = [STATION_ROWS_OK[0]!, { ...STATION_ROWS_OK[1]!, cones: 0 }, STATION_ROWS_OK[2]!];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ stations: zeroStation }) });

    const { container } = renderWithLive(<LineScreen {...props()} />);
    await vi.waitFor(() => expect(container.querySelectorAll('.st-val').length).toBeGreaterThan(0));

    const vals = Array.from(container.querySelectorAll('.st-val')).map((el) => el.textContent);
    expect(vals).toEqual(['800', '0', '700']);
  });

  it('station 2\'s `rejectedCones` KEY absent: its tag states the field could not be read, never a silent blank claiming zero rejects', async () => {
    const holedStations = [STATION_ROWS_OK[0]!, stripFields(STATION_ROWS_OK[1]!, ['rejectedCones']), STATION_ROWS_OK[2]!];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ stations: holedStations }) });

    const { container } = renderWithLive(<LineScreen {...props()} />);
    await vi.waitFor(() => expect(container.querySelectorAll('.st-tag').length).toBeGreaterThan(0));

    const tags = Array.from(container.querySelectorAll('.st-tag')).map((el) => el.textContent);
    expect(tags[1]).toBe(W.fig.couldNotRead);
    // Station 1's own real 5 rejects (see STATION_ROWS_OK) still reads normally.
    expect(tags[0]).toBe(W.stationRejected(10));
  });

  it('two-sided partner: station 2\'s `rejectedCones` PRESENT as a genuine 0 shows no rejected tag (blank), not the could-not-read caveat', async () => {
    const zeroStation = [STATION_ROWS_OK[0]!, { ...STATION_ROWS_OK[1]!, rejectedCones: 0 }, STATION_ROWS_OK[2]!];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ stations: zeroStation }) });

    const { container } = renderWithLive(<LineScreen {...props()} />);
    await vi.waitFor(() => expect(container.querySelectorAll('.st-tag').length).toBeGreaterThan(0));

    const tags = Array.from(container.querySelectorAll('.st-tag')).map((el) => el.textContent);
    expect(tags[1]).not.toBe(W.fig.couldNotRead);
  });
});

describe('StationCompare / the shared stationsNote — a holed station is excluded from the median and the bars, and named in the note', () => {
  it('station 2\'s `cones` KEY absent: the block note states one station could not be read, and only the two readable stations\' bars are drawn', async () => {
    const holedStations = [STATION_ROWS_OK[0]!, stripFields(STATION_ROWS_OK[1]!, ['cones']), STATION_ROWS_OK[2]!];
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({ stations: holedStations }) });

    const { container, findByText } = renderWithLive(<LineScreen {...props()} />);
    await findByText(`1 ${W.fig.couldNotRead}`);

    // StationCompare's own DeviationBars: one bar per READABLE station only
    // (station 2 excluded, never drawn at a false median-relative height).
    const compareSvg = container.querySelector(`svg[aria-label="${W.stationsCompareAria}"]`);
    expect(compareSvg).not.toBeNull();
    expect(compareSvg?.querySelectorAll('rect').length).toBe(2);
  });

  it('two-sided partner: every station\'s fields PRESENT (no holes) draws all three bars and states no note', async () => {
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter({}) });

    const { container, queryByText } = renderWithLive(<LineScreen {...props()} />);
    await vi.waitFor(() => {
      const svg = container.querySelector(`svg[aria-label="${W.stationsCompareAria}"]`);
      expect(svg?.querySelectorAll('rect').length).toBe(3);
    });
    expect(queryByText(/could not be read this period/)).toBeNull();
  });
});
