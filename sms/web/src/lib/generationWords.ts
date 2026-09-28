/**
 * The sentences a screen prints when it has gone quiet because the source
 * generation it reads has ended.
 *
 * WHY THESE STRINGS ARE HERE AND NOT IN `words.ts`. They belong in `words.ts`
 * with every other piece of UI copy — that file exists so an Urdu set can be
 * added without touching a screen, and this is not an exception to that. It is
 * a merge-safety measure and nothing more: on 23 Sep 2026 `words.ts` was open
 * and uncommitted in a parallel worker's tree, and committing it by pathspec
 * would have swept their work into this commit's message, which is the exact
 * accident that produced `8673ffd`. **Fold this module into `words.ts` once
 * that file is free.** Until then it has the same property that matters: every
 * string in one place, none inline in a screen.
 *
 * WHAT THEY ARE FOR (D-11, owner's decision 23 Sep 2026). The live screens
 * read ONE source generation — the newest real one — so no figure is a total
 * across two physically different tables. The accepted cost is that the
 * generation can END while rows keep arriving under another one. When that
 * happens Line, Wall and Health must say so. A board that prints "stopped"
 * when what it means is "the data I trust ended two weeks ago" is the same
 * over-claim `fc0e3c3` removed from the Wall, wearing a different hat.
 *
 * NOTHING HERE SUBSTITUTES A GUESS FOR A FACT. Every sentence is composed
 * from what the server measured: the generation's own label or source
 * database, the instant of the newest reading outside it, and whether that
 * reading is synthetic. When the server did not state a generation, these
 * return null and the screen prints nothing rather than something vague.
 */
import type { LiveGenerationNote } from '../api';

/** The generation's own name, as a person should read it. */
export function generationName(g: LiveGenerationNote['generation']): string | null {
  if (!g) return null;
  return g.label ?? g.sourceDb ?? `data batch ${g.ordinal}`;
}

/**
 * True when the screen is quiet for THIS reason — there is a reading newer
 * than anything the chosen generation holds. False is the ordinary case, and
 * means no sentence below should be printed.
 */
export function hasNewerElsewhere(n: LiveGenerationNote | null | undefined): boolean {
  return n != null && n.newerElsewhereUtc != null;
}

/**
 * True when the generation CURRENTLY DRIVING THE SCREEN — `mine`, not
 * whatever else the payload names — is itself the simulator's.
 *
 * RT-007 (red-team audit, 23 Sep 2026): the live sidecar's epochs 13-16 are
 * the plant simulator's rows, mislabelled `provenance: 'ifl_copy'` and left
 * that way on purpose as a regression fixture. `isSimulator()`
 * (`api/src/services/generation.ts`) still catches them, by `source_db`, so
 * `generationNote.generation.simulator` already carries the truth — this
 * reads exactly that flag, never the label, so a mislabelled generation can
 * never read here as real.
 */
export function currentIsSimulator(n: LiveGenerationNote | null | undefined): boolean {
  return n?.generation?.simulator === true;
}

/**
 * The reason, in plain words, for a Line screen that has stopped moving.
 *
 * Owner complaint (25 Sep 2026): the old paragraph ("one source generation —
 * September copy — cones … pack1_TP1U2 gen 4 … row identities start again at
 * 1") was written for an engineer debugging the sidecar, not a plant manager.
 * It also printed the newest reading as a bare time ("12:00 PM") that hid the
 * fact it was 18 days old. Now: one sentence of fact (newest reading, WITH
 * its date when not today, and its age), one of what is left out. The
 * technical detail (which data set, how many rows) lives on Health, behind
 * the bar's "details" link — `healthExcludedLine` below.
 *
 * `newestWhen` is already formatted by the caller (plant clock, date included
 * when it is not the plant's today); `age` is a length of time or null. This
 * module never formats a time — see `lib/plantClock.ts`.
 *
 * Never says the line is stopped or running (the headline already says it
 * cannot tell). RT-007 still holds: whether the figures ON SCREEN are the
 * simulator's is read from `mine`'s own flag, whether the LEFT-OUT ones are
 * from `theirs`'s, and the two claims are made separately.
 */
export function quietBecauseGeneration(
  n: LiveGenerationNote,
  newestWhen: string,
  age: string | null,
): string | null {
  if (n.newerElsewhereUtc == null) return null;
  const ageText = age ? ` (${age} old)` : '';
  const first = currentIsSimulator(n)
    ? `Figures here are the plant simulator’s, not the plant’s; newest reading: ${newestWhen}${ageText}.`
    : `Newest plant reading: ${newestWhen}${ageText}.`;
  const second =
    n.newerElsewhereSimulator === true
      ? 'Newer simulator readings are not counted.'
      : 'Newer readings from a different data set are not counted.';
  return `${first} ${second}`;
}

/** The short form, for the Wall footer and anywhere a full sentence will not fit. */
export function quietBecauseGenerationShort(n: LiveGenerationNote, newestClock: string): string | null {
  if (n.newerElsewhereUtc == null) return null;
  if (currentIsSimulator(n)) {
    return `Simulator readings, not the plant’s — newest ${newestClock}; newer readings not counted`;
  }
  return `Newest plant reading ${newestClock}; newer readings from a different data set not counted`;
}

/** What Health says about the generation it measured freshness and lag from. */
export function healthGenerationLine(n: LiveGenerationNote): string | null {
  const mine = generationName(n.generation);
  if (!mine) return null;
  return `Freshness, the acquisition lag and the newest reading above are all measured from ${mine}, one batch of recorded data.`;
}

/** What Health says about the rows it did NOT measure. Null when there are none. */
export function healthExcludedLine(n: LiveGenerationNote, newerClock: string | null): string | null {
  if (!n.spansGenerations) return null;
  const theirs = n.newerElsewhereLabel ?? n.newerElsewhereSourceDb ?? 'another batch of recorded data';
  const rows = n.otherGenerationExcluded;
  const newer =
    newerClock == null
      ? ''
      : ` The newest reading outside it is ${newerClock}, in ${theirs} — so a quiet Line or Wall screen means that batch has ended, not that the plant has.`;
  return (
    `${rows.toLocaleString()} reading${rows === 1 ? '' : 's'} on record belong to a different batch and were not ` +
    `measured here.${newer}`
  );
}

/** What the machine grid says about the window it is a window INTO. */
export function machineGridGenerationLine(n: LiveGenerationNote, newerClock: string | null): string | null {
  const mine = generationName(n.generation);
  if (!mine) return null;
  if (newerClock == null) return `Read from ${mine}, one data batch.`;
  return (
    `Read from ${mine}, one data batch. Its readings end here; newer readings to ${newerClock} belong to ` +
    `another data batch and would put two tables' machines in one grid, so they are not shown.`
  );
}
