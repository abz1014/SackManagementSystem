/**
 * Guard against the two classes of defect UX Phase 7 fixed (`git show
 * 1d32f02`, `git show 8611d2b`) coming back:
 *
 * GUARD 1 — a failed poll rendering as an empty or zero answer. The worst
 * instance was Health's SyncHealthBlock declaring `ops = usePolling(...)`
 * and never once reading `ops.error`: a failed /api/operations printed
 * blocking findings as "None" and the DQ/per-table disclosures as empty
 * tables reading "no findings" — the one block whose job is to report
 * breakage instead reported "all clear" on evidence it did not have. Brief 1
 * fixed six more instances of the identical shape across Weight, Readings,
 * Product > Running, Wall, Report and Sacks. Nothing stopped any of them
 * being undone, or a new screen introducing the same shape fresh — that is
 * this guard's job.
 *
 * GUARD 2 (Part A; Part B lives in api/src/app.rbac.test.ts) — ONE AUDIENCE
 * (CLAUDE.md: every screen is open to every signed-in account; roles gate
 * WRITES only). Phase 6 found /api/reconciliation shipped at requireRole(3)
 * in violation of this, and the owner approved lowering it to rank 1. This
 * guard locks the CLIENT side of that rule: the exact set of `rank >= N`
 * read-tier gates in App.tsx must not grow without a reviewed change to this
 * file's expected list.
 *
 * Deliberately dumb, in api.callers.test.ts's and targets.guard.test.ts's own
 * idiom: reads source files off disk with node:fs and greps them — no
 * imports of the real modules, no DOM (vitest.config.ts's `environment:
 * 'node'`, `.ts` only). A violation found here is not automatically a bug —
 * see ALLOW_LIST — but every entry must be a written, evidenced decision,
 * never a silent hole added just to make the guard pass.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');

const WEB_SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/'); // .../sms/web/src/
const SCREENS_DIR = `${WEB_SRC}screens`;
const REPO_ROOT = toPosix(fileURLToPath(new URL('../..', import.meta.url))).replace(/\/*$/, '/'); // .../sms/
const relPath = (f: string) => toPosix(f).replace(REPO_ROOT, '').replace(/\/{2,}/g, '/');

/**
 * UX Phase 8 Brief A (21 Sep 2026): skips `*.test.ts(x)` files and the
 * `testkit/` directory. Before this, a `.tsx?` glob with no exclusion would
 * scan a new component test (e.g. `Readings.test.tsx`, added by this same
 * brief's harness work) as if it were a SCREEN — GUARD 1 below looks for
 * `usePolling()` declarations specifically under `screens/`, so a stray test
 * file placed there would be read for polling calls it does not make and,
 * worse, `testkit/render.tsx`'s own `renderApp` mounts `usePolling` deep
 * inside `<App/>` textually (via its `import { App } from '../App'`), which
 * is exactly the kind of incidental match this scan must never attribute to
 * a screen. Neither exclusion weakens an existing assertion: every current
 * `expect` in this file (and its threshold) is untouched.
 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = toPosix(`${dir}/${entry}`);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'testkit') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/* =================================================================== *
 * GUARD 1 — every usePolling() result's .error must be read, or listed *
 * =================================================================== */

/** `const NAME = usePolling(` — the declaration line only; the call itself
 *  may span many lines below, which is irrelevant here since the check is
 *  "does NAME.error appear anywhere in this file", not on this one line. */
const USE_POLLING_DECL_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*usePolling\(/g;

interface PollingUse { file: string; rel: string; varName: string }

function listPollingUses(): PollingUse[] {
  const uses: PollingUse[] = [];
  for (const file of listSourceFiles(SCREENS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(USE_POLLING_DECL_RE)) {
      uses.push({ file, rel: relPath(file), varName: m[1]! });
    }
  }
  return uses;
}

/**
 * Written exceptions, genuinely cosmetic — each checked against the
 * evidence named below, not added to silence a failure. A failure here
 * degrades to an OMISSION (a label falls back to a number, an optional
 * attribution line disappears) — never a printed fact that could be wrong.
 * Keyed by `${path relative to sms/}:${varName}`.
 */
const ALLOW_LIST: Record<string, string> = {
  'web/src/screens/product/Running.tsx:names':
    'station labels only (ByProduct/LineWideProduct fall back to numeric station labels — names.data?.stations ?? []) — degrades ' +
    'silently to a numeric label, never a false fact about production. Matches Weight.tsx:names below.',
  'web/src/screens/Weight.tsx:names':
    'station labels only, same getStations() call as Running.tsx above — StationSheet-style chart legends fall back to numeric ' +
    'labels on failure, never a false weight/reject fact.',
  'web/src/screens/product/Running.tsx:current':
    "who set the running product and why (getCurrentProduct). On failure `current.data` is undefined, so `setBy` " +
    '(Running.tsx:64-67) resolves to null, and the consuming LineWideProduct renders the whole "Set by" line only ' +
    'when `setBy` is truthy (`{setBy && (...)}`, Running.tsx:144) — a failure here degrades to the attribution line ' +
    'being silently OMITTED, identical in shape to the legitimate case where the period product differs from the ' +
    "currently-running one (the same code comment above `current`'s declaration). It never prints a wrong number or " +
    'a false state; checked 21 Sep 2026.',
};

/**
 * Reserved for a genuine, unfixed instance of the exact defect GUARD 1 exists
 * to catch, found but deliberately not fixed by whichever brief found it (see
 * ALLOW_LIST above for cases proven cosmetic instead — this map is not that).
 *
 * UX Phase 7 Brief 4 (21 Sep 2026) found and recorded exactly one entry here:
 * `web/src/screens/Weight.tsx:prod` (getProduction — the "rejected by the
 * scale" figure tile had no `.error` read anywhere in the file, so a failed
 * fetch printed the same em-dash as a genuinely empty period). UX Phase 7
 * Brief 5 (21 Sep 2026) fixed it — the tile now shows its own `<Failed
 * onRetry/>` (Weight.tsx's second figure `<div>`, guarded on `prod.error &&
 * !prod.data`) — and, per this canary's own instruction, deletes the entry
 * rather than leaving it to rot. The map stays declared, empty, for the next
 * genuine finding.
 */
const KNOWN_DEFECTS: Record<string, string> = {};

describe('GUARD 1 — every usePolling() error is read, surfaced, or a written exception', () => {
  const uses = listPollingUses();

  it('sanity: the scan actually found usePolling() declarations (canary on the scan itself)', () => {
    expect(uses.length).toBeGreaterThan(20);
  });

  it('every usePolling() result has its .error read in the same file, or a written ALLOW_LIST/KNOWN_DEFECTS entry', () => {
    const violations: string[] = [];
    for (const use of uses) {
      const src = readFileSync(use.file, 'utf8');
      const errorRe = new RegExp(`\\b${use.varName}\\.error\\b`);
      if (errorRe.test(src)) continue;
      const key = `${use.rel}:${use.varName}`;
      if (ALLOW_LIST[key] !== undefined) continue;
      if (KNOWN_DEFECTS[key] !== undefined) continue; // tracked separately below, not hidden — see its own canary test
      violations.push(key);
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these usePolling() results have no \`.error\` read anywhere in their file, and no ALLOW_LIST/KNOWN_DEFECTS ` +
            `entry: ${violations.join(', ')}. A failed fetch here will fall through to the same branch as a genuinely ` +
            `empty/zero answer — the exact defect UX Phase 7 fixed (git show 1d32f02, git show 8611d2b). Either ` +
            `read the .error (see Weight.tsx's coneLine, or health/SyncHealthBlock.tsx's ops, for the pattern), or ` +
            `add a reviewed ALLOW_LIST['<path>:<var>'] entry naming why the failure is genuinely cosmetic, or (if it ` +
            `is a genuine bug you are not fixing here) a KNOWN_DEFECTS['<path>:<var>'] entry naming the evidence.`,
    ).toEqual([]);
  });

  it('ALLOW_LIST names only usePolling() declarations that still exist and still lack an .error read', () => {
    const stale: string[] = [];
    for (const key of Object.keys(ALLOW_LIST)) {
      const [rel, varName] = key.split(':');
      const use = uses.find((u) => u.rel === rel && u.varName === varName);
      if (!use) { stale.push(`${key} (no such usePolling() declaration found)`); continue; }
      const src = readFileSync(use.file, 'utf8');
      const errorRe = new RegExp(`\\b${varName}\\.error\\b`);
      if (errorRe.test(src)) stale.push(`${key} (now HAS an .error read — the gap is closed, remove this entry)`);
    }
    expect(stale, `ALLOW_LIST entries that no longer match reality (fix or remove them): ${stale.join(', ')}`).toEqual([]);
  });

  it('KNOWN_DEFECTS names only usePolling() declarations that STILL genuinely lack an .error read (delete the entry once fixed)', () => {
    const stale: string[] = [];
    for (const key of Object.keys(KNOWN_DEFECTS)) {
      const [rel, varName] = key.split(':');
      const use = uses.find((u) => u.rel === rel && u.varName === varName);
      if (!use) { stale.push(`${key} (no such usePolling() declaration found — was it removed/renamed?)`); continue; }
      const src = readFileSync(use.file, 'utf8');
      const errorRe = new RegExp(`\\b${varName}\\.error\\b`);
      if (errorRe.test(src)) stale.push(`${key} (now HAS an .error read — the bug is fixed, delete this KNOWN_DEFECTS entry)`);
    }
    expect(stale, `KNOWN_DEFECTS entries that no longer match reality: ${stale.join(', ')}`).toEqual([]);
  });
});

/* =================================================================== *
 * GUARD 1B — reading .error is not the whole rule; two DIFFERENT polls' *
 * failures must not be folded into one blanket message.                 *
 * =================================================================== *
 *
 * UX Phase 7 Brief 5 (21 Sep 2026), extending GUARD 1 per the owner's own
 * principle (21 Sep 2026): "Where several fetches feed one statement, a
 * failure in one must not collapse into a blanket 'couldn't load'. Say
 * which part is missing, and keep asserting the parts still known." GUARD 1
 * only checks that a poll's `.error` is READ somewhere in its file — it
 * would pass happily on `error={a.error ?? b.error}`, which reads both
 * `.error`s and then throws the distinction between them away in the exact
 * shape the owner's principle forbids: "the plant link is down" printed for
 * a failure that was actually only ONE of the two things feeding that
 * sentence.
 *
 * THE CHECK: find every `error={X.error ?? Y.error}` / `error={X.error ||
 * Y.error}` — two DIFFERENT usePolling() variable names OR-combined inside
 * one `error={...}` prop passed to <Failed>, i.e. exactly the shape that
 * lets one poll's failure silently stand in for another's. A pair found
 * this way must have a written ALLOW_LIST_JOINT entry naming why the two
 * calls genuinely feed one INDIVISIBLE block (there is no partial content
 * to keep, so naming which one failed would not help the reader) — verified
 * by reading each site, not assumed. Two real, pre-existing instances of
 * this shape were found while writing this guard (Line.tsx, Rejects.tsx —
 * neither is this brief's file to change) and are seeded below.
 *
 * WHAT THIS CANNOT CATCH, stated plainly rather than left to look like it
 * does — this is a narrow, mechanical lint on one specific source shape, not
 * a semantic proof that every screen makes the distinction the owner asked
 * for:
 *  - A collapse written any other way than a literal `??`/`||` between two
 *    `.error` reads inside one `error={...}` prop — e.g. `const anyError =
 *    a.error || b.error;` assigned first and referenced later, or an
 *    equivalent `if (a.error || b.error) return <Failed .../>` — is
 *    invisible to this regex. This file's own stated idiom (node:fs + grep,
 *    no imports, no DOM, no AST) cannot evaluate JavaScript to see through
 *    an indirection like that; only the literal textual shape is checked.
 *  - A SINGLE poll's error rendered with a wrong or misleading message —
 *    this guard only ever looks at whether a message is shared across TWO
 *    DIFFERENT pollers, never at whether one poller's own message is honest.
 *  - Three or more pollers combined pairwise across separate expressions in
 *    the same file (e.g. `a.error ?? b.error` in one place and `b.error ??
 *    c.error` in another) — each pair is checked independently; nothing
 *    here reasons about a chain or a third variable.
 *  - A poll's `.error` satisfying GUARD 1 (the token appears somewhere in
 *    the file) without ever reaching a rendered branch at all — GUARD 1's
 *    own blind spot, inherited here since this guard only runs on files
 *    GUARD 1 already passed.
 * In short: this closes one real, previously-unguarded gap in GUARD 1 — it
 * narrows the space where "the error is read" can still mean "the failures
 * are blurred together," it does not close that space entirely.
 */

const JOINT_ERROR_RE = /\berror=\{\s*([A-Za-z_$][\w$]*)\.error\s*(?:\?\?|\|\|)\s*([A-Za-z_$][\w$]*)\.error\s*\}/g;

interface JointErrorUse { rel: string; a: string; b: string }

function listJointErrorUses(): JointErrorUse[] {
  const out: JointErrorUse[] = [];
  for (const file of listSourceFiles(SCREENS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(JOINT_ERROR_RE)) {
      out.push({ rel: relPath(file), a: m[1]!, b: m[2]! });
    }
  }
  return out;
}

/**
 * Written, evidenced exceptions — each read at its cited location, not
 * assumed. Keyed by `${path relative to sms/}:${varA}+${varB}`, with the two
 * variable names in the order they appear in the source (the scan below
 * checks both orderings against this list, so which one is "a" and which is
 * "b" does not have to be memorised).
 */
const ALLOW_LIST_JOINT: Record<string, string> = {
  'web/src/screens/Line.tsx:stations+perStation':
    "Line.tsx:186 — the Stations grid's own error prop. `perStation` supplies per-station COUNTS and `stations` supplies the " +
    "ROSTER (names/ids) that same grid is built from (stationIds(), StationRowGrid.tsx:700-724); a roster failure and a counts " +
    'failure both leave the identical grid unbuildable — there is no partial grid to keep for either alone, unlike Line.tsx\'s ' +
    "other blocks (totals/attention/machines/product), which the file already keeps independent. Checked 21 Sep 2026.",
  'web/src/screens/Rejects.tsx:periodQ+periodW':
    'Rejects.tsx:276 — the headline figure tile. `totalRejects` is q.totalRejects + w.totalRejects (a single summed count with no ' +
    'meaningful partial reading — quality-only or weight-only rejects is not "how many cones were rejected"), so `figuresFailed` ' +
    'already gates on `(!q && periodQ.error) || (!w && periodW.error)` before this line is ever reached: the figure is ' +
    'genuinely one fact from two calls, not two facts collapsed into one. Checked 21 Sep 2026.',
  'web/src/screens/Rejects.tsx:stations+products':
    "Rejects.tsx:297 — the filter-chip row. Same shape as Weight.tsx's/Running.tsx's own ALLOW_LIST `names` entries above: a " +
    'failure here degrades the toolbar to "filters unavailable," never a wrong fact about a reject count. Checked 21 Sep 2026.',
};

describe('GUARD 1B — two different usePolling() errors are not OR-combined into one shared message', () => {
  const uses = listJointErrorUses();

  it("this file's own scan finds the pattern it is built to find (canary: Line.tsx's stations/perStation combine)", () => {
    expect(uses.some((u) => u.rel === 'web/src/screens/Line.tsx')).toBe(true);
  });

  it('every `error={A.error ?? B.error}` / `error={A.error || B.error}` pair has a written ALLOW_LIST_JOINT entry', () => {
    const violations: string[] = [];
    for (const u of uses) {
      const forward = `${u.rel}:${u.a}+${u.b}`;
      const backward = `${u.rel}:${u.b}+${u.a}`;
      if (ALLOW_LIST_JOINT[forward] !== undefined || ALLOW_LIST_JOINT[backward] !== undefined) continue;
      violations.push(forward);
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these pairs OR-combine two different usePolling() results' .error into one shared failure message, with no ` +
            `ALLOW_LIST_JOINT entry saying why the two are genuinely indivisible: ${violations.join(', ')}. Either give each ` +
            `poll its own Failed/message (see Weight.tsx's coneLine vs prod for the pattern this phase just built), or add a ` +
            `reviewed ALLOW_LIST_JOINT['<path>:<a>+<b>'] entry.`,
    ).toEqual([]);
  });

  it('ALLOW_LIST_JOINT names only pairs that still exist in the source, in either variable order', () => {
    const stale: string[] = [];
    for (const key of Object.keys(ALLOW_LIST_JOINT)) {
      const [rel, pair] = key.split(':');
      const [a, b] = pair!.split('+');
      const stillThere = uses.some((u) => u.rel === rel && ((u.a === a && u.b === b) || (u.a === b && u.b === a)));
      if (!stillThere) stale.push(`${key} (no such A.error ??/|| B.error pair found any more — remove this entry)`);
    }
    expect(stale, `ALLOW_LIST_JOINT entries that no longer match reality: ${stale.join(', ')}`).toEqual([]);
  });
});

/* =================================================================== *
 * GUARD 2, Part A — the exact set of client-side read-tier rank gates  *
 * (Part B, the server-side route enumeration, is in                    *
 * api/src/app.rbac.test.ts.)                                           *
 * =================================================================== */

const APP_TSX = `${WEB_SRC}App.tsx`;

/**
 * Every `rank >= X` comparison in App.tsx, in file order, as the literal
 * token written (a number, or the identifier ENGINEER_RANK/EXPORT_RANK).
 * Comments are stripped per-line (naive `//` strip) before matching, so a
 * comment that merely MENTIONS "rank >= 4" in prose is never counted.
 */
function rankComparisons(src: string): string[] {
  const out: string[] = [];
  for (const rawLine of src.split('\n')) {
    const line = rawLine.split('//')[0]!; // strip a trailing line comment, if any
    for (const m of line.matchAll(/\brank\s*>=\s*([A-Za-z0-9_$]+)/g)) out.push(m[1]!);
  }
  return out;
}

/**
 * The written list, established 21 Sep 2026 by reading App.tsx directly
 * (not trusted from the brief that described this guard): ten comparisons,
 * in file order —
 *   1. Bar's isAdmin              rank >= 4
 *   2. Line's canWrite             rank >= ENGINEER_RANK (= 2)
 *   3. Readings' canExport         rank >= EXPORT_RANK   (= 3)
 *   4. Rejects' canName            rank >= ENGINEER_RANK (= 2)
 *   5. Sacks' canRecord            rank >= ENGINEER_RANK (= 2)
 *   6. Product's canWrite          rank >= ENGINEER_RANK (= 2)
 *   7. Setup's own gate (ternary)  rank >= 4
 *   8. Health's isAdmin            rank >= 4
 *   9. StationSheet's canAdjust    rank >= ENGINEER_RANK (= 2)
 *  10. ReasonSheet's canName       rank >= ENGINEER_RANK (= 2)
 *
 * UX Phase 7 Brief 5 (21 Sep 2026, optional item): the three that used to be
 * written as the literal `2` (Line's canWrite, Product's canWrite,
 * StationSheet's canAdjust) were spelled inconsistently with the other three
 * `ENGINEER_RANK` sites for the same value — normalised to `ENGINEER_RANK` in
 * App.tsx, which is why every one of the ten is now that identifier or
 * EXPORT_RANK/a literal 4, with no bare `2` left. This list is updated to
 * match, not just to keep the guard green: the guard's job is to catch a
 * genuinely NEW gate, and a spelling normalisation with no rank-value change
 * is exactly the "deliberate, reviewed change" case this comment already
 * says to update the list for.
 *
 * Any NEW read-tier gate — a rank check added to a screen or sheet App.tsx
 * did not already gate — changes this list's length or composition and
 * fails the guard. This is deliberately about the SET, not about exactly
 * reproducing App.tsx's line order forever: two entries swapping order (e.g.
 * a refactor reordering JSX) must not fail the guard, only a genuine
 * addition/removal/rank-change should. Sorting before comparing achieves
 * that without weakening the check — the set of ten tokens is exact either
 * way.
 */
const EXPECTED_RANK_TOKENS = ['4', '4', '4', 'ENGINEER_RANK', 'ENGINEER_RANK', 'ENGINEER_RANK', 'ENGINEER_RANK', 'ENGINEER_RANK', 'ENGINEER_RANK', 'EXPORT_RANK'];

describe('GUARD 2, Part A — App.tsx grants no NEW read-tier rank gate (ONE AUDIENCE, CLAUDE.md)', () => {
  const src = readFileSync(APP_TSX, 'utf8');

  it('sanity: the scan actually found rank >= comparisons in App.tsx (canary on the scan itself)', () => {
    expect(rankComparisons(src).length).toBeGreaterThan(5);
  });

  it('the set of `rank >= X` comparisons in App.tsx is exactly the written list', () => {
    const found = rankComparisons(src).sort();
    const expected = [...EXPECTED_RANK_TOKENS].sort();
    expect(
      found,
      `App.tsx's rank >= comparisons changed shape.\n  found:    ${JSON.stringify(found)}\n  expected: ${JSON.stringify(expected)}\n` +
        `If this is a NEW read-tier gate (a screen or drilldown newly hidden behind a rank check), that is the exact ` +
        `class of defect Phase 6 found and fixed at /api/reconciliation (rank 3 -> 1) — CLAUDE.md: every screen is ` +
        `open to every signed-in account, only Setup (rank >= 4) is an exception, and roles otherwise gate WRITES ` +
        `only. If this is a deliberate, reviewed change (e.g. Setup itself gaining a new internal rank>=4 check), ` +
        `update EXPECTED_RANK_TOKENS above along with this comment's numbered list.`,
    ).toEqual(expected);
  });

  it('ENGINEER_RANK and EXPORT_RANK still resolve to the ranks this guard assumes (2 and 3)', () => {
    // A canary on the constants themselves drifting without this guard being
    // updated to match — read literally off disk, not imported (no DOM/module
    // graph in this test file, by design).
    expect(/const\s+ENGINEER_RANK\s*=\s*2\b/.test(src), 'ENGINEER_RANK is no longer 2 — update this guard\'s comment and EXPECTED_RANK_TOKENS reasoning').toBe(true);
    expect(/const\s+EXPORT_RANK\s*=\s*3\b/.test(src), 'EXPORT_RANK is no longer 3 — update this guard\'s comment and EXPECTED_RANK_TOKENS reasoning').toBe(true);
  });
});
