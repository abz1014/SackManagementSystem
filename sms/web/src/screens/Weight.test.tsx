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
import { fmtG, fmtInt } from '../lib/fmt';
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
      // One source generation, and a valid X̄ band — see api.ts's merged
      // SpcData block (23 Sep 2026). Tests that need the other cases override
      // these two fields on the fixture they build.
      generation: null,
      otherGenerationExcluded: 0,
      spansGenerations: false,
      xLimits: { valid: true, mrBar: 2.5, sigmaBetween: 2.2, halfWidth: 6.6, pairs: 400 },
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
 * DEFECTS.md D-10, restored 23 Sep 2026.
 *
 * The 22 Sep suppression removed BOTH the rule-1 violation marks and the
 * Nelson pattern marks, because both were judged against X̿ ± 3σ_within/√n —
 * a band that assumes zero movement between one group and the next and
 * flagged 16-38% of groups on real data. spc.ts replaced that band (6052b69)
 * with an I-MR band on the group averages themselves. What comes back, and
 * what does not, is measured, not assumed:
 *
 *  - RULE 1 (xViolates) IS restored, gated on `xLimits.valid`.
 *  - RULES 2-8 (nelson) are NOT. They share the corrected sigma now, but
 *    measured 23 Sep 2026 against the two real source generations they still
 *    flag 54.8% (July full range), 38.8% and 37.6% (September) of groups.
 *
 * These four cases pin that split, and the band-invalid gate, so neither
 * half can drift back on its own.
 */
describe('Weight — X̄ rule 1 restored, patterns still withheld (DEFECTS.md D-10, 23 Sep 2026)', () => {
  /** One violating subgroup that ALSO carries Nelson patterns, and one clean one. */
  function violatingFixture(): Envelope<SpcData> {
    const f: Envelope<SpcData> = spcFixture(500, 1948);
    f.data.xbarOutOfControl = 1;
    f.data.nelsonFlagged = 1;
    f.data.subgroups = [
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
    return f;
  }

  /** A subgroup carrying Nelson patterns but NOT a rule-1 violation. */
  function patternOnlyFixture(): Envelope<SpcData> {
    const f = violatingFixture();
    f.data.xbarOutOfControl = 0;
    f.data.subgroups[0]!.xViolates = false;
    return f;
  }

  async function renderWith(spc: Envelope<SpcData>) {
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spc,
    });
    const r = render(<WeightScreen {...baseProps()} />);
    await r.findByRole('heading', { level: 1 });
    await waitFor(() => expect(r.container.querySelectorAll('svg.chart path').length).toBeGreaterThan(0));
    return r;
  }

  const accentDots = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('svg.chart circle')).filter(
      (c) => c.getAttribute('fill') === 'var(--acc-fill)',
    );

  it('draws one accent dot for the rule-1 violation, and states the count', async () => {
    const { container } = await renderWith(violatingFixture());
    expect(accentDots(container)).toHaveLength(1);
    expect(container.textContent ?? '').toContain(W.weight.outsideBand('1', '2'));
  });

  it('a Nelson pattern alone draws NO dot — rules 2-8 stay withheld, and the screen says so', async () => {
    const { container } = await renderWith(patternOnlyFixture());
    expect(accentDots(container)).toHaveLength(0);
    const body = container.textContent ?? '';
    expect(body).toContain(W.weight.patternsWithheld);
    // The old over-claim must not return in words either.
    expect(body).not.toContain('non-random pattern');
    // And nothing may say the process IS in control — the same unsupported
    // claim inverted.
    expect(body).not.toMatch(/in control/i);
  });

  it('xLimits.valid === false: no dot is drawn even for a subgroup flagged xViolates, and the band is named as absent', async () => {
    const f = violatingFixture();
    f.data.xLimits = { valid: false, mrBar: 0, sigmaBetween: 0, halfWidth: 0, pairs: 1 };
    const { container } = await renderWith(f);
    expect(accentDots(container)).toHaveLength(0);
    const body = container.textContent ?? '';
    expect(body).toContain(W.weight.bandInvalid);
    expect(body).not.toContain(W.weight.outsideBand('1', '2'));
  });

  it('a period spanning more than one source generation says how much it left out', async () => {
    const f = violatingFixture();
    f.data.count = 55058;
    f.data.otherGenerationExcluded = 164884;
    f.data.spansGenerations = true;
    const { container } = await renderWith(f);
    const body = container.textContent ?? '';
    expect(body).toContain(W.weight.oneGeneration(fmtInt(55058), fmtInt(164884)));
    // Never names HOW a generation arose — the case this must read correctly
    // for at IFL is their own 5 Aug table rebuild.
    expect(body.toLowerCase()).not.toContain('simulator');
  });

  it('a single-generation period adds no exclusion sentence at all', async () => {
    const { container } = await renderWith(violatingFixture());
    expect(container.textContent ?? '').not.toContain('one generation of the source tables');
  });
});

/**
 * FRICTION AUDIT F6 (23 Sep 2026) — THE FIGURE TILE AND THE STATION TABLE
 * MUST STATE ONE THING ABOUT THE PERIOD'S TARGET.
 *
 * Measured before the fix, on epoch 9 (2026-08-05 → 08-20, real IFL data):
 * this tile printed "target 1,960 g (201-IH0-SD) · in force since
 * 11/09/2026" for a period that ended on 20 August — a start date three
 * weeks AFTER the readings it was judging — while Report › Cone weight, over
 * the same service and the same window, refused to state a target at all.
 * Every limits version in `sms.product_limit_version` is a migration-027
 * bootstrap stamped 2026-09-11 with "true start unknown", so for August SMS
 * genuinely does not know what applied.
 *
 * The server now withholds `targetG` and supplies `targetOmittedReason`.
 * These cases pin that the tile prints the reason rather than falling back
 * to a bare "No product target" — a blank with no explanation is how the
 * contradiction went unnoticed — and that the three states stay distinct:
 * withheld, lower-bound-but-usable, and plainly dated.
 */
describe('Weight — the period’s target', () => {
  const OMITTED =
    'No target is stated: the earliest limits this system holds for that product were first recorded on ' +
    '2026-09-11, after this period ended on 2026-08-20.';

  async function renderStations(mutate: (d: WeightStationsData) => void) {
    const f: Envelope<WeightStationsData> = JSON.parse(JSON.stringify(WEIGHT_STATIONS_OK));
    mutate(f.data);
    installFakeFetch({
      '/api/weight-stations': f,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': spcFixture(500, 1948),
    });
    const r = render(<WeightScreen {...baseProps()} />);
    await r.findByRole('heading', { level: 1 });
    return r;
  }

  it('a withheld target prints the server’s reason, not a bare number and not a bare dash', async () => {
    const { container } = await renderStations((d) => {
      d.targetG = null;
      d.targetEffectiveFromUtc = '2026-09-11T15:03:15.957Z';
      d.targetEffectiveIsLowerBound = true;
      d.targetEffectiveAfterWindowEnd = true;
      d.targetOmittedReason = OMITTED;
      d.stations[0]!.vsTargetG = null;
      d.stations[0]!.targetAfterWindowEnd = true;
    });
    const body = container.textContent ?? '';
    expect(body).toContain(OMITTED);
    // The defect in its exact original form: a target stated with a start
    // date that postdates the period.
    expect(body).not.toContain(W.reports.target(fmtG(1950), '201-IH0-SD'));
    expect(body).not.toContain(W.reports.targetSince('11/09/2026, 15:03:15'));
  });

  it('a lower-bound but usable version KEEPS its number and says “no later than”, never “since”', async () => {
    const { container } = await renderStations((d) => {
      d.targetEffectiveIsLowerBound = true;
      d.targetEffectiveAfterWindowEnd = false;
      d.targetOmittedReason = null;
    });
    const body = container.textContent ?? '';
    expect(body).toContain(W.reports.target(fmtG(1950), '201-IH0-SD'));
    expect(body).toContain('in force no later than');
    expect(body).not.toContain('in force since');
  });

  it('a plainly dated version carries no qualifier at all (the untouched case)', async () => {
    const { container } = await renderStations(() => {});
    const body = container.textContent ?? '';
    expect(body).toContain(W.reports.target(fmtG(1950), '201-IH0-SD'));
    expect(body).toContain('in force since');
    expect(body).not.toContain('no later than');
  });
});

/**
 * FRICTION AUDIT F6, the CHART (23 Sep 2026) — the fourth and last surface.
 *
 * The block above pins the target TILE. Two lines below it on the same
 * screen, the control chart was still drawing a USL/LSL band, a Cp/Cpk and a
 * scale-against-product agreement from the same refused limits version:
 * measured on epoch 9 (2026-08-05 → 08-20, real IFL data, product 12) the
 * chart reported `usl 2000, lsl 1920, nominal 1960` and `Cp 1.564,
 * Cpk 1.209` against limits first recorded on 2026-09-11 — 22 days after the
 * last reading on it — while the tile beside it refused to state any target.
 *
 * `spc.ts` now routes through `resolvePeriodTarget` and withholds all three,
 * sending the reason as `SpecLimits.limitsOmittedReason`. These cases pin
 * BOTH halves of what the screen must then say: the reason (so the blank is
 * not silent), AND that the chart's own statistical content is unaffected
 * (so the blank does not read as "something is broken"). Neither may read as
 * "the process is fine".
 */
describe('Weight — the chart’s own limits, withheld with a reason', () => {
  // The whole sentence as `spc.ts` composes it: the shared resolver's reason
  // followed by CHART_LIMITS_WITHHELD. Sent as ONE string and printed verbatim,
  // the same route weightStations.ts's `targetOmittedReason` already takes.
  const REASON =
    'No target is stated: the earliest limits this system holds for that product were first recorded on ' +
    '2026-09-11, after this period ended on 2026-08-20. ' +
    'No tolerance band, Cp/Cpk or scale-against-product comparison is shown for this period, for that reason. ' +
    'Everything else on this chart is measured from the readings themselves and needs no product limits: the ' +
    'control band, the mean and spread, the group series and the station comparison are unaffected. This is a gap ' +
    'in what the system knows about the product, not a judgement about the line.';

  async function renderChart(mutate: (d: SpcData) => void) {
    const f: Envelope<SpcData> = JSON.parse(JSON.stringify(spcFixture(500, 1948)));
    mutate(f.data);
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': f,
    });
    const r = render(<WeightScreen {...baseProps()} />);
    await r.findByRole('heading', { level: 1 });
    return r;
  }

  it('prints the service’s reason AND what is still measured, when the limits are withheld', async () => {
    const { container } = await renderChart((d) => {
      (d.spec as unknown as Record<string, unknown>).limitsOmittedReason = REASON;
      d.spec.source = 'none';
      d.spec.usl = null;
      d.spec.lsl = null;
      d.spec.nominal = null;
      d.capability = { cp: null, cpk: null, pp: null, ppk: null };
      d.specAgreement = null;
    });
    const body = container.textContent ?? '';
    expect(body).toContain(REASON);
    expect(body).toContain('No tolerance band, Cp/Cpk or scale-against-product comparison is shown');
    // The second half is what stops this reading as a breakage.
    expect(body).toContain('not a judgement about the line');
    // And no capability FIGURE survives the withdrawal. Matched as
    // "Cpk <number>", not the bare word: `limitsWithheld` itself names
    // Cp/Cpk as one of the things it is withholding, so a bare-substring
    // assertion would fail on the very sentence that proves the fix.
    expect(body).not.toMatch(/Cpk\s+[\d.]/);
    expect(body).not.toMatch(/\bCp\s+[\d.]/);
  });

  it('the chart’s OWN statistics are untouched by the withdrawal', async () => {
    const { container } = await renderChart((d) => {
      (d.spec as unknown as Record<string, unknown>).limitsOmittedReason = REASON;
      d.spec.source = 'none';
      d.capability = { cp: null, cpk: null, pp: null, ppk: null };
      d.specAgreement = null;
    });
    const body = container.textContent ?? '';
    // Mean, spread and the I-MR band verdict all come from the readings
    // themselves and need no product limits — they must still be stated.
    expect(body).toContain('standard deviation');
    expect(body).toContain(fmtInt(500));
    expect(body).not.toContain(W.weight.bandInvalid);
  });

  it('a period with NO product at all stays silent — the reason is for the refused case only', async () => {
    // Epoch 1 (2026-06-22 → 07-10) is this case on real data: productId is
    // null, `getSpec` answers source 'none' with no reason, and there is
    // nothing to explain beyond the absence of a product. Printing the F6
    // sentence here would assert a limits record that was never sought.
    const { container } = await renderChart(() => {});
    const body = container.textContent ?? '';
    expect(body).not.toContain('No tolerance band, Cp/Cpk or scale-against-product comparison is shown');
    expect(body).not.toContain('the earliest limits this system holds');
  });
});
