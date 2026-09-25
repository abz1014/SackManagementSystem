/**
 * RT-007 (red-team audit, 23 Sep 2026): the Line screen's provenance banner
 * — `quietBecauseGeneration` in `lib/generationWords.ts`, rendered by
 * `LineScreen` (`screens/Line.tsx`) directly under the headline — named the
 * ACTIVE generation only by its label, never by its own `simulator` flag. So
 * when the generation currently driving the screen is itself the simulator's
 * (the live sidecar's epochs 13-16, mislabelled `provenance: 'ifl_copy'` but
 * still caught by `isSimulator()`'s source_db check — see CLAUDE.md's 21 Sep
 * 2026 section and `api/src/services/generation.ts`), the banner said
 * "Every figure here is read from one source generation — [a real-sounding
 * label]" and, when a further simulator generation existed beyond it, added
 * "Those readings are the plant simulator's... They are left out" — about
 * the EXCLUDED generation only. Read together the sentence names the
 * excluded rows as synthetic and, by omission, everything else — what is
 * actually on screen — as real. It is exactly backwards: the displayed
 * figures are the simulator's.
 *
 * `generationQuiet.test.tsx` already pins the mirror-image rule — never call
 * real rows synthetic — and must keep passing, unmodified, alongside this
 * file. Two failure directions, one shared function, one obligation: the
 * claim can never disagree with `generationNote.generation.simulator` in
 * EITHER direction.
 */
import { describe, expect, it } from 'vitest';
import { installFakeFetch } from './testkit/fetchRouter';
import { renderWithLive } from './testkit/render';
import { GENERATION_FIXTURE, LIVE_FIXTURE } from './testkit/fixtures';
import { LineScreen } from './screens/Line';
import { quietBecauseGeneration, quietBecauseGenerationShort } from './lib/generationWords';
import type { Envelope, LiveData, LiveGenerationNote } from './api';

/**
 * RT-007's actual shape: the ACTIVE generation is the simulator's, mislabelled
 * `provenance: 'ifl_copy'` and carrying forward a label that reads as real —
 * but `simulator: true`, which is what `isSimulator()` still gets right.
 * A further, also-simulator generation lies beyond it, which is what used to
 * make the old sentence say "simulator" at all — about the wrong generation.
 */
const MINE_IS_SIMULATOR: LiveGenerationNote = {
  generation: {
    key: 'DATA_TP1U2_SIM#13',
    ordinal: 13,
    sourceDb: 'DATA_TP1U2_SIM',
    provenance: 'ifl_copy',
    label: 'September copy - cones',
    simulator: true,
  },
  spansGenerations: true,
  otherGenerationExcluded: 4_200,
  newerElsewhereUtc: '2026-09-23T09:00:00.000Z',
  newerElsewhereSourceDb: 'DATA_TP1U2_SIM',
  newerElsewhereLabel: 'pack1_TP1U2 gen 16',
  newerElsewhereSimulator: true,
};

/** The mirror case: the active generation is real, and so is whatever lies
 *  beyond it — the ordinary "IFL generation ended, another IFL generation
 *  continues" shape, with no simulator anywhere. */
const BOTH_REAL: LiveGenerationNote = {
  ...GENERATION_FIXTURE,
  spansGenerations: true,
  otherGenerationExcluded: 900,
  newerElsewhereUtc: '2026-10-01T09:00:00.000Z',
  newerElsewhereSourceDb: 'DATA_TP1U2_OCT',
  newerElsewhereLabel: 'October copy - cones',
  newerElsewhereSimulator: false,
};

describe('RT-007 RED — the banner must never call simulator figures real', () => {
  it('discloses that the figures on screen are the simulator\'s when the ACTIVE generation is', () => {
    const s = quietBecauseGeneration(MINE_IS_SIMULATOR, '9:00 AM', null)!;
    // The old sentence only ever said "simulator" about the EXCLUDED
    // generation (newerElsewhereSimulator). It never inspected its own
    // `mine`'s `simulator` flag, so this failed before the fix.
    expect(s).toMatch(/figures? (here|on screen) (is|are)( the)? (the )?plant simulator/i);
  });

  it('does not let the reader conclude the displayed data is real merely because the excluded rows were named synthetic', () => {
    const s = quietBecauseGeneration(MINE_IS_SIMULATOR, '9:00 AM', null)!;
    // Old text: "...Those readings are the plant simulator's... They are
    // left out..." — true of the EXCLUDED rows, silent about `mine`, and so
    // false by omission about what is actually on screen. The fixed
    // sentence must say, before it ever names `mine`'s own label, that
    // what's on screen is the simulator's — never let the label alone stand
    // unqualified as the reader's first impression of it.
    // Since 25 Sep 2026 the sentence names no data-set label at all (owner:
    // no jargon on Line), so the misleading label can never lead. The
    // disclosure must still come FIRST, before the reading is described.
    expect(s).not.toContain('September copy - cones');
    expect(s.toLowerCase().indexOf('plant simulator')).toBe(s.toLowerCase().indexOf('figures here are the plant simulator') + 'figures here are the '.length);
    expect(s.toLowerCase().indexOf('plant simulator')).toBeLessThan(s.toLowerCase().indexOf('newest reading'));
  });

  it('the short form (Wall footer) carries the same disclosure, not just the long one', () => {
    const s = quietBecauseGenerationShort(MINE_IS_SIMULATOR, '9:00 AM')!;
    expect(s).toMatch(/simulator/i);
  });
});

describe('RT-007 proof, both directions — claim and payload cannot disagree', () => {
  it('SIMULATOR-only: mine is flagged simulator, theirs is real — the claim must say MINE is synthetic', () => {
    const mineSimOnly: LiveGenerationNote = { ...MINE_IS_SIMULATOR, newerElsewhereSimulator: false, newerElsewhereLabel: 'October copy - cones', newerElsewhereSourceDb: 'DATA_TP1U2_OCT' };
    const s = quietBecauseGeneration(mineSimOnly, '9:00 AM', null)!;
    expect(s).toMatch(/simulator/i);
    expect(s).not.toMatch(/newer simulator readings/i);
    // And it must NOT ALSO claim the real, newer generation is synthetic —
    // that specific clause ("Those readings are the plant simulator's")
    // exists only for `theirs`, and `theirs` here is real.
    expect(s).not.toContain('Those readings are the plant simulator');
    expect(s).toContain('different data set');
  });

  it('REAL-only: neither side is the simulator — the sentence never says the word', () => {
    const s = quietBecauseGeneration(BOTH_REAL, '12:00 PM, 7 Sep', '24 days')!;
    expect(s).not.toMatch(/simulator/i);
    expect(s).toContain('Newest plant reading: 12:00 PM, 7 Sep (24 days old).');
  });
});

/* ------------------------------------------------ rendered, via LineScreen */

const liveWith = (g: LiveGenerationNote): Envelope<LiveData> => ({
  ...LIVE_FIXTURE,
  data: { lines: [{ ...LIVE_FIXTURE.data.lines[0]!, generation: g }] },
});

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

describe('RT-007 rendered — LineScreen', () => {
  it('the on-screen banner discloses the active generation is the simulator\'s', async () => {
    installFakeFetch(lineRoutes(MINE_IS_SIMULATOR));
    const { findByText } = renderWithLive(
      <LineScreen
        period={PERIOD}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenReading={() => {}}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );
    await findByText(/plant simulator/i);
  });
});
