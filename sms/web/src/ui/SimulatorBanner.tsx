/**
 * The global "simulated data" banner (Task D, 28 Sep 2026). One instance,
 * mounted in `App.tsx` beside the replay banner — not per-screen — so it
 * has one place to decide what a screen shows rather than six copies that
 * can drift. It answers two independent questions and prints at most one
 * sentence (`lib/simulatorWords.ts`'s `simulatorBannerSentence`):
 *
 *   LIVE   — is the figure Line/Health/Product-Running assert about the
 *            line RIGHT NOW drawn from the plant simulator's generation
 *            (`useLive()`'s `line.generation.generation.simulator`, the
 *            same field `Line.tsx`'s own provenance banner reads)?
 *   PERIOD — is the chosen date range's data drawn from the simulator's
 *            generation (`GET /api/data-batch`, this file's own poll)?
 *
 * NEVER FIRES AT IFL. Both questions bottom out in
 * `resolveGenerationScope`'s `simulator` flag, which is false for every
 * generation IFL's own line has ever produced — the simulator writes only
 * to `DATA_TP1U2_SIM`. An IFL-shaped payload renders nothing here, by
 * construction, not by a special case in this file.
 *
 * A FAILED /api/data-batch FETCH MUST NOT CLAIM "REAL". Per the reliability
 * rule this project has enforced since UX Phase 7
 * (`web/src/reliability.guard.test.ts`), a poll's `.error` is read here (and
 * logged) rather than silently falling through to whichever branch a
 * missing/undefined value happens to hit — `periodSimulator` stays
 * `undefined` on a failed fetch, which `simulatorBannerSentence` treats as
 * "say nothing about the period", never as "the period is real".
 */
import { useEffect, useRef } from 'react';
import { useLive, usePolling, LIVE_POLL_MS } from '../lib/live';
import { getDataBatch, type DataBatchData } from '../api';
import { currentIsSimulator } from '../lib/generationWords';
import { simulatorBannerSentence } from '../lib/simulatorWords';
import type { Screen, ProductTab } from './Bar';

/** Screens whose figures are about a CHOSEN PERIOD. */
const PERIOD_VIEWS: ReadonlySet<string> = new Set(['line', 'readings', 'weight', 'rejects', 'sacks', 'report']);
/** Screens whose figures are about the line RIGHT NOW, outside Product's own tab check below. */
const LIVE_VIEWS: ReadonlySet<string> = new Set(['line', 'health']);

export function SimulatorBanner({
  view,
  productTab,
  from,
  to,
}: {
  /** `route.view` — includes 'setup'/'wall', neither of which ever shows this banner. */
  view: Screen | 'setup' | 'wall';
  /** `route.productTab` — only read when `view === 'product'`. */
  productTab: ProductTab;
  /** The globally-chosen period, `Period.from`/`Period.to` (App.tsx). */
  from: string;
  to: string;
}) {
  const { line } = useLive();

  const hasPeriodFigures = PERIOD_VIEWS.has(view);
  const hasLiveFigures = LIVE_VIEWS.has(view) || (view === 'product' && productTab === 'running');

  // Fetch only when this view actually shows period figures — the promise
  // resolves immediately with no network call otherwise, which still needs
  // `usePolling` to be called unconditionally (React hook rule) but costs
  // nothing on Setup, Health, or Product's other three tabs.
  const period = usePolling<DataBatchData | null>(
    () => (hasPeriodFigures ? getDataBatch(from, to).then((e) => e.data) : Promise.resolve(null)),
    LIVE_POLL_MS,
    `simulator-banner:${hasPeriodFigures}:${from}:${to}`,
  );
  // Log at most once per outage, not once per render while the poll's own
  // backoff (see `usePolling` in `lib/live.tsx`) keeps retrying underneath —
  // this component re-renders on every context/prop change, and logging the
  // raw `.error` unconditionally on every render turned a single outage into
  // a burst of duplicate lines (Task, 29 Sep 2026: 9 open tabs × a few
  // seconds of an API restart produced 24 error lines for one real event).
  // `.error` is still read and still drives the UI exactly as before; only
  // the console-logging cadence changes here.
  const wasErrorRef = useRef(false);
  useEffect(() => {
    if (period.error && !wasErrorRef.current) {
      wasErrorRef.current = true;
      // eslint-disable-next-line no-console -- read per reliability.guard's own rule; no UI claim follows from this.
      console.warn('SimulatorBanner: GET /api/data-batch failing:', period.error);
    } else if (!period.error && wasErrorRef.current) {
      wasErrorRef.current = false;
      // eslint-disable-next-line no-console -- recovery notice, not an error.
      console.warn('SimulatorBanner: GET /api/data-batch recovered');
    }
  }, [period.error]);

  const liveSimulator = hasLiveFigures && currentIsSimulator(line?.generation ?? null);
  const periodSimulator: boolean | undefined = hasPeriodFigures
    ? period.data
      ? period.data.batches.some((b) => b.simulator)
      : undefined
    : undefined;

  const sentence = simulatorBannerSentence({ liveSimulator, periodSimulator, hasPeriodFigures });
  if (!sentence) return null;

  return (
    <div className="simulator-banner no-print" role="status">
      <span>{sentence}</span>
    </div>
  );
}
