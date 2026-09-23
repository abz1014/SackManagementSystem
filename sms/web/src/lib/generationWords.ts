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
  return g.label ?? g.sourceDb ?? `generation ${g.ordinal}`;
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
 * The reason, in one sentence, for a screen that has stopped moving.
 *
 * `newestClock` and `newerClock` are already formatted by the caller with the
 * screen's own clock formatter — this module never formats a time, because
 * the plant clock conversion lives in `lib/plantClock.ts` and must not be
 * done twice.
 */
export function quietBecauseGeneration(
  n: LiveGenerationNote,
  newestClock: string,
  newerClock: string,
): string | null {
  if (n.newerElsewhereUtc == null) return null;
  const mine = generationName(n.generation) ?? 'the source generation in use';
  const theirs =
    n.newerElsewhereLabel ?? n.newerElsewhereSourceDb ?? 'another source generation';
  const synthetic = n.newerElsewhereSimulator ? ' Those readings are the plant simulator’s, not the plant’s.' : '';
  return (
    `This is not a stopped line. Every figure here is read from one source generation — ${mine} — ` +
    `whose newest reading is ${newestClock}. There are newer readings, to ${newerClock}, ` +
    `but they belong to ${theirs}: a physically different set of tables, whose row identities start again at 1.` +
    `${synthetic} They are left out rather than added to these totals, which would make every figure a sum ` +
    `across two tables.`
  );
}

/** The short form, for the Wall footer and anywhere a full sentence will not fit. */
export function quietBecauseGenerationShort(n: LiveGenerationNote, newestClock: string): string | null {
  if (n.newerElsewhereUtc == null) return null;
  const mine = generationName(n.generation) ?? 'one source generation';
  return `Not a stopped line — readings end ${newestClock} in ${mine}; newer rows are another generation's and are not shown`;
}

/** What Health says about the generation it measured freshness and lag from. */
export function healthGenerationLine(n: LiveGenerationNote): string | null {
  const mine = generationName(n.generation);
  if (!mine) return null;
  return `Freshness, the acquisition lag and the newest reading above are all measured from ${mine}, one source generation.`;
}

/** What Health says about the rows it did NOT measure. Null when there are none. */
export function healthExcludedLine(n: LiveGenerationNote, newerClock: string | null): string | null {
  if (!n.spansGenerations) return null;
  const theirs = n.newerElsewhereLabel ?? n.newerElsewhereSourceDb ?? 'another source generation';
  const rows = n.otherGenerationExcluded;
  const newer =
    newerClock == null
      ? ''
      : ` The newest reading outside it is ${newerClock}, in ${theirs} — so a quiet Line or Wall screen means that generation has ended, not that the plant has.`;
  return (
    `${rows.toLocaleString()} reading${rows === 1 ? '' : 's'} on record belong to a different generation and were not ` +
    `measured here.${newer}`
  );
}

/** What the machine grid says about the window it is a window INTO. */
export function machineGridGenerationLine(n: LiveGenerationNote, newerClock: string | null): string | null {
  const mine = generationName(n.generation);
  if (!mine) return null;
  if (newerClock == null) return `Read from ${mine}, one source generation.`;
  return (
    `Read from ${mine}, one source generation. Its readings end here; newer readings to ${newerClock} belong to ` +
    `another generation and would put two tables' machines in one grid, so they are not shown.`
  );
}
