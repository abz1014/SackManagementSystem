/**
 * RT-006 (23 Sep 2026 red-team audit) — a zero-row acquisition-lag sample
 * must never render as a stopped line.
 *
 * The condition that produces a zero-row lag sample is `sms epoch:accept`
 * opening a new generation — literally IFL's installation day. Before this
 * fix, `classifyHealth` fell through a null `ingestLagSeconds` to `'ok'`,
 * the line-state arithmetic then defaulted the lag to 0 (`live.ts`'s
 * `classifyLineState`, `lagMs = Math.min(ingestLagSeconds ?? 0, …)`), and a
 * perfectly running line — whose newest reading merely sits within the
 * (unmeasured) acquisition delay of the wall clock — was judged against the
 * clock with NO lag correction and printed "⟨line⟩ has been stopped for
 * N min" in alarm styling.
 *
 * This is a two-sided assertion, the rule this repo settled on in
 * `generationQuiet.test.tsx`: proving the unknown sentence appears is not
 * enough — a screen that printed it unconditionally would pass that alone.
 * The fixture below sets `state.status: 'stopped'` with a real
 * `behindSeconds`, exactly what the arithmetic would still compute (the
 * server-side state machine does not know why the lag is unmeasured, only
 * that it is) — proving that even when the pre-lag-correction arithmetic
 * says "stopped", the rendered sentence never uses that word once health is
 * `lag_unknown`, because `Line.tsx`'s `Headline` gates on
 * `stateIsKnowable(health)` (`web/src/lib/health.ts`), which this fix makes
 * false for `lag_unknown` the same way it already was for `stale`/`late`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from './testkit/fetchRouter';
import { renderWithLive } from './testkit/render';
import { LIVE_FIXTURE } from './testkit/fixtures';
import { LineScreen } from './screens/Line';
import { W } from './lib/words';
import { stateIsKnowable, assessHealth } from './lib/health';
import type { Envelope, LiveData } from './api';

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

const EMPTY_PRODUCTION = {
  data: { rows: [], unattributed: null, states: null, implausible: null },
  metadata: LIVE_FIXTURE.metadata,
};

/**
 * The RT-006 fixture: a reading exists, `health.kind` is `lag_unknown` (the
 * zero-row lag sample), and — deliberately, to make this a real regression
 * test rather than a tautology — `state.status` is `'stopped'` with a
 * non-zero `behindSeconds`, the exact shape the pre-fix arithmetic produced
 * right before the bad headline was printed.
 */
const LAG_UNKNOWN_LIVE: Envelope<LiveData> = {
  ...LIVE_FIXTURE,
  data: {
    lines: [
      {
        ...LIVE_FIXTURE.data.lines[0]!,
        ingestLagSeconds: null,
        health: {
          kind: 'lag_unknown',
          ageSeconds: 30,
          oldestTable: 'cone_raw',
          cadenceSeconds: 60,
          staleAfterSeconds: 180,
          lagCeilingSeconds: 1800,
        },
        state: {
          status: 'stopped',
          sinceLastReadingSeconds: 240,
          behindSeconds: 240,
          runStartUtc: null,
          stopThresholdSeconds: 120,
        },
      },
    ],
  },
};

const routes = {
  '/api/live': LAG_UNKNOWN_LIVE,
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
    data: { asOfUtc: null, windowMs: 7_200_000, windowStartUtc: null, machines: [], materialsRunning: 0, generation: LIVE_FIXTURE.data.lines[0]!.generation },
    metadata: LIVE_FIXTURE.metadata,
  },
};

describe('lib/health.ts — the pure contract behind the render', () => {
  it('stateIsKnowable is false for lag_unknown, the same as stale/late/none', () => {
    const health = assessHealth(LAG_UNKNOWN_LIVE.data.lines[0]!);
    expect(health.kind).toBe('lag_unknown');
    expect(stateIsKnowable(health)).toBe(false);
  });
});

describe('Line — RT-006: a null-measured lag never renders as "stopped"', () => {
  it('prints the unknown-state sentence, not the stopped one, even though state.status is stopped', async () => {
    installFakeFetch(routes);
    const { findByText, queryByText, container } = renderWithLive(
      <LineScreen
        period={PERIOD}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenReading={() => {}}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );

    // The rendered sentence itself — W.state.unknown is
    // 'Cannot tell whether the line is running', exactly the wording the
    // audit brief asked for.
    await findByText(W.state.unknown);

    // The two-sided half: the ALARM sentence — "⟨line⟩ has had no readings
    // for N min — the line, or the plant's data recorder, may have stopped"
    // (`W.state.stopped`, reworded for F-04, `Line.tsx`'s Headline
    // `case 'stopped'`) — is unreachable from this state, even though a
    // generic explanatory mention of the word "stopped" legitimately
    // survives elsewhere on the page (the Details disclosure: "It reads as
    // stopped once that gap exceeds …", present regardless of state). So
    // this checks for the SPECIFIC phrase the headline would have printed,
    // not the bare word.
    expect(container.textContent ?? '').not.toMatch(/may have stopped/i);
    expect(queryByText(/may have stopped/i)).toBeNull();
  });
});
