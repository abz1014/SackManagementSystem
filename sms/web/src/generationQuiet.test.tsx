/**
 * A QUIET SCREEN MUST SAY WHY IT IS QUIET (D-11, 23 Sep 2026).
 *
 * The owner chose "newest REAL source generation" for the five live sites,
 * accepting the stated cost: the plant-simulator rehearsal stops driving the
 * live screens, because the simulator is never the real generation. The
 * consequence on this development copy is that Line, Wall and Health show
 * data ending 7 Sep 2026 while rows keep arriving under another generation.
 *
 * THE ARITHMETIC IS THEN CORRECT AND ITS CONCLUSION IS FALSE. `/api/live`
 * judges the line against `now - lag` and, given a tip two weeks old,
 * correctly returns `idle`. Rendering that as "Line 3 has made nothing since
 * 7 Sep" is the same over-claim `fc0e3c3` removed from the Wall — a board
 * asserting a fact about the plant from data it cannot see. These tests pin
 * the three screens saying WHICH it is.
 *
 * Every case is two-sided, the rule this repo adopted in UX Phase 8: a test
 * that only proved the sentence appears would pass equally against a screen
 * that printed it unconditionally, which would be a worse defect — at IFL,
 * whose generations do not overlap in time, the sentence must NEVER appear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from './testkit/fetchRouter';
import { renderWithLive } from './testkit/render';
import { GENERATION_FIXTURE, LIVE_FIXTURE, OPERATIONS_FIXTURE } from './testkit/fixtures';
import { SyncHealthBlock } from './screens/health/SyncHealthBlock';
import { LineScreen } from './screens/Line';
import { WallScreen } from './screens/Wall';
import { W } from './lib/words';
import {
  hasNewerElsewhere,
  healthExcludedLine,
  healthGenerationLine,
  machineGridGenerationLine,
  quietBecauseGeneration,
  quietBecauseGenerationShort,
} from './lib/generationWords';
import type { Envelope, LiveData, LiveGenerationNote } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The dev sidecar's own shape: gen 3 ended 7 Sep, the simulator ran on. */
const ENDED: LiveGenerationNote = {
  ...GENERATION_FIXTURE,
  spansGenerations: true,
  otherGenerationExcluded: 284_520,
  newerElsewhereUtc: '2026-09-22T12:29:22.000Z',
  newerElsewhereSourceDb: 'DATA_TP1U2_SIM',
  newerElsewhereLabel: 'pack1_TP1U2 gen 4',
  newerElsewhereSimulator: true,
};

/* ------------------------------------------------------- the sentences */

describe('the sentences themselves', () => {
  it('state the newest reading, its date and age, in plain words — no jargon, no stopped/running claim', () => {
    const s = quietBecauseGeneration(ENDED, '12:00 PM, 7 Sep', '18 days')!;
    expect(s).toBe('Newest plant reading: 12:00 PM, 7 Sep (18 days old). Newer simulator readings are not counted.');
    // Owner complaint 25 Sep 2026: none of the sidecar's internals on Line.
    for (const jargon of [/generation/i, /pack1_TP1U2/, /gen \d/, /row identit/i, /tables?\b/i]) {
      expect(s).not.toMatch(jargon);
    }
    // Never implies either state.
    expect(s).not.toMatch(/\b(stopped|running)\b/i);
  });

  it('omit the age when none is given', () => {
    expect(quietBecauseGeneration(ENDED, '12:00 PM', null)).toBe(
      'Newest plant reading: 12:00 PM. Newer simulator readings are not counted.',
    );
  });

  it('do NOT claim the newer rows are synthetic when they are IFL’s own', () => {
    // The case at the plant: two of IFL's own generations, no simulator
    // anywhere. Calling their real data "the plant simulator's" on screen
    // would be a fabricated fact, which is the failure mode this whole pass
    // exists to avoid.
    const real: LiveGenerationNote = {
      ...ENDED,
      newerElsewhereSourceDb: 'DATA_TP1U2_OCT',
      newerElsewhereLabel: 'October copy - cones',
      newerElsewhereSimulator: false,
    };
    const s = quietBecauseGeneration(real, '12:00 PM, 7 Sep', '26 days')!;
    expect(s).not.toMatch(/simulator/i);
    expect(s).toContain('different data set');
  });

  it('print NOTHING when no reading anywhere is newer — the ordinary case at IFL', () => {
    expect(quietBecauseGeneration(GENERATION_FIXTURE, '12:00 PM', null)).toBeNull();
    expect(quietBecauseGenerationShort(GENERATION_FIXTURE, '12:00 PM')).toBeNull();
    expect(hasNewerElsewhere(GENERATION_FIXTURE)).toBe(false);
    expect(hasNewerElsewhere(ENDED)).toBe(true);
    // A missing note is "not stated", never "nothing was excluded".
    expect(hasNewerElsewhere(null)).toBe(false);
    expect(hasNewerElsewhere(undefined)).toBe(false);
  });

  it('never invent a generation name when the server stated none', () => {
    const unstated: LiveGenerationNote = {
      generation: null,
      spansGenerations: false,
      otherGenerationExcluded: 0,
      newerElsewhereUtc: null,
      newerElsewhereSourceDb: null,
      newerElsewhereLabel: null,
      newerElsewhereSimulator: false,
    };
    expect(healthGenerationLine(unstated)).toBeNull();
    expect(machineGridGenerationLine(unstated, null)).toBeNull();
    expect(healthExcludedLine(unstated, null)).toBeNull();
  });

  it('the Wall’s short form fits a footer and still refuses the word "stopped" as a claim', () => {
    const s = quietBecauseGenerationShort(ENDED, '12:00 PM 7 Sep')!;
    expect(s).toMatch(/newest plant reading/i);
    expect(s).not.toMatch(/\b(stopped|running)\b|generation/i);
    expect(s).toContain('12:00 PM 7 Sep');
    expect(s.length).toBeLessThan(200);
  });

  it('the machine grid names its window’s generation, with and without a newer one', () => {
    expect(machineGridGenerationLine(GENERATION_FIXTURE, null)).toBe(
      'Read from September copy - cones, one data copy.',
    );
    const s = machineGridGenerationLine(ENDED, '12:29 PM 22 Sep')!;
    expect(s).toContain('12:29 PM 22 Sep');
    expect(s).toMatch(/two tables/i);
  });

  it('Health counts the rows it did not measure, and does not pretend there were none', () => {
    expect(healthExcludedLine(GENERATION_FIXTURE, null)).toBeNull(); // one generation: nothing to say
    const s = healthExcludedLine(ENDED, '12:29 PM 22 Sep')!;
    expect(s).toContain('284,520');
    expect(s).toMatch(/not the plant has|not that the plant has/i);
  });
});

/* ------------------------------------------------------ Health, rendered */

const liveWith = (g: LiveGenerationNote): Envelope<LiveData> => ({
  ...LIVE_FIXTURE,
  data: { lines: [{ ...LIVE_FIXTURE.data.lines[0]!, generation: g }] },
});

describe('Health — SyncHealthBlock states the generation it measured from', () => {
  it('QUIET: names the generation, the rows left out, and that the PLANT has not stopped', async () => {
    installFakeFetch({ '/api/live': liveWith(ENDED), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(
      'Freshness, the acquisition lag and the newest reading above are all measured from September copy - cones, one batch of recorded data.',
    );
    await findByText(/284,520 readings on record belong to a different batch/);
    await findByText(/not that the plant has/);
  });

  it('ORDINARY: the same block names the generation and says NOTHING about exclusions', async () => {
    // The two-sided half. At IFL this is every page load, and an excluded-rows
    // sentence there would be a false statement about their data.
    installFakeFetch({ '/api/live': liveWith(GENERATION_FIXTURE), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(/all measured from September copy - cones, one batch of recorded data\./);
    expect(queryByText(/belong to a different batch/)).toBeNull();
    expect(queryByText(/not that the plant has/)).toBeNull();
  });
});

/* --------------------------------------------------- Line and Wall, rendered */

const PERIOD = {
  key: 'shift' as const,
  from: '2026-09-07',
  to: '2026-09-07',
  tsTo: '2026-09-07T23:59:59.000Z',
  live: true,
  days: 1,
};

const EMPTY_PRODUCTION = {
  data: { rows: [], unattributed: null, states: null, implausible: null },
  metadata: LIVE_FIXTURE.metadata,
};

const lineRoutes = (g: LiveGenerationNote) => ({
  '/api/live': liveWith(g),
  '/api/stations': { stations: [] },
  '/api/production': EMPTY_PRODUCTION,
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
  '/api/machines/running': {
    data: { asOfUtc: null, windowMs: 7_200_000, windowStartUtc: null, machines: [], materialsRunning: 0, generation: g },
    metadata: LIVE_FIXTURE.metadata,
  },
});

describe('Line — the headline stops asserting a state it cannot read', () => {
  it('QUIET: prints the reason, and does NOT say the line stopped', async () => {
    installFakeFetch(lineRoutes(ENDED));
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
    await findByText(/^Newest plant reading: .*Newer simulator readings are not counted\.$/);
    expect(queryByText(/pack1_TP1U2|source generation/)).toBeNull();
    // W.state.unknown is what the headline falls back to; the "stopped"
    // and "idle" sentences must be gone.
    await findByText(W.state.unknown);
    expect(queryByText(new RegExp(W.state.stopped('1 m').slice(0, 12)))).toBeNull();
  });

  it('ORDINARY: no generation sentence at all, and the headline asserts again', async () => {
    installFakeFetch(lineRoutes(GENERATION_FIXTURE));
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
    await findByText(/Is the line running/i);
    expect(queryByText(/Newest plant reading/)).toBeNull();
  });
});

describe('Wall — the board refuses to assert a state from a generation that ended', () => {
  it('QUIET: the big sentence goes to "not known" and the footer says why', async () => {
    installFakeFetch(lineRoutes(ENDED));
    const { findByText } = renderWithLive(<WallScreen onExit={() => {}} />);
    await findByText(W.state.unknown);
    await findByText(/Newest plant reading .*not counted/);
  });

  it('ORDINARY: the board asserts the state and prints no generation sentence', async () => {
    installFakeFetch(lineRoutes(GENERATION_FIXTURE));
    const { findByText, queryByText } = renderWithLive(<WallScreen onExit={() => {}} />);
    await findByText(/Line 3/);
    expect(queryByText(/Newest plant reading/)).toBeNull();
  });
});
