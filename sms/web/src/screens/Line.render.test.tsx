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
import { installFakeFetch } from '../testkit/fetchRouter';
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
});
