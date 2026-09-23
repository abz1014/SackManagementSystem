/**
 * MISSING-FIELD FUZZ — red-team remediation, WS-RG, 23 Sep 2026.
 *
 * WHY THIS FILE EXISTS. `reliability.guard.test.ts`'s GUARD 1/1B/1C are all
 * text scans: they catch a poll's `.error` going unread, two errors blurred
 * together, and a hand-written `?? 0`/`|| 0` default on a poll's own data
 * chain. None of them can see the shape the two REAL defects this repo has
 * shipped actually took, twice (Readings, 23 Sep 2026, `b759c88`; Rejects,
 * found and fixed the same sweep): a 200 OK response, well-formed, with a
 * hole punched in one field — no `.error` to fail to read, and the "zero" in
 * both real cases was not a `?? 0` sitting on the poll's own data chain, it
 * was a comparison (`total.n === 0`, `s.count === 0`) reading `undefined` the
 * wrong way. A text scan cannot evaluate a comparison; it can only ever
 * notice the LITERAL default-operator shape. This file complements the text
 * scans with the one thing they cannot do: actually MOUNT the component,
 * actually DELETE a field from an otherwise-valid payload, and read what
 * lands on screen.
 *
 * THE TOOL. `testkit/fixtures.ts`'s `stripFields(row, fields)` (landed
 * `016a047`) deletes named keys from a row that still TYPE-CHECKS as the
 * original wire type — the same lie a stale cache entry, a partial write, or
 * a backend field rename under a client still on the old contract tells
 * silently. One field is stripped at a time, per the task's own instruction
 * ("delete one key at a time... assert the screen never prints a confident
 * zero") — stripping several at once would not tell you WHICH field's
 * absence a screen mishandles.
 *
 * WHAT "a confident zero" MEANS HERE, made precise: a screen printing the
 * digit sequence for zero (or an empty-state sentence built from it — "No
 * cones were weighed", "0 sacks", "0%") for a field that is actually MISSING
 * from an otherwise-normal response, as if the plant had been checked and
 * found to hold nothing. The safe outcomes are: a pending/loading state, an
 * explicit "could not load" state, or a dash/placeholder — never a number
 * asserted as measured.
 *
 * COVERAGE, STATED AS A NUMBER (this file's own honest scope):
 *
 *   3 of 7 top-level screens covered: Readings, Weight, Report.
 *
 *   Readings and Weight covered because both already have a direct,
 *   non-`renderApp` component test (`Readings.test.tsx`, `Weight.test.tsx`)
 *   establishing the exact render path, fixture shape and
 *   query-param-distinguishing idiom this file reuses — mounting them
 *   cleanly needed no new harness work.
 *
 *   Report covered by mounting its own section components directly —
 *   `ConeWeightSection` and `CalibrationSection` (`screens/report/
 *   ConeWeight.tsx`, `screens/report/Calibration.tsx`) — the same idiom
 *   `Summary.test.tsx` already established for `SummarySection`: these take
 *   the report's `data` object as a plain prop, no `usePolling`/`<App/>`
 *   needed, so a stripped field goes straight from `stripFields` into the
 *   render with no fetch mock in between. This covers two of Report's eight
 *   report types (cone-weight, calibration); the other six (daily, shift,
 *   product, station, reject, sack, management-summary, machine-product) are
 *   NOT fuzzed here — each is its own section component and its own fixture
 *   shape, so widening within Report further is more of this same kind of
 *   work, not a different kind.
 *
 *   NOT covered, and why, named rather than left implicit:
 *     - Line, Rejects, Sacks: none has a direct component test to build
 *       from. Reaching them cleanly means mounting the full `<App/>` via
 *       `renderApp` (`rank.matrix.test.tsx`/`hops.test.tsx`'s own idiom) and
 *       locating each screen's own primary-figure text through that heavier
 *       path — real work, not done in this pass. Line and Sacks in
 *       particular each fetch several endpoints per headline (see
 *       `reliability.guard.test.ts`'s own ALLOW_LIST entries for both), so a
 *       careful one-field-at-a-time fuzz of either is a file of its own, not
 *       an afternoon's addition to this one.
 *     - Product: attempted and set aside. `RunningTab` (`screens/product/
 *       Running.tsx`) has a direct component test to build from
 *       (`Running.test.tsx`), but its own content is not headline/figure
 *       shaped the way Readings/Weight/Report are — it is a line-wide
 *       product name, a by-product machine listing gated on
 *       `groups.length === 0` (an `Empty` message, not a number), and table
 *       cells already read through `fmtInt`/`fmtG`, which are null-safe by
 *       construction (`lib/fmt.ts`: `n == null ? '—' : ...`). There is no
 *       scalar count or figure on this screen for a stripped field to turn
 *       into a false zero the way `SpcData.count`/`RegisterPage.total` did.
 *       Recorded as "no defect shape found to fuzz", not as "not tried".
 *     - Health: not one of the seven top-level nav screens (`ui/Bar.tsx`'s
 *       `SCREENS` — line/readings/weight/rejects/sacks/product/report only;
 *       Health is reached through Setup, `rank >= 4`), so it is outside the
 *       7-screen denominator this coverage ratio is stated against, and is
 *       not attempted here.
 *     - Within the screens this file DOES cover, only the fields that feed a
 *       HEADLINE or FIGURE TILE are fuzzed — not every field of
 *       `RegisterRow`/`SpcData`/`WeightStationsData`/`ConeWeightReportData`/
 *       `CalibrationReportData`. A field that only populates a table cell
 *       (e.g. `RegisterRow.hanger_num`) renders as a blank/`undefined` cell
 *       on strip, which is a real but different (and far less dangerous — no
 *       reader mistakes a blank cell for a measured fact) defect shape than
 *       a confident zero, and is out of THIS file's stated subject.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. A passing case here is evidence for
 * that ONE field, on that ONE screen, today. It is not a proof that no other
 * field of no other screen can be silently dropped and misread — see the
 * coverage statement above for exactly what is and is not covered, and
 * `reliability.guard.test.ts`'s own equivalent disclaimers for the same
 * caveat stated about its guards. Nothing in this file, or anywhere else in
 * this repo's test suite, exercises real layout — jsdom computes no layout —
 * so nothing here says anything about how a stripped field renders visually,
 * only about what text content lands in the DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from './testkit/fetchRouter';
import { render, renderWithLive } from './testkit/render';
import { META_FIXTURE, stripFields } from './testkit/fixtures';
import { W } from './lib/words';
import { fmtG } from './lib/fmt';
import type { Period } from './lib/period';
import type {
  CalibrationReportData,
  ConeWeightReportData,
  Envelope,
  ProductionData,
  RegisterPage,
  RegisterRow,
  SpcData,
  WeightStationsData,
} from './api';
import { ReadingsScreen } from './screens/Readings';
import { WeightScreen } from './screens/Weight';
import { ConeWeightSection } from './screens/report/ConeWeight';
import { CalibrationSection } from './screens/report/Calibration';

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

const STATIONS_OK = { stations: [] };
function noop(): void {}

/* ===================================================================== *
 * READINGS — /api/events, RegisterPage.total (Readings.tsx:307-393       *
 * countLine, reached through countStateOf, Readings.tsx:337-338)         *
 * ===================================================================== */

const REGISTER_ROW_FIXTURE: RegisterRow = {
  event_id: 512044,
  source_row_id: 132551,
  source_epoch: 2,
  source_epoch_label: 'September copy — cones',
  production_ts_utc: '2026-09-07T16:40:58Z',
  shift_code: 'evening',
  shift_date: '2026-09-07',
  shift_code_legacy: 'evening',
  hanger_num: 14,
  source_station: 5,
  lifter_station: 5,
  weight_g: 1948.2,
  in_range: true,
  material_id: 231,
  lot_code: null,
  merge_key_is_unique: true,
};

function readingsBaseProps() {
  return {
    period: PERIOD,
    listing: 'cones' as const,
    onListingChange: noop,
    station: null,
    onStationChange: noop,
    states: [],
    onStatesChange: noop,
    page: 1,
    onPageChange: noop,
    initialFilter: undefined,
    onFilterChange: noop,
    onOpenReading: noop,
    canExport: false,
  };
}

describe('MISSING-FIELD FUZZ — Readings, RegisterPage.total (the main register poll, pageSize=100)', () => {
  it('total DELETED (not 0, not present) on an otherwise-normal 200: headline reads PENDING, never a "0 " weighed/rejected count', async () => {
    const holedRow = { rows: [REGISTER_ROW_FIXTURE], page: 1, pageSize: 100 } as unknown as RegisterPage;
    // `stripFields` needs an object of the row's own type to delete a KEY
    // from; RegisterPage's `total` is a top-level scalar, so the strip is
    // done directly on the envelope's data object (the same technique
    // `PRODUCTION_ROW_FIELD_STRIPPED_FIXTURE` uses one level down, on a row).
    installFakeFetch({
      '/api/live': { data: { lines: [] }, metadata: META_FIXTURE },
      '/api/stations': STATIONS_OK,
      '/api/events': (req: RouteRequest) => {
        // Only the MAIN register poll (pageSize=100) is holed; the separate
        // scale-reject count poll (pageSize=1) answers normally, isolating
        // this case to exactly the field under fuzz — Readings.test.tsx's own
        // idiom for telling the two /api/events calls apart.
        if (req.search.get('pageSize') === '1') {
          return { data: { rows: [], total: 0, page: 1, pageSize: 1 }, metadata: META_FIXTURE };
        }
        return { data: holedRow, metadata: META_FIXTURE };
      },
    });

    const { findByRole } = renderWithLive(<ReadingsScreen {...readingsBaseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    // countStateOf(error=null, n=undefined) resolves to 'pending' (Readings.tsx:337-338:
    // `if (n != null) return { kind: 'ok', n }; return error ? failed : pending`)
    // — this assertion is what proves that branch, not merely the guard's own
    // existence, actually holds for a REAL stripped payload.
    await waitFor(() => expect(h1.textContent).toContain(W.readings.countLinePending));
    expect(h1.textContent).not.toContain('0 weighed');
    expect(h1.textContent).not.toContain('0 cones');
    expect(h1.textContent).not.toContain(W.readings.countLineFailed);
  });

  it('two-sided partner: total PRESENT as the real number 0 still reads as the genuine-empty headline (proves the fuzz case above is not vacuous)', async () => {
    installFakeFetch({
      '/api/live': { data: { lines: [] }, metadata: META_FIXTURE },
      '/api/stations': STATIONS_OK,
      '/api/events': () => ({ data: { rows: [], total: 0, page: 1, pageSize: 100 }, metadata: META_FIXTURE }),
    });
    const { findByRole } = renderWithLive(<ReadingsScreen {...readingsBaseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).not.toContain(W.readings.countLinePending));
    expect(h1.textContent).not.toBe('');
  });
});

/* ===================================================================== *
 * WEIGHT — /api/spc, SpcData.count and SpcData.mean (Weight.tsx:591-654  *
 * headline)                                                              *
 * ===================================================================== */

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

const SPC_ROW_FIXTURE: SpcData = {
  specAgreement: null,
  type: 'cone',
  unit: 'g',
  station: null,
  implausible: 0,
  count: 500,
  mean: 1948.3,
  median: 1948,
  stdevOverall: 4.1,
  stdevWithin: 3.0,
  bucketMinutes: 30,
  bucketLabel: '30-minute',
  grandMean: 1948.3,
  sChartCenter: 1948.3,
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
  generation: null,
  otherGenerationExcluded: 0,
  spansGenerations: false,
  xLimits: { valid: true, mrBar: 2.5, sigmaBetween: 2.2, halfWidth: 6.6, pairs: 400 },
};

function weightBaseProps() {
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

describe('MISSING-FIELD FUZZ — Weight, SpcData.count (headline’s own empty-period gate, Weight.tsx:626-634)', () => {
  it('count DELETED on an otherwise-real, non-empty /api/spc response: FIXED (WS-GF, 23 Sep 2026) — the empty-period gate was `s.count === 0`, which `undefined` did not satisfy, so the headline used to fall through and state the (still-present) mean as if the fetch were whole. It now names the count itself as unreadable and prints no mean.', async () => {
    const holed: Envelope<SpcData> = {
      data: stripFields(SPC_ROW_FIXTURE, ['count']),
      metadata: META_FIXTURE,
    };
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': holed,
    });

    const { findByRole } = render(<WeightScreen {...weightBaseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    // Neither a confident number (the still-present mean must NOT print —
    // that was the defect) NOR a confident zero ("No cones were weighed",
    // which would assert a genuine empty period this response does not
    // establish) NOR the whole-fetch-failed sentence (this is a 200, not an
    // error) — a distinct "the count itself could not be read" state,
    // W.weight.countCouldNotRead, the same "state the absence, never a
    // number" rule Line.tsx/Rejects.tsx's fig.couldNotRead applies to the
    // figure tiles (ae7a59b).
    await waitFor(() => expect(h1.textContent).toBe(W.weight.countCouldNotRead));
    expect(h1.textContent).not.toContain(fmtG(SPC_ROW_FIXTURE.mean));
    expect(h1.textContent).not.toBe('No cones were weighed in this period.');
    expect(h1.textContent).not.toContain(W.couldNotLoad);
  });

  it('two-sided partner: count PRESENT as the real number 0 correctly reads as the genuine-empty headline', async () => {
    const empty: Envelope<SpcData> = { data: { ...SPC_ROW_FIXTURE, count: 0, mean: 0 }, metadata: META_FIXTURE };
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': empty,
    });
    const { findByRole } = render(<WeightScreen {...weightBaseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toBe('No cones were weighed in this period.'));
  });
});

describe('MISSING-FIELD FUZZ — Weight, SpcData.mean (Weight.tsx:648, fmtG(s.mean))', () => {
  it('mean DELETED, count real and non-zero: headline prints "—" via fmtG(undefined), never "0 g"', async () => {
    const holed: Envelope<SpcData> = {
      data: stripFields(SPC_ROW_FIXTURE, ['mean']),
      metadata: META_FIXTURE,
    };
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': PRODUCTION_OK,
      '/api/spc': holed,
    });

    const { findByRole } = render(<WeightScreen {...weightBaseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toContain('—'));
    // Not "not.toContain('0 g')" — the target phrase later in the same
    // sentence ("1,950 g") legitimately contains that substring. The precise
    // claim is about the MEAN specifically: "Average recorded weight is 0 g"
    // must not appear.
    expect(h1.textContent).not.toContain('Average recorded weight is 0');
    expect(h1.textContent).not.toContain('Average cone weight is 0');
  });
});

describe('MISSING-FIELD FUZZ — Weight, ProductionRow.conesInRangePct (the "rejected by the scale" figure tile, Weight.tsx:320)', () => {
  it('conesInRangePct DELETED on an otherwise-real production row: tile prints "—", never "0%" (a real 0% would claim a perfect scale-pass rate)', async () => {
    const holedProduction: Envelope<ProductionData> = {
      data: {
        ...PRODUCTION_OK.data,
        rows: [stripFields(PRODUCTION_OK.data.rows[0]!, ['conesInRangePct'])],
      },
      metadata: META_FIXTURE,
    };
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': holedProduction,
      '/api/spc': { data: SPC_ROW_FIXTURE, metadata: META_FIXTURE },
    });

    const { findByRole, container } = render(<WeightScreen {...weightBaseProps()} />);
    await findByRole('heading', { level: 1 });

    await waitFor(() => {
      const body = container.textContent ?? '';
      expect(body).toContain('—');
    });
    expect(container.textContent ?? '').not.toContain('0.0%');
  });

  it('two-sided partner: conesInRangePct PRESENT as the real number 100 (0% rejected) prints the real "0.0%", not a dash', async () => {
    const perfect: Envelope<ProductionData> = {
      data: { ...PRODUCTION_OK.data, rows: [{ ...PRODUCTION_OK.data.rows[0]!, conesInRangePct: 100 }] },
      metadata: META_FIXTURE,
    };
    installFakeFetch({
      '/api/weight-stations': WEIGHT_STATIONS_OK,
      '/api/stations': STATIONS_OK,
      '/api/production': perfect,
      '/api/spc': { data: SPC_ROW_FIXTURE, metadata: META_FIXTURE },
    });
    const { findByRole, container } = render(<WeightScreen {...weightBaseProps()} />);
    await findByRole('heading', { level: 1 });
    await waitFor(() => expect(container.textContent ?? '').toContain('0.0%'));
  });
});

/* ===================================================================== *
 * REPORT — screens/report/ConeWeight.tsx and screens/report/Calibration.tsx *
 * Section components take their report's `data` as a plain prop (no        *
 * `usePolling`, no fetch), the same shape `Summary.test.tsx` already       *
 * mounts directly for `SummarySection`. `stripFields` is applied straight  *
 * to the fixture; no fake fetch is needed at all for either case below.    *
 * ===================================================================== */

const CONE_WEIGHT_FIXTURE: ConeWeightReportData = {
  period: { period: 'day', from: '2026-09-07', to: '2026-09-07' },
  basis: 'gross',
  cones: 500,
  weighed: 500,
  implausible: 0,
  meanG: 1948.3,
  medianG: 1948,
  medianSource: 'weights_service',
  sdG: 4.1,
  minG: 1930,
  maxG: 1970,
  states: { within: 480, low: 10, high: 5, rejected: 3, unknown: 2 },
  bucketSizeG: 10,
  histogram: [],
  target: {
    setpointG: 1950,
    productId: 21,
    label: 'Test Yarn',
    inForceAtUtc: '2026-09-01T00:00:00Z',
    limitsChangedInPeriod: 0,
    source: 'in_force_at_period_end',
  },
  byStation: [],
  lineMeanG: 1948,
  plausibility: { loG: 1500, hiG: 2500 },
  note: '',
};

describe('MISSING-FIELD FUZZ — Report / Cone weight, ConeWeightReportData.cones (the empty-period gate, ConeWeight.tsx:18)', () => {
  it('cones DELETED on an otherwise-real, non-empty report: the figures still render from the surviving fields, never a fabricated "0" — readingsExcluded falls back to the em dash fmtInt(undefined) prints, not the digit 0', async () => {
    const holed = stripFields(CONE_WEIGHT_FIXTURE, ['cones']);

    // `d.cones === 0` (ConeWeight.tsx:18) is the SAME gate shape as
    // Weight.tsx's `s.count === 0` (already recorded as a finding by another
    // pass of this file): `undefined === 0` is false, so a stripped `cones`
    // does NOT fall into the wrong branch here — this is the two-sided proof
    // that this particular gate, unlike SpcData's, is safe, not a second
    // instance of the same bug. It falls through to the real figures tile,
    // which reads meanG/medianG/sdG (all still present) correctly, and to
    // `W.reports.readingsExcluded(fmtInt(d.cones), ...)`, where
    // `fmtInt(undefined)` prints '—' (lib/fmt.ts: `n == null ? '—' : ...`),
    // never the digit 0.
    const { container } = render(<ConeWeightSection d={holed} names={[]} />);

    expect(container.textContent ?? '').toContain('1,948'); // meanG, proves the real branch rendered
    expect(container.querySelector('.fig-val')).not.toBeNull();
    // Proves the full (non-empty) branch rendered, not just the top figures
    // tile: "By station" and its own line-mean note only appear past the
    // `d.cones === 0` gate — an empty-array `byStation` also prints
    // W.nothingHere in its OWN, unrelated fallback (Empty for a genuinely
    // empty station list), so asserting the whole container never contains
    // that string would be a false failure unrelated to the field under
    // fuzz; asserting the "By station" block header is the precise claim.
    expect(container.textContent ?? '').toContain(W.reports.byStation);
    expect(container.textContent ?? '').toContain('readings, of which');
  });

  it('two-sided partner: cones PRESENT as the real number 0 correctly reads as the genuine-empty Block', () => {
    const empty: ConeWeightReportData = { ...CONE_WEIGHT_FIXTURE, cones: 0 };
    const { container } = render(<ConeWeightSection d={empty} names={[]} />);
    expect(container.textContent ?? '').toContain(W.nothingHere);
    expect(container.textContent ?? '').not.toContain('1,948');
  });
});

const CALIBRATION_FIXTURE: CalibrationReportData = {
  period: { period: 'day', from: '2026-09-07', to: '2026-09-07' },
  filters: { station: undefined },
  lineMeanG: 1948,
  targetG: 1950,
  productLabel: 'Test Yarn',
  thresholdG: 9,
  minDaysHeld: 2,
  stations: [
    {
      station: 7, n: 500, meanG: 1941, vsLineG: -7, vsTargetG: -9,
      daysHeld: 30, flagged: true, daysFlagged: 3, daysWithData: 14,
      lastAdjustedUtc: null, adjustmentsInPeriod: 0,
    },
  ],
  flaggedStationCount: 1,
  adjustments: [],
  note: '',
};

describe('MISSING-FIELD FUZZ — Report / Calibration, CalibrationReportData.flaggedStationCount (Calibration.tsx, null-guarded interpolation)', () => {
  // WS-OR (23 Sep 2026): FIXED. This was a staleness canary recording the
  // buggy behaviour found by this fuzz pass — `W.reports.stationsFlagged(n)`
  // was interpolated with no fmtInt/null guard, so a stripped
  // `flaggedStationCount` on an otherwise-real, non-empty report fell through
  // `n === 1` to the else branch and printed the literal word "undefined"
  // into the page head. Calibration.tsx now guards the null case and states
  // the count could not be read (`W.reports.stationsFlaggedUnknown`), the
  // same "state the absence, never a number" idiom `fig.couldNotRead` and
  // `countCouldNotRead` already use elsewhere. The canary's own
  // instruction — delete the block, don't "fix" the test back to green — is
  // followed here: the assertions below describe the CURRENT, correct
  // behaviour, not the old one. Full coverage and the two-sided partner test
  // now live in `screens/report/Calibration.test.tsx`, alongside the rest of
  // that component's own tests.
  it('flaggedStationCount DELETED on a report whose stations array is real and non-empty: never the literal "undefined" — states the count could not be read', () => {
    const holed = stripFields(CALIBRATION_FIXTURE, ['flaggedStationCount']);
    const { container } = render(<CalibrationSection d={holed} names={[]} />);
    expect(container.textContent ?? '').not.toContain('undefined');
    expect(container.textContent ?? '').toContain(W.reports.stationsFlaggedUnknown);
  });

  it('two-sided partner: flaggedStationCount PRESENT as the real number 0 correctly reads as "0 stations flagged for drift", not "undefined"', () => {
    const zero: CalibrationReportData = { ...CALIBRATION_FIXTURE, flaggedStationCount: 0 };
    const { container } = render(<CalibrationSection d={zero} names={[]} />);
    expect(container.textContent ?? '').toContain('0 stations flagged for drift');
    expect(container.textContent ?? '').not.toContain('undefined');
  });
});
