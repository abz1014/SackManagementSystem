/**
 * Plain-language sentences for the global "simulated data" banner (Task D,
 * 28 Sep 2026) — the owner's decision: every screen shows a clear notice
 * whenever the FIGURES IT SHOWS come from the plant simulator
 * (`sms/scripts/simulate-plant.mjs`, `DATA_TP1U2_SIM` only), never a
 * notice at IFL. It never fires at the plant, by construction: IFL's own
 * line has no `_SIM` generation for `resolveGenerationScope` to find, and
 * `preferReal` (the default everywhere except `live.ts`'s dev-only policy)
 * keeps a real generation in force whenever one exists at all.
 *
 * KEPT OUT OF `words.ts` FOR MERGE SAFETY, not by design preference — see
 * `lib/generationWords.ts`'s own file header for the identical reasoning
 * (another worker holds `words.ts` open this pass). Fold this module into
 * `words.ts` once that file is free, the same note that file carries.
 *
 * TWO INDEPENDENT QUESTIONS, one sentence. "Live" is what the Line/Health/
 * Product-Running screens assert about the line RIGHT NOW — driven by
 * `live.ts`'s `resolveLiveScope`, which is the only place the dev-only
 * `LIVE_ALLOW_SIMULATOR` policy can ever choose the simulator's generation
 * over a real one. "Period" is what a chosen date range's figures are drawn
 * from (Line/Readings/Weight/Rejects/Sacks/Report) — resolved the ordinary
 * way, `resolveGenerationScope`'s ever-true `preferReal: true` default,
 * exposed over `GET /api/data-batch`. The two can disagree (the simulator is
 * newer than IFL's last real generation on the dev sidecar, so "now" reads
 * as simulated while a real-only historical period does not) — hence four
 * sentences, not two.
 */

export const simulatorBannerWords = {
  /** (a) — both halves are simulated. */
  both: 'These figures come from the plant simulator, not the plant.',
  /** (b) — live is simulated, but the chosen period is real and this view has period figures. */
  liveSimulatedPeriodReal:
    "The live line status comes from the plant simulator. This period's figures are IFL's own recorded data.",
  /** (c) — live is simulated and this view has no period figures (or the period could not be read). */
  liveSimulatedOnly: 'The live line status comes from the plant simulator, not the plant.',
  /** (d) — only the chosen period is simulated; live is real or not shown here. */
  periodSimulatedOnly: "This period's figures come from the plant simulator, not the plant.",
};

/** The wall board's own short form — one clause, fits the pinned footer line. */
export const wallSimulatorNote = 'this board is showing the plant simulator, not the plant';

export interface SimulatorBannerFlags {
  /** Whether this VIEW shows live figures (Line/Health/Product › Running) and, of those, whether they are the simulator's. */
  liveSimulator: boolean;
  /**
   * Whether the chosen period's figures are the simulator's — `undefined`
   * when this view has no period figures at all, OR when `/api/data-batch`
   * could not be read (a failed fetch must never be treated as "real" — see
   * this module's own reasoning above and `SimulatorBanner.tsx`).
   */
  periodSimulator: boolean | undefined;
  /** Whether this view shows period figures at all (independent of whether the fetch that would answer `periodSimulator` succeeded). */
  hasPeriodFigures: boolean;
}

/** Pick the one sentence to print, or null when nothing here is simulated (or nothing is known to be). */
export function simulatorBannerSentence(flags: SimulatorBannerFlags): string | null {
  const { liveSimulator, periodSimulator, hasPeriodFigures } = flags;
  const periodKnownSimulated = hasPeriodFigures && periodSimulator === true;
  const periodKnownReal = hasPeriodFigures && periodSimulator === false;

  if (liveSimulator && periodKnownSimulated) return simulatorBannerWords.both;
  if (liveSimulator && periodKnownReal) return simulatorBannerWords.liveSimulatedPeriodReal;
  if (liveSimulator) return simulatorBannerWords.liveSimulatedOnly;
  if (periodKnownSimulated) return simulatorBannerWords.periodSimulatedOnly;
  return null;
}
