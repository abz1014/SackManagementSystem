/**
 * UX Phase 8 Brief C: the failed-fetch-reads-as-zero defect class, locked
 * down for Weight's private `headline()` (Weight.tsx:500-518), reached only
 * through the mounted component.
 *
 * `WeightScreen` fires four independent fetches on mount: `getWeightStations`
 * (`/api/weight-stations`), `getSpc` twice — `coneLine` (always cone,
 * line-wide) and `spc` (the chart's own population, `cone` here since
 * `chartType="cone"` and `chartStation={null}`) — both against `/api/spc`,
 * and `getProduction`/`getStations` for the other figures and station names.
 * Each case below isolates ONE of those to a failure and leaves the rest
 * healthy, and is paired with its two-sided partner: a genuinely empty
 * period must still read as empty, never as "could not load", and a failed
 * fetch must never read as a clean bill of health.
 *
 * UX Phase 8 Brief C (21 Sep 2026).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { render } from '../testkit/render';
import { META_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { fmtG } from '../lib/fmt';
import type { Period } from '../lib/period';
import type { Envelope, SpcData, WeightStationsData, ProductionData } from '../api';
import { WeightScreen } from './Weight';

// `fetchRouter.ts`'s own contract: "a test that installs its own router must
// restore it itself ... or rely on Vitest's own vi.unstubAllGlobals() in a
// project-wide afterEach, which this repo does not configure." This file
// calls installFakeFetch() fresh inside every `it()` without ever restoring
// it (found during the D-7 flake hunt, DEFECTS.md — not itself the D-7
// mechanism, but a real violation of the same contract). Harmless today
// because each `it()` reinstalls a full route set before rendering, but a
// stacked, never-restored fake fetch is exactly the kind of latent
// cross-test contamination that race was hard to diagnose because of.
afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

function noop(): void {}

function baseProps() {
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
  };
}

const STATIONS_OK = { stations: [] };

const PRODUCTION_OK: Envelope<ProductionData> = {
  data: {
    groupBy: 'none',
    rows: [{ group: 'line', cones: 500, rejectedCones: 10, sacks: 20, sackWeightKg: 550, conesInRangePct: 98 }],
    states: null,
    implausible: 0,
    unattributed: null,
  },
  metadata: META_FIXTURE,
};

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
    stations: [
      {
        station: 1,
        n: 812,
        meanG: 1949,
        vsLineG: 1,
        vsTargetG: -1,
        daysHeld: 0,
        flagged: false,
        rejectRatePct: 2.0,
        lastAdjustedUtc: null,
        days: [],
        medianG: 1949,
        sdG: 3.2,
        restartedOn: null,
        centrelineG: 1949,
        sigmaDayToDay: 1.1,
        longestRun: 5,
        projection: null,
        targetBasis: 'station_material',
      },
    ],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
    limits: { loG: 1900, hiG: 2000 },
    rules: [],
    targetEffectiveFromUtc: '2026-09-01T00:00:00Z',
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
  },
  metadata: META_FIXTURE,
};

function spcFixture(count: number, mean: number): Envelope<SpcData> {
  return {
    data: {
      specAgreement: null,
      type: 'cone',
      unit: 'g',
      station: null,
      implausible: 0,
      count,
      mean,
      median: count > 0 ? mean : null,
      stdevOverall: count > 0 ? 4.1 : 0,
      stdevWithin: count > 0 ? 3.0 : 0,
      bucketMinutes: 30,
      bucketLabel: '30-minute',
      grandMean: mean,
      sChartCenter: mean,
      xbarOutOfControl: 0,
      nelsonFlagged: 0,
      subgroups: [],
      stations: [],
      practicalThresholdG: 5,
      distinguishableStationCount: 0,
      flaggedStationCount: 0,
      histogram: [],
      spec: { usl: null, lsl: null, nominal: null, source: 'none' },
      capability: { cp: null, cpk: null, pp: null, ppk: null },
    },
    metadata: META_FIXTURE,
  };
}

describe('Weight — the headline', () => {
  it('/api/spc REJECTS: headline is couldNotLoad; the honest-empty sentence is absent', async () => {
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': () => {
        throw new Error('plant connection down');
      },
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe(W.couldNotLoad));
    expect(h1.textContent).not.toContain('No cones were weighed in this period.');
  });

  /**
   * DEFECTS.md D-7 (captured 22 Sep 2026, fixed alongside this test): the
   * original flake needed a lucky Promise-resolution order across 124 test
   * files' worth of scheduler contention to become visible (roughly 1 in 74
   * full-suite runs). This test does not rely on luck: it holds `coneLine`'s
   * SECOND `/api/spc` call open on a promise this test controls, so the
   * exact intermediate render the race produces — `coneLine`'s key just
   * changed, its error/data just cleared, its refetch still in flight — can
   * be inspected directly and deterministically, on demand, every run.
   *
   * Mechanism reproduced: the screen's own top-of-screen guard
   * (`Weight.tsx:196`, `if (!st.data && !st.error) return <ScreenSkeleton/>`)
   * means the heading cannot exist at all until `/api/weight-stations` (`st`)
   * has resolved at least once, so the race is not reachable on first mount
   * (`productId` cannot visibly go null → real before the heading exists).
   * It IS reachable the way a real user hits it: `st` fails first
   * (`productId` stays `null`, the guard opens because `st.error` is set,
   * and the Stations block's own `Failed`+retry appears, `Weight.tsx:412`),
   * `coneLine`'s first `/api/spc` attempt (key `...:none`) also fails, and
   * THEN the user retries the stations fetch, which this time succeeds with
   * a real `productId`. `coneLine`'s poll key (`Weight.tsx:131`) carries
   * that `productId`, so the retry's success changes the key from `...:none`
   * to `...:231` the moment it lands, clearing `coneLine`'s own (real,
   * already-observed) error while its second attempt — held open here — is
   * still in flight.
   */
  it('deterministic: coneLine\'s error is cleared by a productId-driven key change while its refetch is still in flight — the heading must not read as empty', async () => {
    // `WeightScreen` fires TWO independent `usePolling` calls against
    // `/api/spc` with identical query params whenever `chartType === 'cone'`
    // and `chartStation === null` (this fixture's props) — `coneLine`
    // (feeds the headline) and `spc` (feeds the chart). Both carry
    // `productId` in their key, so both experience the same key-change race
    // at the same time; the fake router cannot tell their requests apart
    // (same pathname, same query string), so this test tracks /api/spc calls
    // as one combined count rather than pretending to isolate `coneLine`'s.
    let statsCalls = 0;
    let spcCallCount = 0;
    let rejectHeldSpc!: (e: Error) => void;
    const heldSpcPromise = new Promise<never>((_, rej) => {
      rejectHeldSpc = rej;
    });
    // vitest/node would otherwise report this as an unhandled rejection the
    // instant it settles, before the test's own `await` reaches it below.
    heldSpcPromise.catch(() => {});

    installFakeFetch({
      '/api/weight-stations': () => {
        statsCalls += 1;
        if (statsCalls === 1) throw new Error('plant connection down');
        return WEIGHT_STATIONS_OK;
      },
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': () => {
        spcCallCount += 1;
        // Calls 1-2: coneLine's and spc's first attempts, both key
        // `...:none` (weight-stations hasn't resolved yet) — fail fast, the
        // way the flake capture's mock did.
        if (spcCallCount <= 2) throw new Error('plant connection down');
        // Calls 3+: coneLine's and spc's refetches after the key changes to
        // `...:231` — held open deliberately so the cleared-but-not-yet-
        // answered render can be inspected on demand rather than hoped for.
        return heldSpcPromise;
      },
    });

    const { container, findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    // First render: /api/weight-stations already failed (st.error, no
    // productId) and both /api/spc calls failed too (key `...:none`) — the
    // `couldNotLoad` state the original flake's `waitFor` observed.
    await waitFor(() => expect(h1.textContent).toBe(W.couldNotLoad));
    expect(statsCalls).toBe(1);
    expect(spcCallCount).toBe(2);

    // Retry the stations fetch (the Stations block's own Failed+retry). This
    // time it succeeds and carries productId: 231, changing coneLine's (and
    // spc's) key the instant it lands — while coneLine's error from its
    // first /api/spc rejection is still showing on screen.
    const stationsSection = within(container).getByText(W.weight.stationsTable).closest('section');
    if (!stationsSection) throw new Error('Stations block not found');
    fireEvent.click(within(stationsSection).getByRole('button', { name: W.retry }));

    // Wait for both post-retry /api/spc calls to have been issued — proof
    // the key change happened and coneLine's refetch is now in flight. Per
    // `keepDataAcrossKeyChange` (`lib/live.tsx`), coneLine's error and data
    // are cleared the instant this happens, before this call answers.
    await waitFor(() => expect(spcCallCount).toBe(4));

    // THE ASSERTION: with the post-retry /api/spc calls deliberately held
    // open, coneLine has no error (cleared by the key change) and no data
    // (never had any) — exactly "loading", not "empty". Before this pass's
    // fix, `headline()` could not tell the two apart and asserted the
    // honest-empty sentence about a plant it had not actually checked. This
    // state is stable (the held-open promise means nothing further updates
    // it), so a direct synchronous check is the honest assertion — a
    // `waitFor` wrapping it would only obscure a real failure as a timeout.
    expect(h1.textContent).not.toBe('No cones were weighed in this period.');

    // Resolve the held-open calls (rejecting, like their predecessors) and
    // confirm the headline settles back to the true failure state.
    rejectHeldSpc(new Error('plant connection down'));
    await waitFor(() => expect(h1.textContent).toBe(W.couldNotLoad));
  });

  it('/api/spc RESOLVES with count 0: headline IS the honest-empty sentence', async () => {
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(0, 0),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe('No cones were weighed in this period.'));
    // Two-sided: must not be confused with the failure sentence above.
    expect(h1.textContent).not.toBe(W.couldNotLoad);
  });

  it('/api/spc resolves, /api/weight-stations REJECTS: headline states the mean AND names the station-data failure; "Every station is steady." is absent', async () => {
    const mean = 1948.3;
    installFakeFetch({
      '/api/weight-stations': () => {
        throw new Error('plant connection down');
      },
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, mean),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toContain(W.weight.headlineStationDataFailed));
    expect(h1.textContent).toContain(fmtG(mean));
    // The exact trap this phase exists to close: an empty/unavailable
    // station array must never read as a clean bill of health.
    expect(h1.textContent).not.toContain(W.weight.allStationsSteady);
  });
});

/**
 * Weight brief item 1 (23 Sep 2026): the line-level counterpart of the
 * per-row `vs target` column. `132,552 cones × ~9 g below target` was the
 * largest fact in the audit's own evidence and had never been stated once —
 * only restated fourteen times as fourteen small per-station numbers. These
 * pin the new sentence to appear ONLY when the data makes the claim safe,
 * per the brief's own conditions: (nearly) all stations agree on one side of
 * a SINGLE shared target.
 */
function station(overrides: Partial<WeightStationsData['stations'][number]>): WeightStationsData['stations'][number] {
  return {
    station: 1,
    n: 812,
    meanG: 1949,
    vsLineG: 1,
    vsTargetG: -1,
    daysHeld: 0,
    flagged: false,
    rejectRatePct: 2.0,
    lastAdjustedUtc: null,
    days: [],
    medianG: 1949,
    sdG: 3.2,
    restartedOn: null,
    centrelineG: 1949,
    sigmaDayToDay: 1.1,
    longestRun: 5,
    projection: null,
    targetBasis: 'station_material',
    ...overrides,
  };
}

function weightStationsFixture(stations: WeightStationsData['stations']): Envelope<WeightStationsData> {
  return {
    data: {
      ...WEIGHT_STATIONS_OK.data,
      stations,
    },
    metadata: META_FIXTURE,
  };
}

describe('Weight — the line-level offset sentence', () => {
  it('all stations read the same side of one shared 1,960 g target: states the offset as one line-wide fact', async () => {
    // Ten stations, every one below the SAME 1,960 g target by 7-12 g —
    // the audit's own live evidence, at a size that still clears the
    // "nearly all" thresholds. meanG - vsTargetG is 1960 for every row.
    const offsets = [12, 10, 9, 9, 9, 9, 8, 8, 8, 7];
    const stations = offsets.map((off, i) =>
      station({ station: i + 1, meanG: 1960 - off, vsTargetG: -off, targetBasis: 'station_material' }),
    );
    installFakeFetch({
      '/api/weight-stations': weightStationsFixture(stations),
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, 1950.07),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() =>
      expect(h1.textContent).toContain(
        W.weight.lineOffset(10, 10, '7', '12', W.weight.below, fmtG(1960)),
      ),
    );
    expect(h1.textContent).toContain('line-wide offset');
  });

  it('stations disagree (split roughly evenly above/below): the offset sentence is absent', async () => {
    // Same shared 1,960 g target, but five stations read above it and five
    // below — no single side to state a fact about, so the per-row `vs
    // target` column is left to speak for itself.
    const stations = [
      ...[12, 10, 9, 8, 7].map((off, i) => station({ station: i + 1, meanG: 1960 - off, vsTargetG: -off })),
      ...[12, 10, 9, 8, 7].map((off, i) => station({ station: i + 6, meanG: 1960 + off, vsTargetG: off })),
    ];
    installFakeFetch({
      '/api/weight-stations': weightStationsFixture(stations),
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, 1950.07),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain(fmtG(1950.07)));

    expect(h1.textContent).not.toContain('line-wide offset');
  });

  it('several targets are in force among the stations (different materials): the offset sentence is absent', async () => {
    // All ten stations read below their own target — same SIGN — but half
    // are judged against a 1,960 g material and half against a 2,050 g
    // material, so there is no single shared target to name a range against.
    const stations = [
      ...[12, 10, 9, 9, 8].map((off, i) => station({ station: i + 1, meanG: 1960 - off, vsTargetG: -off })),
      ...[12, 10, 9, 9, 8].map((off, i) => station({ station: i + 6, meanG: 2050 - off, vsTargetG: -off })),
    ];
    installFakeFetch({
      '/api/weight-stations': weightStationsFixture(stations),
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, 1950.07),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain(fmtG(1950.07)));

    expect(h1.textContent).not.toContain('line-wide offset');
  });

  it('too few stations resolved a target (several materials mixed): the offset sentence is absent', async () => {
    // Coverage below the "nearly all" threshold — most stations ran more
    // than one material in the window and have no single target to be
    // signed against (targetBasis 'mixed', vsTargetG null).
    const stations = [
      station({ station: 1, meanG: 1948, vsTargetG: -12, targetBasis: 'station_material' }),
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
        station({ station: n, meanG: 1948, vsTargetG: null, targetBasis: 'mixed', materialsInWindow: 2 }),
      ),
    ];
    installFakeFetch({
      '/api/weight-stations': weightStationsFixture(stations),
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, 1950.07),
    });

    const { findByRole } = render(<WeightScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain(fmtG(1950.07)));

    expect(h1.textContent).not.toContain('line-wide offset');
  });
});

/**
 * DEFECTS.md (22 Sep 2026), reacting to D-1 (62263da): correctly sizing SPC
 * subgroups exposed that the X̄ control band itself does not fit this
 * process — measured ~16% of subgroups "out of control" at month scale
 * against an expected ~0.3% for a stable process. The owner's decision was
 * to suppress the violation/pattern marks and the sentence naming their
 * counts until the limit model is fixed, while leaving spc.ts's computation
 * on the wire. This pins that suppression so it cannot quietly come back
 * before the limit model is actually corrected.
 */
describe('Weight — X̄ violation/pattern suppression (DEFECTS.md, 22 Sep 2026)', () => {
  it('a subgroup with xViolates AND a Nelson pattern draws no accent-fill dot, and no sentence states the violation/pattern counts', async () => {
    const violating: Envelope<SpcData> = spcFixture(500, 1948);
    violating.data.xbarOutOfControl = 3;
    violating.data.nelsonFlagged = 2;
    violating.data.subgroups = [
      {
        ts: '2026-09-07T09:00:00.000Z', n: 82, mean: 1948, s: 3.0,
        xUcl: 1949, xLcl: 1947, sUcl: 4, sLcl: 2,
        xViolates: true, sViolates: false, nelson: [2, 3],
      },
      {
        ts: '2026-09-07T09:15:00.000Z', n: 80, mean: 1949, s: 3.1,
        xUcl: 1949, xLcl: 1947, sUcl: 4, sLcl: 2,
        xViolates: false, sViolates: false, nelson: [],
      },
    ];

    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': violating,
    });

    const { container, findByRole } = render(<WeightScreen {...baseProps()} />);
    await findByRole('heading', { level: 1 });
    await waitFor(() => expect(container.querySelectorAll('svg.chart path').length).toBeGreaterThan(0));

    // The dot mark: previously `p.nelson.length > 0 || p.xViolates` drew a
    // <circle fill="var(--acc-fill)">. With a genuinely violating subgroup in
    // the fixture, none should be drawn.
    const accentDots = Array.from(container.querySelectorAll('svg.chart circle')).filter(
      (c) => c.getAttribute('fill') === 'var(--acc-fill)',
    );
    expect(accentDots).toHaveLength(0);

    // The "Over this period" sentence must not assert the band's counts —
    // that was the same over-claim in words rather than a mark.
    const bodyText = container.textContent ?? '';
    expect(bodyText).not.toContain('control band');
    expect(bodyText).not.toContain('non-random pattern');
    // And nothing may say the process IS in control either — that would be
    // the same unsupported claim inverted.
    expect(bodyText).not.toMatch(/in control/i);
  });
});
