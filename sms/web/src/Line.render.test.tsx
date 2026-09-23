/**
 * WS-B1 (23 Sep 2026 red-team remediation) — two defects on Line, both make
 * the client print a number the server already knows is wrong.
 *
 * RED 1 (defect 1, reject rate): `periodFigures` used to divide by
 * `cones + rejectedCones` — double-counting the ~98% of rejects that are
 * the SAME physical cone as an existing `cones` row, weighed then separately
 * rejected. The corrected denominator is `cones + unmatchedRejects`
 * (production.ts's own field, added to the client's `ProductionRow` type
 * alongside this fix). The fixture below deliberately makes the two figures
 * diverge (3,456 vs 3,179 — the values named in the remediation brief) so a
 * test that only checked "some string is a percentage" could not pass by
 * accident.
 *
 * RED 2 (defect 2, absence renders as zero): production.ts's `dataIssues[]`
 * (WS-P, commit 71757a3) names a field absent from a row that was otherwise
 * present. The row still carries a numeric 0 for that field — the response
 * shape never changes — so a screen reading `r.cones ?? 0` cannot tell a
 * real empty period from one the server itself flagged as unreadable. Proven
 * live (see the remediation brief): a row with fields deleted printed
 * "0 cones / 99.9% within the scale's limits / 0 sacks / 0 kg / 0 rejected"
 * directly above a chart still reading 77,492 cones for the same period.
 *
 * Both tests mount the real `LineScreen` against a fake fetch, the same
 * idiom `rt006.lagUnknown.test.tsx` and `banner.provenance.test.tsx` use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from './testkit/fetchRouter';
import { renderWithLive } from './testkit/render';
import { LIVE_FIXTURE } from './testkit/fixtures';
import { LineScreen } from './screens/Line';
import { W } from './lib/words';
import type { Envelope, ProductionData, ProductionRow } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD = {
  key: 'shift' as const,
  from: '2026-09-07',
  to: '2026-09-07',
  tsTo: '2026-09-07T23:59:59.000Z',
  live: true,
  days: 1,
};

const BASE_ROUTES = {
  '/api/live': LIVE_FIXTURE,
  '/api/stations': { stations: [] },
  '/api/product-at': { product: null, limits: null, neverRecorded: true },
  '/api/products': { products: [] },
  '/api/attention': {
    data: {
      window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
      period: { from: '2026-09-07', to: '2026-09-07', shift: null },
      findings: [], totalFindings: 0, thresholds: { driftG: 15, minDaysHeld: 3 },
    },
    metadata: LIVE_FIXTURE.metadata,
  },
  // asOfUtc set and one (quiet) machine row: `Empty message={W.nothingHere}`
  // (Line.tsx's `MachinesBlock`) fires whenever either is absent, which
  // would print the SAME string the KPI-block note under test also uses —
  // an unrelated block that would make `queryByText(W.nothingHere)` below
  // ambiguous for a reason that has nothing to do with the fix under test.
  '/api/machines/running': {
    data: {
      asOfUtc: '2026-09-07T16:40:00Z',
      windowMs: 7_200_000,
      windowStartUtc: '2026-09-07T14:40:00Z',
      machines: [{
        station: 1, stationName: null, machineName: null, materialId: null, productName: null,
        cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: true, quiet: true,
      }],
      materialsRunning: 0,
      generation: LIVE_FIXTURE.data.lines[0]!.generation,
    },
    metadata: LIVE_FIXTURE.metadata,
  },
};

function productionRoute(row: ProductionRow): Envelope<ProductionData> {
  return {
    data: { groupBy: 'none', rows: [row], unattributed: null, states: null, implausible: null, dataIssues: [] },
    metadata: LIVE_FIXTURE.metadata,
  };
}

describe('Line — defect 1: reject rate must match the server denominator (cones + unmatchedRejects)', () => {
  it('RED 1: a fixture where rejectedCones and unmatchedRejects differ renders the CORRECTED rate, never the old cones+rejectedCones one', async () => {
    // 20,000 cones, 3,456 rejected cones, of which only 3,179 have no
    // matching cone_event row (the values named in the remediation brief).
    // Correct: 3456 / (20000 + 3179) = 14.91% (fmtPct1 "14.9%").
    // Old, buggy: 3456 / (20000 + 3456) = 14.73% (fmtPct1 "14.7%") — the
    // exact wrong figure this fix removes.
    const row: ProductionRow = {
      group: 'total',
      cones: 20_000,
      rejectedCones: 3_456,
      unmatchedRejects: 3_179,
      sacks: 800,
      sackWeightKg: 22_000,
      conesInRangePct: 97,
      sacksPassedScalePct: 95,
    };
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(row) });

    const { findByText, queryByText } = renderWithLive(
      <LineScreen
        period={PERIOD}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenReading={() => {}}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );

    // The corrected figure, matching the server's own `toReportLine` formula.
    await findByText(W.ofEverything('14.9%'));
    // The two-sided half: the OLD, wrong figure — cones + every reject as
    // the denominator — must never appear anywhere on the page.
    expect(queryByText(W.ofEverything('14.7%'))).toBeNull();
  });
});

describe('Line — defect 2: a data issue must never render as a genuine zero', () => {
  it('RED 2: a row with `cones` named in dataIssues shows a dash and a caveat, never a bare "0 cones" the reader could mistake for a measurement', async () => {
    // The server's own shape (production.presence.test.ts): the field still
    // reads as a numeric 0 — the response shape is unchanged — and
    // `dataIssues` is the ONLY discriminator between this and a genuine
    // empty period.
    const row: ProductionRow = {
      group: 'total',
      cones: 0,
      rejectedCones: 0,
      unmatchedRejects: 0,
      sacks: 0,
      sackWeightKg: 0,
      conesInRangePct: null,
      sacksPassedScalePct: null,
    };
    const env: Envelope<ProductionData> = {
      data: {
        groupBy: 'none',
        rows: [row],
        unattributed: null,
        states: null,
        implausible: null,
        dataIssues: [
          { field: 'cones', group: 'total', reason: 'cone_event aggregate row is missing its count (n)' },
          { field: 'conesInRangePct', group: 'total', reason: 'cone_event aggregate row is missing its count (n); in-range % unknowable' },
        ],
      },
      metadata: LIVE_FIXTURE.metadata,
    };
    installFakeFetch({ ...BASE_ROUTES, '/api/production': env });

    const { findAllByText, queryByText } = renderWithLive(
      <LineScreen
        period={PERIOD}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenReading={() => {}}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );

    // The caveat this fix adds — proves the block noticed the data issue.
    // TWO instances: the cones figure (the field dataIssues names directly)
    // and the reject-rate figure (whose denominator the same cones issue
    // poisons — see `rateUnreadable` in periodFigures).
    const notes = await findAllByText(W.fig.couldNotRead);
    expect(notes.length).toBe(2);
    // The false-all-clear the block must never fall through to alongside a
    // data issue: "Nothing recorded in this period" asserts a fact about the
    // LINE (it made nothing) when the true fact is about the SERVER (it
    // could not read part of what it has).
    expect(queryByText(W.nothingHere)).toBeNull();
    // The two-sided half: a genuinely empty period (below) must still read
    // as W.nothingHere, so this is not satisfied by a screen that stopped
    // printing it altogether.
  });

  it('the two-sided half: a genuinely empty period (no data issue) still reads "Nothing recorded in this period"', async () => {
    const row: ProductionRow = {
      group: 'total', cones: 0, rejectedCones: 0, unmatchedRejects: 0,
      sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null,
    };
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRoute(row) });

    // `live: false` — a CLOSED period, so `kpiBlockNote`'s acquisition-lag
    // branch (`period.live && line.ingestLagSeconds > 0`, W.fig.notCaughtUp)
    // cannot pre-empt the genuinely-empty branch this half is testing; the
    // fixture's own `line.ingestLagSeconds` (1,140s) is real and would
    // otherwise legitimately win, which is a DIFFERENT correct sentence, not
    // a failure of this fix.
    const CLOSED_PERIOD = { ...PERIOD, live: false };
    const { findByText, queryByText } = renderWithLive(
      <LineScreen
        period={CLOSED_PERIOD}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenReading={() => {}}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );

    await findByText(W.nothingHere);
    expect(queryByText(W.fig.couldNotRead)).toBeNull();
  });
});
