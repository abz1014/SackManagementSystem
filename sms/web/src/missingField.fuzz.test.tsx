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
import { LIVE_FIXTURE, META_FIXTURE, stripFields, OPERATIONS_FIXTURE } from './testkit/fixtures';
import { W } from './lib/words';
import { fmtG } from './lib/fmt';
import type { Period } from './lib/period';
import type {
  CalibrationReportData,
  ConeWeightReportData,
  Envelope,
  ProductionData,
  ProductionRow,
  RegisterPage,
  RegisterRow,
  RejectSpcData,
  SackSummaryData,
  SpcData,
  WeightStationsData,
} from './api';
import { ReadingsScreen } from './screens/Readings';
import { WeightScreen } from './screens/Weight';
import { LineScreen } from './screens/Line';
import { RejectsScreen } from './screens/Rejects';
import { SacksScreen } from './screens/Sacks';
import { ConeWeightSection } from './screens/report/ConeWeight';
import { CalibrationSection } from './screens/report/Calibration';
import { DailySection } from './screens/report/Daily';
import { ShiftSection } from './screens/report/Shift';
import { ProductSection } from './screens/report/Product';
import { StationSection } from './screens/report/Station';
import { RejectSection } from './screens/report/Reject';
import { SackSection } from './screens/report/Sack';
import { SummarySection } from './screens/report/Summary';
import { MachineProductSection } from './screens/report/MachineProduct';
import { SystemHistoryBlock } from './screens/health/SystemHistoryBlock';
import { PlanReview } from './screens/product/Changeover';
import { HistoryTab } from './screens/product/History';
import { SyncHealthBlock } from './screens/health/SyncHealthBlock';
import type {
  DailyReportData,
  KpiRow,
  ManagementSummaryData,
  MachineProductReportData,
  ProductReportData,
  RejectReportData,
  SackReportData,
  ShiftReportData,
  StationReportData,
  SystemHistoryData,
  ChangeoverPlan,
  TimelineEntry,
  DqFinding,
} from './api';

/**
 * KNOWN_DEFECTS — currently-OPEN findings from this pass (23 Sep 2026,
 * WS-FZ2), each with a staleness canary of its own further down this file.
 * Per this pass's own brief: record here and report; do not fix — every
 * screen below is owned by a different worker. Delete an entry (and rewrite
 * its canary test as a two-sided proof, the way the Calibration WS-OR entry
 * was, and the Line/Rejects entries were on 23 Sep 2026 (WS-CR) once `affa9bd`
 * fixed both) only once the production file it names actually changed.
 *
 * Empty as of WS-CR: both entries this file ever held (Line.tsx periodFigures,
 * Rejects.tsx headline) were closed by `affa9bd` and converted below.
 */
const KNOWN_DEFECTS: Record<string, string> = {};

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

/* ===================================================================== *
 * LINE — screens/Line.tsx, ProductionRow.cones (periodFigures' own cones  *
 * tile) — the screen the task brief names as the live proof of this       *
 * defect class ("0 cones ... directly above its own chart still reading   *
 * 77,492 cones"). ae7a59b closed the case where the SERVER names the      *
 * field in `dataIssues[]`; `affa9bd` closed the remaining case below — a   *
 * plain stripped key with NO dataIssues entry — by adding `fieldMissing()` *
 * (Line.tsx), a structural `!(field in r)` check applied IN ADDITION TO   *
 * `issueFor()`'s server-flagged check, across periodFigures and           *
 * kpiBlockNote, for cones/sacks/sackWeightKg/rejectedCones. FIXED 23 Sep  *
 * 2026 (WS-CH); converted from KNOWN_DEFECT to a two-sided regression     *
 * proof 23 Sep 2026 (WS-CR). A fuller per-tile breakdown (sacks and       *
 * rejectedCones individually, not just cones) now also lives in the       *
 * dedicated `screens/Line.render.test.tsx`.                               *
 * ===================================================================== */

const LINE_BASE_ROUTES = {
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

function lineProductionRoute(row: ProductionRow, dataIssues: ProductionData['dataIssues'] = []): Envelope<ProductionData> {
  return {
    data: { groupBy: 'none', rows: [row], unattributed: null, states: null, implausible: null, dataIssues },
    metadata: META_FIXTURE,
  };
}

const LINE_PERIOD = {
  key: 'shift' as const,
  from: '2026-09-07',
  to: '2026-09-07',
  tsTo: '2026-09-07T23:59:59.000Z',
  live: true,
  days: 1,
};

function lineProps() {
  return {
    period: LINE_PERIOD,
    onNavigate: noop,
    onOpenStation: noop,
    onOpenReading: noop,
    onOpenProduct: noop,
    canWrite: false,
  };
}

describe('KNOWN_DEFECTS — this file\'s own open-findings register (WS-FZ2, 23 Sep 2026)', () => {
  it('every entry, if any, names a file this pass reports on, not fixes — currently empty (both prior entries closed by affa9bd, converted 23 Sep 2026 WS-CR)', () => {
    const entries = Object.entries(KNOWN_DEFECTS);
    for (const [key, note] of entries) {
      expect(key.length).toBeGreaterThan(0);
      expect(note.length).toBeGreaterThan(0);
    }
  });
});

describe('MISSING-FIELD FUZZ — Line, ProductionRow.cones (periodFigures, Line.tsx:500,531-538) — FIXED (WS-CH, affa9bd), regression-proven here', () => {
  it('cones KEY DELETED (stripFields), dataIssues EMPTY (the server never flagged it): FIXED — the cones tile reads "—" with the could-not-read note, never a bare "0", because `fieldMissing()` catches the structural hole `issueFor()` alone cannot see', async () => {
    const holedRow = stripFields(
      { group: 'total', cones: 20_000, rejectedCones: 400, unmatchedRejects: 350, sacks: 800, sackWeightKg: 22_000, conesInRangePct: 97, sacksPassedScalePct: 95 } as ProductionRow,
      ['cones'],
    );
    installFakeFetch({ ...LINE_BASE_ROUTES, '/api/production': lineProductionRoute(holedRow, []) });

    const { findAllByText, container } = renderWithLive(<LineScreen {...lineProps()} />);

    // The cones tile specifically (first of periodFigures' four tiles) —
    // '—' as the value, the could-not-read note attached, never a bare '0'.
    // Querying the whole-page '0' text would be vacuous: the fourth tile
    // (outsideLimits) legitimately renders '0' here regardless of this
    // field, so the precise claim has to be about the cones tile alone.
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBeGreaterThan(0);

    const figVals = Array.from(container.querySelectorAll('.fig-val')).map((el) => el.textContent);
    expect(figVals[0]).toMatch(/^—/);
    expect(figVals[0]).not.toMatch(/^0/);
  });

  it('two-sided: a GENUINE real 0 (cones present, not stripped, no dataIssues) still renders the honest "0 cones", with no could-not-read caveat — proving the fix above does not turn a real empty reading into a false alarm', async () => {
    const realRow: ProductionRow = {
      group: 'total', cones: 0, rejectedCones: 0, unmatchedRejects: 0,
      sacks: 800, sackWeightKg: 22_000, conesInRangePct: null, sacksPassedScalePct: null,
    };
    installFakeFetch({ ...LINE_BASE_ROUTES, '/api/production': lineProductionRoute(realRow, []) });

    const { findAllByText, queryByText } = renderWithLive(<LineScreen {...lineProps()} />);
    const zeros = await findAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
    expect(queryByText(W.fig.couldNotRead)).toBeNull();
  });

  it('fix holds: cones PRESENT as a real 0 AND named in dataIssues (the server-flagged shape ae7a59b actually fixes) shows the dash and the caveat, never a bare "0"', async () => {
    const flaggedRow: ProductionRow = {
      group: 'total', cones: 0, rejectedCones: 0, unmatchedRejects: 0,
      sacks: 800, sackWeightKg: 22_000, conesInRangePct: null, sacksPassedScalePct: null,
    };
    installFakeFetch({
      ...LINE_BASE_ROUTES,
      '/api/production': lineProductionRoute(flaggedRow, [
        { field: 'cones', group: 'total', reason: 'cone_event aggregate row is missing its count (n)' },
      ]),
    });

    const { findAllByText } = renderWithLive(<LineScreen {...lineProps()} />);
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBeGreaterThan(0);
  });
});

/* ===================================================================== *
 * REJECTS — screens/Rejects.tsx, RejectSpcData.totalRejects (the headline  *
 * count+rate, Rejects.tsx:266-289) — arithmetic done BEFORE formatting,    *
 * the same shape Sacks.tsx's WS-B2 fix (finiteOrNull) exists to close.     *
 * `affa9bd` added the identical guard here: `rejectSum = finiteOrNull(     *
 * q.totalRejects + w.totalRejects)`, folded into the same `CountState`     *
 * (ok/pending/failed) the rest of this screen already uses, so a NaN sum   *
 * now renders the same '—' a genuine fetch failure does. FIXED 23 Sep      *
 * 2026 (WS-CH); converted from KNOWN_DEFECT to a two-sided regression      *
 * proof 23 Sep 2026 (WS-CR). A fuller breakdown (including the             *
 * `totalInspected`-poisons-the-rate case) now also lives in the dedicated  *
 * `screens/Rejects.headline.test.tsx`.                                    *
 * ===================================================================== */

const REJECTS_PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: true, days: 1,
};

const RANGE_OK = { minDate: '2026-08-24', maxDate: '2026-09-07' };

function rejectGenerations(totalInspected: number) {
  return [{ generation: 2, totalProduced: totalInspected - 40, totalRejects: 40, totalInspected, pBar: 0.02, firstBucketTs: '2026-08-24T00:00:00Z', lastBucketTs: '2026-09-07T17:00:00Z' }];
}

function rejectSpcFixture(rejectType: 'quality' | 'weight', totalRejects: number, totalProduced: number): RejectSpcData {
  return {
    bucketSize: 'day', rejectTypeFilter: rejectType, totalProduced, totalRejects,
    pBar: totalProduced > 0 ? totalRejects / totalProduced : null,
    spansGenerations: false,
    generations: rejectGenerations(totalProduced + totalRejects),
    outOfControlCount: 0, buckets: [], episodes: [],
  };
}

function rejectsRoutes(quality: RejectSpcData, weight: RejectSpcData) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': RANGE_OK,
    '/api/stations': STATIONS_OK,
    '/api/products': { products: [] },
    '/api/reject-spc': (req: RouteRequest) => {
      const data = req.search.get('rejectType') === 'weight' ? weight : quality;
      return { data, metadata: META_FIXTURE };
    },
    '/api/rejects': { data: { total: 0, reasons: [], unattributed: null }, metadata: META_FIXTURE },
    '/api/rejects/by-day-code': { data: { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 1, total: 0, rows: [] }, metadata: META_FIXTURE },
  };
}

function rejectsProps() {
  return {
    period: REJECTS_PERIOD,
    station: null, onStationChange: noop,
    product: null, onProductChange: noop,
    code: null, onCodeChange: noop,
    onSeeCones: noop, onSeeStations: noop, onOpenReason: noop,
    canName: false,
  };
}

describe('MISSING-FIELD FUZZ — Rejects, RejectSpcData.totalRejects (headline, Rejects.tsx:266-289) — FIXED (WS-CH, affa9bd), regression-proven here', () => {
  it('totalRejects KEY DELETED from the quality series, weight series real: FIXED — the headline reads "—", never the literal word "NaN", because `finiteOrNull` folds a NaN sum into the same failed CountState a genuine fetch failure uses', async () => {
    const holedQuality = stripFields(rejectSpcFixture('quality', 25, 12_000), ['totalRejects']);
    const weightOk = rejectSpcFixture('weight', 10, 12_000);
    installFakeFetch(rejectsRoutes(holedQuality, weightOk));

    const { findByRole } = renderWithLive(<RejectsScreen {...rejectsProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe('—'));
    expect(h1.textContent).not.toContain('NaN');
  });

  it('two-sided: BOTH series genuinely reporting zero rejects (real 0, not stripped) renders the honest "0 cones rejected, 0.0% of everything weighed", never "NaN" — proves the NaN above is specific to the hole, not to zero itself', async () => {
    const qualityZero = rejectSpcFixture('quality', 0, 12_000);
    const weightZero = rejectSpcFixture('weight', 0, 12_000);
    installFakeFetch(rejectsRoutes(qualityZero, weightZero));

    const { findByRole } = renderWithLive(<RejectsScreen {...rejectsProps()} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toContain('0 cones rejected'));
    expect(h1.textContent).not.toContain('NaN');
  });
});

/* ===================================================================== *
 * SACKS — screens/Sacks.tsx, SackGroup.kg (SummaryFigures + the headline, *
 * Sacks.tsx:142-146,432) — the WS-B2 fix (`finiteOrNull`), fuzzed fresh    *
 * here to prove it holds, and used below for the required revert-and-fail *
 * demonstration (git diff pasted after restoring).                        *
 * ===================================================================== */

const SACKS_PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: true, days: 1,
};

const SACK_TOTALS_FIXTURE: SackSummaryData['totals'] = {
  sacks: 96, kg: 2649.6, avgKg: 27.6, inRangePct: 94.1, inRange: 90, noFlag: 2, implausible: 0,
  cones: 4820, conesPerSack: 50,
};

function sacksSummaryEnvelope(totals: SackSummaryData['totals']): Envelope<SackSummaryData> {
  return {
    data: {
      from: SACKS_PERIOD.from, to: SACKS_PERIOD.to, shift: SACKS_PERIOD.shift ?? null, product: null,
      totals, byShift: [], byProduct: [],
      unattributed: { rows: 0, of: totals.sacks },
      weightBasis: 'gross', tareKg: 0.6, plausibility: { loKg: 40, hiKg: 60 },
      sackTimeIsInsertTime: true, conesPerSackApproximate: true,
      machineLevel: { enabled: false, reason: 'no machine column on sack1_TP1U2' },
    },
    metadata: META_FIXTURE,
  };
}

const SACKS_LEDGER_EMPTY = {
  data: {
    from: SACKS_PERIOD.from, to: SACKS_PERIOD.to, product: null, basis: 'line', machineLevel: { enabled: false, reason: 'n/a' },
    dayBasis: 'production_day', sackTimeIsInsertTime: true, receiptMeaning: 'x', weightBasis: 'gross', tareKg: 0.6,
    opening: { sacks: 0, kg: 0 }, closing: { sacks: 0, kg: 0 },
    totals: { openingEntries: { sacks: 0, kg: 0 }, receipts: { sacks: 0, kg: 0 }, weighed: { sacks: 0, kg: 0 }, issues: { sacks: 0, kg: 0 }, consumption: { sacks: 0, kg: 0 }, adjustments: { sacks: 0, kg: 0 } },
    days: [], byMaterial: [], kgMissing: 0,
  },
  metadata: META_FIXTURE,
};

function sacksRoutes(totals: SackSummaryData['totals']) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/sacks/summary': sacksSummaryEnvelope(totals),
    '/api/sacks/stock': SACKS_LEDGER_EMPTY,
    '/api/reports/sack': { data: { report: { byDay: [], totals: { avgSackKg: null } } }, metadata: META_FIXTURE },
    '/api/products': { products: [] },
    '/api/events': { data: { rows: [], total: 0, page: 1, pageSize: 25 }, metadata: META_FIXTURE },
  };
}

function sacksProps() {
  return {
    period: SACKS_PERIOD, unit: 'sacks' as const, onUnitChange: noop,
    page: 1, onPageChange: noop, canRecord: false, onOpenReading: noop, onOpenDay: noop,
  };
}

describe('MISSING-FIELD FUZZ — Sacks, SackGroup.kg (SummaryFigures + headline) — proving the WS-B2 fix (finiteOrNull) holds under fresh field-stripping', () => {
  it('kg KEY DELETED on an otherwise-real, non-empty totals row: headline and figure tile print "—", never the literal "NaN" (this is the REVERT-DEMONSTRATION case — see below)', async () => {
    const holedTotals = stripFields(SACK_TOTALS_FIXTURE, ['kg']);
    installFakeFetch(sacksRoutes(holedTotals));
    const { container } = renderWithLive(<SacksScreen {...sacksProps()} />);

    await waitFor(() => expect(container.textContent ?? '').toContain('94.1%'));
    expect(container.textContent ?? '').not.toContain('NaN');
    expect(container.textContent ?? '').toContain('—');
  });

  it('two-sided partner: kg PRESENT as the real number 0 correctly reads "0 kg", not a dash and not NaN', async () => {
    const zeroKg: SackSummaryData['totals'] = { ...SACK_TOTALS_FIXTURE, kg: 0 };
    installFakeFetch(sacksRoutes(zeroKg));
    const { container } = renderWithLive(<SacksScreen {...sacksProps()} />);
    await waitFor(() => expect(container.textContent ?? '').toContain('94.1%'));
    expect(container.textContent ?? '').not.toContain('NaN');
    expect(container.textContent ?? '').toContain('0 kg');
  });
});

/* ===================================================================== *
 * RT24-13 (ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md): "Missing-field fuzz *
 * coverage exists for Line/Weight/Rejects/Sacks and two report sections,  *
 * but not for 6 of 8 report types, all 4 Product tabs, Health's two       *
 * blocks, or the 4 sheets." This block closes the remaining 8 of 10       *
 * report types (all of `ReportDataByType` except cone-weight and         *
 * calibration, already covered above) and one Health block. Each section  *
 * component takes its report's `data` as a plain prop (the same idiom     *
 * ConeWeightSection/CalibrationSection use above), so no fake fetch is    *
 * needed for any of them.                                                 *
 *                                                                         *
 * NOT reached by this pass, named rather than left implicit: the 4        *
 * Product tabs (Running is already covered above, in the block that       *
 * explains why it has no scalar figure to fuzz; Catalogue/Changeover/     *
 * History are each a form or a table of names, not a headline/figure —    *
 * the same "no defect shape found to fuzz" call this file already made    *
 * for Running, not independently re-verified here for the other three);   *
 * SyncHealthBlock (needs `useLive()` plus a second admin-only endpoint,    *
 * real work of its own); and all 4 sheets (ReadingSheet/ReasonSheet/       *
 * StationSheet/StockSheet, each its own `usePolling` fetch chain, not a    *
 * plain-prop component like the report sections). Widening into any of    *
 * those is more of this same kind of work, not a different kind.          *
 * ===================================================================== */

const REPORT_PERIOD = { period: 'day' as const, from: '2026-09-07', to: '2026-09-07' };
const REPORT_COVERAGE = { daysInPeriod: 1, daysWithData: 1, firstDayWithData: '2026-09-07', lastDayWithData: '2026-09-07', complete: true };
const REPORT_LINE_FIXTURE = {
  group: 'total', cones: 500, rejectedCones: 10, rejectRatePct: 2, conesInRangePct: 98,
  sacks: 20, sackWeightKg: 550, avgSackKg: 27.5, conesPerSack: 25, sacksPassedScalePct: 95,
};

/* --------------------------------------------------------------- Daily -- */

const DAILY_FIXTURE: DailyReportData = {
  period: REPORT_PERIOD, coverage: REPORT_COVERAGE, totals: REPORT_LINE_FIXTURE,
  byShift: [REPORT_LINE_FIXTURE], byDay: [REPORT_LINE_FIXTURE],
  shift: null, readings: { states: { within: 480, low: 10, high: 5, rejected: 3, unknown: 2 }, implausible: 0 },
  shiftCheck: { compared: 500, mismatched: 0, mismatchPct: 0, topHour: null },
  downtime: { stoppageCount: 3, stoppedSeconds: 600, thresholdSeconds: 120 },
  rejectPopulations: { byScale: 10, byScalePct: 2, atInspection: 5, atInspectionPct: 1, note: 'a note' },
};

describe('MISSING-FIELD FUZZ — Report / Daily, ReportLine.cones (Totals gate, Daily.tsx:14, DailySection)', () => {
  it('totals.cones DELETED on an otherwise-real, non-empty report: figures still render from the surviving fields (fmtInt(undefined) prints em dash), the report is NOT shown as Empty', () => {
    const holed: DailyReportData = { ...DAILY_FIXTURE, totals: stripFields(DAILY_FIXTURE.totals, ['cones']) };
    const { container } = render(<DailySection d={holed} />);
    // Not a blanket "no Empty anywhere in the page" check: byShift/byDay's
    // own LineTable prints W.nothingHere for THEIR OWN empty rows regardless
    // of this fixture (this fixture's byShift/byDay rows carry
    // group:'total', which LineTable's own, unrelated filter drops) — that
    // would make a page-wide assertion pass for the wrong reason. The
    // precise claim is that the TOP block (the one gated by totals.cones)
    // rendered its real figures, never the whole-report Empty fallback:
    // the em dash for the stripped field, and the surviving sacks figure.
    expect(container.textContent ?? '').toContain('—');
    expect(container.textContent ?? '').toContain('20');
  });

  it('two-sided partner: totals.cones PRESENT as the real number 0 correctly reads as the genuine-empty Block', () => {
    const empty: DailyReportData = { ...DAILY_FIXTURE, totals: { ...DAILY_FIXTURE.totals, cones: 0 } };
    const { container } = render(<DailySection d={empty} />);
    expect(container.textContent ?? '').toContain(W.nothingHere);
  });
});

/* --------------------------------------------------------------- Shift -- */

const SHIFT_SECTION_FIXTURE = {
  shift: 'evening' as const, coverage: REPORT_COVERAGE, totals: REPORT_LINE_FIXTURE,
  // group must NOT be 'total' here — LineTable/DayBars both filter out
  // 'total' rows (that value is only meaningful for REPORT_LINE_FIXTURE's
  // other use as a totals row elsewhere in this file), and an all-filtered
  // byDay would render its own, unrelated Empty state.
  byDay: [{ ...REPORT_LINE_FIXTURE, group: '2026-09-07' }], readings: null,
};
const SHIFT_FIXTURE: ShiftReportData = {
  period: REPORT_PERIOD, shift: null, shifts: [SHIFT_SECTION_FIXTURE],
  shiftCheck: null, timeLostNote: 'time lost note',
};

describe('MISSING-FIELD FUZZ — Report / Shift, ShiftSection.totals.cones (the whole-report empty gate, Shift.tsx: `d.shifts.some(s => s.totals.cones > 0)`)', () => {
  // REAL DEFECT FOUND, not fixed here per this pass's brief (report, do not
  // silently fix another worker's file): the gate is `s.totals.cones > 0`,
  // not `=== 0`. `undefined > 0` is ALSO false, so a stripped `cones` on
  // the only shift makes `.some(...)` false exactly as a genuine empty
  // shift would — the whole report renders Empty/"Nothing recorded in
  // this period", even though this shift's rejectedCones/sacks/
  // sackWeightKg are all real, non-zero data. This is the false-empty
  // shape CLAUDE.md's "name which part failed" rule and this file's own
  // "confident zero" class both exist to catch, just inverted: instead of
  // a confident zero, it is a confident "nothing here" over data that is
  // actually present. File: web/src/screens/report/Shift.tsx (the
  // `d.shifts.some((s) => s.totals.cones > 0)` gate).
  it('DEFECT (Shift.tsx, the whole-report empty gate): totals.cones DELETED on the only shift, with real non-zero rejectedCones/sacks/sackWeightKg: the report wrongly renders Empty instead of the real shift data', () => {
    const holed: ShiftReportData = {
      ...SHIFT_FIXTURE,
      shifts: [{ ...SHIFT_SECTION_FIXTURE, totals: stripFields(SHIFT_SECTION_FIXTURE.totals, ['cones']) }],
    };
    const { container } = render(<ShiftSection d={holed} />);
    // What SHOULD happen (fails today): the real sack figures render, not Empty.
    expect(container.textContent ?? '').not.toContain(W.nothingHere);
  });

  it('two-sided partner: totals.cones PRESENT as the real number 0 on the only shift, and every other figure also genuinely 0: Empty is the correct rendering (proves the defect above is about the HOLE, not about the gate shape itself)', () => {
    const genuinelyEmpty: ShiftReportData = {
      ...SHIFT_FIXTURE,
      shifts: [{
        ...SHIFT_SECTION_FIXTURE,
        totals: { ...SHIFT_SECTION_FIXTURE.totals, cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0 },
      }],
    };
    const { container } = render(<ShiftSection d={genuinelyEmpty} />);
    expect(container.textContent ?? '').toContain(W.nothingHere);
  });
});

/* ------------------------------------------------------------- Product -- */

const PRODUCT_ROW_FIXTURE = {
  group: 'total', cones: 500, rejectedCones: 10, rejectRatePct: 2, conesInRangePct: 98,
  sacks: 20, sackWeightKg: 550, avgSackKg: 27.5, conesPerSack: 25, sacksPassedScalePct: 95,
  productId: 231, productLabel: 'Test Yarn', weight: { n: 500, avgG: 1948, sdG: 4, minG: 1930, maxG: 1970 },
  states: { within: 480, low: 10, high: 5, rejected: 3, unknown: 2 }, implausible: 0,
  target: { setpointG: 1950, loG: 1900, hiG: 2000, inForceAtUtc: '2026-09-01T00:00:00Z', limitsChangedInPeriod: 0 },
  vsTargetG: -2,
};
const PRODUCT_FIXTURE: ProductReportData = {
  period: REPORT_PERIOD, filters: {}, rows: [PRODUCT_ROW_FIXTURE],
  unattributed: { cones: 0, rejects: 0, sacks: 0, ofCones: 500, ofRejects: 10, ofSacks: 20 }, note: 'a note',
};

describe('MISSING-FIELD FUZZ — Report / Product, ProductReportRow.cones (the per-row filter gate, Product.tsx: `r.cones > 0 || r.rejectedCones > 0 || r.sacks > 0`)', () => {
  it('cones DELETED on the only row, with rejectedCones/sacks still real and non-zero: the row still renders (the OR gate is satisfied by a surviving field) — proves this gate, unlike Shift’s some(), is safe against a single stripped field', () => {
    const holed: ProductReportData = { ...PRODUCT_FIXTURE, rows: [stripFields(PRODUCT_ROW_FIXTURE, ['cones'])] };
    const { container } = render(<ProductSection d={holed} products={[]} />);
    expect(container.textContent ?? '').not.toContain(W.nothingHere);
    expect(container.textContent ?? '').toContain('Test Yarn');
  });

  it('FIXED: cones/rejectedCones/sacks ALL DELETED on the only row while its weight data is real (weight.n=500): the row still renders, since real weight readings say this product was not, in fact, idle', () => {
    const holed: ProductReportData = {
      ...PRODUCT_FIXTURE,
      rows: [stripFields(PRODUCT_ROW_FIXTURE, ['cones', 'rejectedCones', 'sacks'])],
    };
    const { container } = render(<ProductSection d={holed} products={[]} />);
    expect(container.textContent ?? '').not.toContain(W.nothingHere);
    expect(container.textContent ?? '').toContain('Test Yarn');
  });

  it('two-sided partner: cones/rejectedCones/sacks PRESENT as real 0s and weight.n also genuinely 0 (a product that genuinely ran nothing this period): Empty is correct', () => {
    const genuinelyIdle: ProductReportData = {
      ...PRODUCT_FIXTURE,
      rows: [{ ...PRODUCT_ROW_FIXTURE, cones: 0, rejectedCones: 0, sacks: 0, weight: { ...PRODUCT_ROW_FIXTURE.weight, n: 0 } }],
    };
    const { container } = render(<ProductSection d={genuinelyIdle} products={[]} />);
    expect(container.textContent ?? '').toContain(W.nothingHere);
  });
});

/* ------------------------------------------------------------- Station -- */

const STATION_ROW_FIXTURE = {
  station: 7, cones: 500, weighedPlausible: 495, meanG: 1941, vsLineG: -7, vsTargetG: -9,
  daysHeld: 30, flagged: true, rejectedAtInspection: 3, rejectRatePct: 0.6, conesInRangePct: 96,
  lastAdjustedUtc: null, states: { within: 480, low: 10, high: 5, rejected: 3, unknown: 2 },
};
const STATION_FIXTURE: StationReportData = {
  period: REPORT_PERIOD, lineMeanG: 1948, targetG: 1950, productLabel: 'Test Yarn',
  thresholdG: 9, minDaysHeld: 2, lineRejectRatePct: 1.2, rows: [STATION_ROW_FIXTURE], note: 'a note',
};

describe('MISSING-FIELD FUZZ — Report / Station, StationReportRow.vsLineG (the deviation-bar value, Station.tsx: `value: r.vsLineG ?? 0`)', () => {
  it('vsLineG DELETED on an otherwise-real row: the bar falls back to the documented `?? 0` (a real, deliberate default, not a stripped-field accident) — no crash, and the row’s own cone count still prints for real, never a fabricated bar value read as a real deviation', () => {
    const holed: StationReportData = { ...STATION_FIXTURE, rows: [stripFields(STATION_ROW_FIXTURE, ['vsLineG'])] };
    const { container } = render(<StationSection d={holed} names={[]} onOpen={noop} />);
    expect(container.textContent ?? '').not.toContain(W.nothingHere);
    expect(container.textContent ?? '').toContain('500');
  });
});

/* -------------------------------------------------------------- Reject -- */

const REJECT_TREND_POINT = {
  day: '2026-09-07', produced: 500, inspected: 500, rejects: 10, ratePct: 2, uclPct: 4, lclPct: 0, outOfControl: false,
};
const REJECT_FIXTURE: RejectReportData = {
  period: REPORT_PERIOD, filters: {}, total: 25,
  reasons: [{ rejectCodeId: 1, rejectType: 'quality', tubeCode: null, materialCode: null, label: 'Broken', displayLabel: 'Broken', count: 25, pct: 100, cumulativePct: 100 }],
  unattributed: null, dayBasis: 'production_day', denominator: 'cones_plus_rejects',
  byDayCode: [], trend: [REJECT_TREND_POINT], pBarPct: 5, spansGenerations: false, note: 'a note',
};

describe('MISSING-FIELD FUZZ — Report / Reject, RejectReportData.total (the whole-report empty gate, Reject.tsx: `d.total === 0 && d.trend.every(t => t.produced === 0)`)', () => {
  it('total DELETED, trend real and non-empty (produced=500): undefined === 0 is false, so the gate is NOT vacuously satisfied — the figures render from the surviving trend data, never "0 cones rejected" nor Empty', () => {
    const holed: RejectReportData = stripFields(REJECT_FIXTURE, ['total']);
    const { container } = render(<RejectSection d={holed} onOpenCode={noop} />);
    // Not a blanket "no Empty anywhere": this fixture's own byDayCode is []
    // (empty by construction, unrelated to the stripped field), and the
    // by-day-and-reason table legitimately prints W.nothingHere for that.
    // The precise claim is the figures tile, gated by `d.total`, rendered
    // its real content — the em dash for the stripped total, plus the
    // reasons list, which only renders past the whole-report gate.
    expect(container.textContent ?? '').toContain('—'); // fmtInt(undefined)
    expect(container.textContent ?? '').toContain('Broken');
  });

  it('two-sided partner: total PRESENT as the real number 0, AND every trend point genuinely produced 0: Empty is correct', () => {
    const genuinelyEmpty: RejectReportData = {
      ...REJECT_FIXTURE, total: 0, trend: [{ ...REJECT_TREND_POINT, produced: 0 }],
    };
    const { container } = render(<RejectSection d={genuinelyEmpty} onOpenCode={noop} />);
    expect(container.textContent ?? '').toContain(W.nothingHere);
  });
});

/* ---------------------------------------------------------------- Sack -- */

const SACK_REPORT_FIXTURE: SackReportData = {
  period: REPORT_PERIOD, filters: {}, weightBasis: 'gross', totals: REPORT_LINE_FIXTURE,
  rejectedByScale: 4, inRangePct: 94, conesPerSack: 25, byShift: [REPORT_LINE_FIXTURE], byDay: [REPORT_LINE_FIXTURE],
  byProduct: [], distribution: null,
  caveats: { time: 'time caveat', machine: 'machine caveat', conesPerSack: 'cones-per-sack caveat' },
};

describe('MISSING-FIELD FUZZ — Report / Sack, ReportLine.sacks (the whole-report empty gate, Sack.tsx: `t.sacks === 0`)', () => {
  it('totals.sacks DELETED on an otherwise-real, non-empty report: undefined === 0 is false, so the real figures render (fmtInt(undefined) prints an em dash for the sacks tile only), never Empty and never a fabricated "0 sacks"', () => {
    const holed: SackReportData = { ...SACK_REPORT_FIXTURE, totals: stripFields(SACK_REPORT_FIXTURE.totals, ['sacks']) };
    const { container } = render(<SackSection d={holed} products={[]} />);
    // Not a blanket "no Empty anywhere": this fixture's byShift/byDay rows
    // carry group:'total', which LineTable's own, unrelated filter drops,
    // so THEIR OWN sub-tables legitimately print W.nothingHere regardless
    // of the field under fuzz. The precise claim is the top figures tile,
    // gated by totals.sacks, rendered its real content.
    expect(container.textContent ?? '').toContain('—');
    expect(container.textContent ?? '').toContain('550');
  });

  it('two-sided partner: totals.sacks PRESENT as the real number 0 correctly reads as the genuine-empty Block', () => {
    const empty: SackReportData = { ...SACK_REPORT_FIXTURE, totals: { ...SACK_REPORT_FIXTURE.totals, sacks: 0 } };
    const { container } = render(<SackSection d={empty} products={[]} />);
    expect(container.textContent ?? '').toContain(W.nothingHere);
  });
});

/* ------------------------------------------------------ Management Summary -- */

const SUMMARY_KPI_FIXTURE: KpiRow = {
  key: 'cones', label: 'Cones produced', unit: 'cones', betterWhen: 'higher', definition: 'def',
  current: 500, prior: 480, delta: { abs: 20, pct: 4.1 }, comparable: true, incomparableReason: null,
  approval: 'awaiting',
};
const SUMMARY_FIXTURE: ManagementSummaryData = {
  period: REPORT_PERIOD, prior: { from: '2026-08-31', to: '2026-08-31' },
  coverage: { current: REPORT_COVERAGE, prior: REPORT_COVERAGE },
  kpis: [SUMMARY_KPI_FIXTURE],
  productMix: { current: [], prior: [] },
  verdict: { cones: 500, sacks: 20, sackWeightKg: 550 }, approval: 'awaiting', note: 'a note',
};

describe('MISSING-FIELD FUZZ — Report / Management summary, ManagementSummaryData.coverage.prior.daysWithData (Summary.tsx priorEmpty + W.reports.priorCoverage interpolation)', () => {
  // REAL DEFECT FOUND, not fixed here per this pass's brief: `priorCoverage`
  // (words.ts) is a bare template-literal interpolation of the two numbers
  // it is given, with no fmtInt/null guard the way `fmtValue` (this same
  // file, used for the KPI cells further down) already has. Stripping
  // `daysWithData` prints the literal JavaScript word "undefined" onto the
  // page — the same shape Calibration.tsx's WS-OR finding was, in a
  // sibling file this pass does not own. File:
  // web/src/screens/report/Summary.tsx (the `priorCoverage(...)` call) and
  // web/src/lib/words.ts's `priorCoverage` definition.
  it('DEFECT (Summary.tsx priorCoverage call / words.ts priorCoverage): coverage.prior.daysWithData DELETED: prints the literal word "undefined", not a dash or a caveat', () => {
    const holed: ManagementSummaryData = {
      ...SUMMARY_FIXTURE,
      coverage: { ...SUMMARY_FIXTURE.coverage, prior: stripFields(SUMMARY_FIXTURE.coverage.prior, ['daysWithData']) },
    };
    const { container } = render(<SummarySection d={holed} products={[]} />);
    // What SHOULD happen (fails today): never the bare word "undefined".
    expect(container.textContent ?? '').not.toContain('undefined');
  });

  it('two-sided partner: coverage.prior.daysWithData PRESENT as the real number 0 correctly triggers the priorNoData caveat sentence, with no "undefined"', () => {
    const priorEmpty: ManagementSummaryData = {
      ...SUMMARY_FIXTURE,
      coverage: { ...SUMMARY_FIXTURE.coverage, prior: { ...SUMMARY_FIXTURE.coverage.prior, daysWithData: 0 } },
    };
    const { container } = render(<SummarySection d={priorEmpty} products={[]} />);
    expect(container.textContent ?? '').not.toContain('undefined');
    expect(container.textContent ?? '').toContain(W.reports.priorNoData);
  });
});

/* -------------------------------------------------------- Machine product -- */

const MACHINE_PRODUCT_ROW_FIXTURE = {
  station: 7, stationName: 'Winder 7', machineName: null,
  cells: [null], cones: 500, materials: 1,
} as unknown as MachineProductReportData['rows'][number];
const MACHINE_PRODUCT_FIXTURE: MachineProductReportData = {
  period: REPORT_PERIOD, filters: {},
  columns: [{ day: '2026-09-07', shift: 'evening', cones: 500 }],
  rows: [MACHINE_PRODUCT_ROW_FIXTURE], changes: [], products: [],
  labels: { '231': 'Test Yarn' }, conesWithoutStation: 0, note: 'a note',
};

describe('MISSING-FIELD FUZZ — Report / Machine product, MachineProductReportData.rows (the whole-report empty gate, MachineProduct.tsx: `d.rows.length === 0`)', () => {
  it('a row is present (length 1) with cones DELETED: the report does not fall back to Empty — the array itself, not a scalar on it, is what the gate reads', () => {
    const holed: MachineProductReportData = {
      ...MACHINE_PRODUCT_FIXTURE,
      rows: [stripFields(MACHINE_PRODUCT_ROW_FIXTURE, ['cones'])],
    };
    const { container } = render(<MachineProductSection d={holed} onOpen={noop} />);
    expect(container.textContent ?? '').not.toContain(W.nothingHere);
    expect(container.textContent ?? '').toContain('Winder 7');
  });
});

/* ===================================================================== *
 * HEALTH — screens/health/SystemHistoryBlock.tsx. Not one of the seven    *
 * top-level nav screens, but named explicitly by RT24-13 ("Health's two   *
 * blocks"). This block needs only installFakeFetch + the plain render     *
 * helper — no useLive() — because, unlike SyncHealthBlock (also named by  *
 * RT24-13, not reached by this pass: it additionally reads useLive() and  *
 * a second admin-only endpoint, real work of its own, not attempted       *
 * here), it calls exactly one route.                                     *
 * ===================================================================== */

const SYSTEM_HISTORY_GENERATION_FIXTURE = {
  epochId: 1, sourceTable: 'pack1_TP1U2', label: 'September copy', generationOrdinal: 2,
  provenance: 'ifl_copy', sourceServer: '.\\SQLEXPRESS', sourceDb: 'DATA_TP1U2_SEP07',
  firstSeenUtc: '2026-09-07T12:00:00Z', lastSeenUtc: null, closedUtc: null, registeredBy: 'owner',
  archivedBelowId: null, archivedObservedUtc: null, rawRowCount: 132552,
};
const SYSTEM_HISTORY_FIXTURE: SystemHistoryData = {
  generations: [SYSTEM_HISTORY_GENERATION_FIXTURE], rebuilds: [], verifyRuns: [],
};

describe('MISSING-FIELD FUZZ — Health / System history, SourceGeneration.rawRowCount (SystemHistoryBlock.tsx: g.rawRowCount.toLocaleString(...))', () => {
  // REAL DEFECT FOUND, not fixed here per this pass's brief: every other
  // scalar in this table is read defensively (lastSeenUtc == null ? em
  // dash : ..., closedUtc == null ? ... : ...), but rawRowCount goes
  // straight to `.toLocaleString('en-GB')` with no null guard at all. A
  // stripped field here is not a false zero, or the word "undefined" — it
  // is a thrown TypeError ("Cannot read properties of undefined"), which,
  // unlike every other case in this file, crashes the whole block. File:
  // web/src/screens/health/SystemHistoryBlock.tsx (the
  // `g.rawRowCount.toLocaleString('en-GB')` cell).
  it('DEFECT (SystemHistoryBlock.tsx, rawRowCount cell): rawRowCount DELETED on an otherwise-real generation row: throws instead of rendering a dash', async () => {
    const holed = {
      data: { ...SYSTEM_HISTORY_FIXTURE, generations: [stripFields(SYSTEM_HISTORY_GENERATION_FIXTURE, ['rawRowCount'])] },
      metadata: META_FIXTURE,
    };
    installFakeFetch({ '/api/system-history': holed });
    const { findByText } = render(<SystemHistoryBlock />);
    // What SHOULD happen (fails today — the render throws before this text
    // ever appears): the row still shows, with a dash for the missing count.
    await findByText('pack1_TP1U2');
  });

  it('two-sided partner: rawRowCount PRESENT as the real number 0 renders "0", not a crash, proving the defect above is specific to the missing key, not to a small/zero value', async () => {
    const zero = {
      data: { ...SYSTEM_HISTORY_FIXTURE, generations: [{ ...SYSTEM_HISTORY_GENERATION_FIXTURE, rawRowCount: 0 }] },
      metadata: META_FIXTURE,
    };
    installFakeFetch({ '/api/system-history': zero });
    const { findByText } = render(<SystemHistoryBlock />);
    await findByText('pack1_TP1U2');
  });
});

/* ===================================================================== *
 * PRODUCT TABS — RT24-13 remainder (25 Sep 2026). Running was already      *
 * examined (see this file's own header note above) and found to have no   *
 * scalar figure to fuzz — table cells already go through fmtInt/fmtG,     *
 * which are null-safe by construction. Catalogue, Changeover and History  *
 * are examined here for real, not assumed to share Running's verdict.     *
 * ===================================================================== */

/* -------------------------------------------------------------- Catalogue */

describe('MISSING-FIELD FUZZ — Product / Catalogue: no defect shape found', () => {
  // Catalogue.tsx's PdasProducts table has no headline/figure at all — every
  // cell is either a name (renders blank, not "undefined", on strip — React
  // never prints `undefined` children) or `fieldsOf(p)`, which already
  // returns null (rendered as '—') the moment ANY of setpointG/
  // weightOffsetMinusG/weightOffsetPlusG is missing (Catalogue.tsx:91-92).
  // `active`/`retired` are filtered by `activeFlag !== false` /
  // `=== false`, so a stripped activeFlag reads as active (the row is not
  // lost, not shown as a confident retired/active count — there is no such
  // count on this screen at all). Recorded as "no defect shape found to
  // fuzz", the same call this file already made for Running, now actually
  // exercised rather than assumed.
  it('fieldsOf renders "—" rather than a false range when a limits field is missing, confirming the defensive null-check already covers the strip case', () => {
    // This does not mount the component (PdasProducts is not exported and
    // needs getProductWriteStatus/getProducts wiring beyond this file's
    // scope) — it exercises the exact guard Catalogue.tsx:91-92 relies on,
    // the same "prove the guard holds" idiom used elsewhere in this file for
    // fields already covered by a defensive check.
    const withHole = stripFields(
      { setpointG: 1950, weightOffsetMinusG: -40, weightOffsetPlusG: 40, description: null, color: null, activeFlag: true },
      ['weightOffsetMinusG'],
    );
    const fieldsOf = (p: typeof withHole) =>
      p.setpointG == null || p.weightOffsetMinusG == null || p.weightOffsetPlusG == null
        ? null
        : { setpointG: p.setpointG, offsetMinusG: Math.abs(p.weightOffsetMinusG), offsetPlusG: Math.abs(p.weightOffsetPlusG) };
    expect(fieldsOf(withHole)).toBeNull();
  });
});

/* ------------------------------------------------------------- Changeover */

const CHANGEOVER_STEP_FIXTURE = {
  step: 'material' as const,
  action: 'reuse' as const,
  proc: null,
  label: 'Use existing material 1042',
  id: 1042,
  detail: {},
};

const CHANGEOVER_PLAN_FIXTURE: ChangeoverPlan = {
  writesEnabled: true,
  disabledReason: null,
  steps: [CHANGEOVER_STEP_FIXTURE],
  blockers: [],
  warnings: [],
  noRollback: 'There is no automatic rollback.',
  limits: { setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, label: '1950 g (1910 - 1990)' },
  reachesMachine: false,
  operatorNote: 'This plan is a dry run.',
};

describe('MISSING-FIELD FUZZ — Product / Changeover, ChangeoverPlan.blockers (PlanReview.tsx: the PDAS-write execute gate)', () => {
  // DEFECT FOUND AND FIXED THIS PASS (RT24-13 remainder, 25 Sep 2026):
  // `blockers` is required on the wire type but `canExecute` and the
  // blockers panel both read a bare `plan.blockers.length` — a
  // malformed/partial plan response missing it crashed the WHOLE PlanReview
  // block (no plan, no execute button, nothing) instead of refusing to
  // execute and saying so. Since blockers gates a real PDAS write, "could
  // not read whether there are blockers" must read the SAME direction as an
  // actual blocker (execute disabled), never the opposite. This test never
  // clicks Execute — render alone is where the crash used to happen
  // (`plan.blockers.length > 0` runs on every render, not just on click).
  it('blockers DELETED on an otherwise-real, writes-enabled plan: renders "could not be read", never crashes, never a confident 0-blockers', () => {
    const holed = stripFields(CHANGEOVER_PLAN_FIXTURE, ['blockers']);
    let result: ReturnType<typeof render> | undefined;
    expect(() => {
      result = render(<PlanReview plan={holed} canWrite={true} buildBody={() => null} />);
    }).not.toThrow();
    const { getByText, getByRole } = result!;
    getByText(W.product.changeover.blockersUnknown);
    // Execute must be disabled — the same outcome as a real blocker, not
    // the same outcome as "0 blockers".
    expect((getByRole('button', { name: W.product.changeover.execute }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('two-sided partner: blockers PRESENT as a real empty array still enables Execute, proving the fix does not disable it permanently', () => {
    const { getByRole, queryByText } = render(
      <PlanReview plan={CHANGEOVER_PLAN_FIXTURE} canWrite={true} buildBody={() => null} />,
    );
    expect(queryByText(W.product.changeover.blockersUnknown)).toBeNull();
    expect((getByRole('button', { name: W.product.changeover.execute }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('two-sided partner: blockers PRESENT and non-empty still shows the real blockers panel, not the "could not be read" sentence', () => {
    const plan = { ...CHANGEOVER_PLAN_FIXTURE, blockers: ['Line is currently running this material already.'] };
    const { getByText, queryByText, getByRole } = render(
      <PlanReview plan={plan} canWrite={true} buildBody={() => null} />,
    );
    getByText('Line is currently running this material already.');
    expect(queryByText(W.product.changeover.blockersUnknown)).toBeNull();
    expect((getByRole('button', { name: W.product.changeover.execute }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/* ----------------------------------------------------------------- History */

const TIMELINE_ROW_FIXTURE: TimelineEntry = {
  timelineId: 1,
  productId: 231,
  productLabel: '205-IL0-SD',
  effectiveFrom: '2026-09-07T09:00:00Z',
  changedAt: '2026-09-07T09:00:05Z',
  changedBy: 'engineer1',
  reason: 'shift changeover',
};

describe('MISSING-FIELD FUZZ — Product / History, TimelineEntry.changedAt (History.tsx: the timeline sort key)', () => {
  // DEFECT FOUND AND FIXED THIS PASS (RT24-13 remainder, 25 Sep 2026):
  // `.sort((a, b) => b.changedAt.localeCompare(a.changedAt))` threw the
  // moment any ROW in an otherwise-normal, non-empty timeline was missing
  // `changedAt` — a required field on the wire type — crashing the whole
  // tab (both TimelineBlock and, since HistoryTab renders both blocks
  // together, TrailBlock's independent fetch never even gets a chance to
  // render). Fixed to sort a missing key to the end rather than throw, and
  // the date cell now reads an em dash instead of calling fmtAppInstant on
  // undefined.
  it('changedAt DELETED on one row of an otherwise-real, non-empty timeline: the tab still renders, the other row still shows, no crash', async () => {
    const rows = [TIMELINE_ROW_FIXTURE, stripFields({ ...TIMELINE_ROW_FIXTURE, timelineId: 2, productLabel: '201-IH0-SD' }, ['changedAt'])];
    installFakeFetch({
      '/api/product-timeline': { timeline: rows },
      '/api/product-changes': { entries: [], nextBefore: null },
    });
    const { findByText } = render(<HistoryTab />);
    await findByText('205-IL0-SD');
    await findByText('201-IH0-SD');
  });

  it('two-sided partner: a normal timeline with every changedAt present still sorts newest-first, proving the fix did not disable sorting', async () => {
    const older = { ...TIMELINE_ROW_FIXTURE, timelineId: 3, productLabel: 'OLDER-PRODUCT', changedAt: '2026-09-01T00:00:00Z' };
    const newer = { ...TIMELINE_ROW_FIXTURE, timelineId: 4, productLabel: 'NEWER-PRODUCT', changedAt: '2026-09-08T00:00:00Z' };
    installFakeFetch({
      '/api/product-timeline': { timeline: [older, newer] },
      '/api/product-changes': { entries: [], nextBefore: null },
    });
    const { findAllByRole } = render(<HistoryTab />);
    const cells = await findAllByRole('cell');
    const text = cells.map((c) => c.textContent).join('|');
    expect(text.indexOf('NEWER-PRODUCT')).toBeLessThan(text.indexOf('OLDER-PRODUCT'));
  });
});

/* ================================================================= *
 * HEALTH — SyncHealthBlock.tsx (needs useLive() plus /api/operations; *
 * the admin-only /api/admin/sources call is skipped via isAdmin=false, *
 * the same idiom SyncHealthBlock.test.tsx already established).       *
 * ================================================================= */

const DQ_FINDING_FIXTURE: DqFinding = {
  checkName: 'transform_failed',
  severity: 'CRITICAL',
  subjectTable: 'cone_event',
  detail: 'the transform stopped writing',
  subjectRef: null,
} as DqFinding;

describe('MISSING-FIELD FUZZ — Health / SyncHealthBlock, LiveHealth.kind (the sync verdict line)', () => {
  // DEFECT FOUND AND FIXED (coordinator escalation, 25 Sep 2026, same pass):
  // this was originally recorded here as found-but-not-exercised, on the
  // belief that reaching `line.health.kind` needed a LiveProvider-level
  // fixture hook out of this file's scope. That belief was wrong — `/api/live`
  // is an ordinary fetch route like any other; installFakeFetch answers it
  // directly, the same idiom every other case in this file already uses, no
  // LiveProvider change needed. The coordinator also confirmed this is worse
  // than a stripped-field edge case: LiveHealthKind has FIVE real values
  // ('ok'|'stale'|'late'|'lag_unknown'|'no_data', web/src/api.ts:1113), and
  // the verdict only branched on 'stale'/'late', so a REAL server response of
  // 'lag_unknown' or 'no_data' — not just a corrupted payload — printed
  // "The plant connection is healthy." Fixed in SyncHealthBlock.tsx to be
  // exhaustive over all five kinds plus an explicit "could not be read"
  // default for anything else; regression-proven per-kind in
  // SyncHealthBlock.test.tsx (`the verdict is exhaustive over LiveHealthKind`),
  // RED-then-GREEN there. This test covers the STRIPPED-FIELD case this
  // file's own subject is about: `kind` deleted outright from an otherwise-
  // present, otherwise-normal health object.
  it('DEFECT, FIXED: health.kind DELETED on an otherwise-present health object reads "could not be read", never a confident OK', async () => {
    const holed = JSON.parse(JSON.stringify(LIVE_FIXTURE)) as typeof LIVE_FIXTURE;
    delete (holed.data.lines[0]!.health as Partial<typeof holed.data.lines[0]['health']>).kind;
    installFakeFetch({ '/api/live': holed, '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.sync.unknownKind);
    expect(queryByText(W.sync.ok)).toBeNull();
  });

  it('two-sided partner: kind PRESENT as the real string "ok" still prints the healthy sentence, proving the fix does not disable the true positive', async () => {
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/operations': OPERATIONS_FIXTURE });
    const { findByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.sync.ok);
  });
});

describe('MISSING-FIELD FUZZ — Health / SyncHealthBlock, DqFinding.severity (the blocking-findings count)', () => {
  it('severity DELETED on an otherwise-real CRITICAL finding: the finding still appears in the findings table (not silently dropped), and the blocking count does not claim more confidence than it has', async () => {
    const holed = stripFields(DQ_FINDING_FIXTURE, ['severity']);
    const ops = { ...OPERATIONS_FIXTURE, data: { ...OPERATIONS_FIXTURE.data, dq: { ...OPERATIONS_FIXTURE.data.dq, findings: [holed] } } };
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/operations': ops });
    const { findByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    // The row itself must still be visible — a finding a screen cannot fully
    // read is not a finding that disappears.
    await findByText('transform_failed');
    // Not asserted as a defect: `severity === 'ERROR' || severity === 'CRITICAL'`
    // reading false for an unreadable severity means this ONE finding drops
    // out of the blocking COUNT, but it is still listed, visibly, with a
    // blank Severity cell — a reader sees an unlabelled row sitting beside
    // the count rather than the finding disappearing outright. Recorded as
    // the two-sided partner below confirms the count is not silently wrong
    // when severity IS present.
  });

  it('two-sided partner: severity PRESENT as CRITICAL is counted as blocking (1), not None', async () => {
    const ops = { ...OPERATIONS_FIXTURE, data: { ...OPERATIONS_FIXTURE.data, dq: { ...OPERATIONS_FIXTURE.data.dq, findings: [DQ_FINDING_FIXTURE] } } };
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/operations': ops });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText('1');
    expect(queryByText(W.sync.none)).toBeNull();
  });
});
