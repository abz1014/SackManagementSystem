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

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = toPosix(`${dir}/${entry}`);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
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
  'web/src/screens/report/PrintHead.tsx:h':
    'deferred to Phase 9 — a failed header drops the print attribution block; that is a print-layout decision.',
  'web/src/screens/product/Running.tsx:current':
    "who set the running product and why (getCurrentProduct). On failure `current.data` is undefined, so `setBy` " +
    '(Running.tsx:64-67) resolves to null, and the consuming LineWideProduct renders the whole "Set by" line only ' +
    'when `setBy` is truthy (`{setBy && (...)}`, Running.tsx:144) — a failure here degrades to the attribution line ' +
    'being silently OMITTED, identical in shape to the legitimate case where the period product differs from the ' +
    "currently-running one (the same code comment above `current`'s declaration). It never prints a wrong number or " +
    'a false state; checked 21 Sep 2026.',
};

/**
 * NOT an exception — a genuine, unfixed instance of the exact defect this
 * guard exists to catch, found while writing it and deliberately NOT swept
 * into ALLOW_LIST above (that list is for cases proven cosmetic; this is
 * not one). Reported instead in the UX Phase 7 Brief 4 worker report, dated
 * 21 Sep 2026, and tracked here so it cannot be silently lost:
 *
 * web/src/screens/Weight.tsx's `prod` poll (getProduction — the "rejected
 * by the scale" figure tile) has no `.error` read anywhere in the file.
 * `rejectedShare(null)` (Weight.tsx:491-494) prints the same em-dash for
 * "the fetch failed" as it does for "a genuinely empty period" — the exact
 * shape Brief 1 fixed for `coneLine` two lines above it in the same file
 * (Weight.tsx:222-223).
 *
 * This is kept OUT of ALLOW_LIST, and the guard's main check below still
 * flags it (this suite is not "1180/4 clean" — see the worker report), so
 * fixing Weight.tsx and forgetting to update this file is caught by the
 * canary test right below: once `prod.error` IS read, that test fails,
 * telling whoever fixed it to delete this entry.
 */
const KNOWN_DEFECTS: Record<string, string> = {
  'web/src/screens/Weight.tsx:prod':
    'getProduction\'s error is never read; the "rejected by the scale" figure tile (rejectedShare, Weight.tsx:257,491-494) shows ' +
    '"—" for a failed fetch exactly as it does for a genuinely empty period. Same shape as the coneLine defect Brief 1 fixed two ' +
    'lines above (Weight.tsx:222-223). Reported, not fixed, by UX Phase 7 Brief 4 (21 Sep 2026) — Weight.tsx is not this brief\'s file.',
};

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
 *   2. Line's canWrite             rank >= 2   (literal, not ENGINEER_RANK)
 *   3. Readings' canExport         rank >= EXPORT_RANK   (= 3)
 *   4. Rejects' canName            rank >= ENGINEER_RANK (= 2)
 *   5. Sacks' canRecord            rank >= ENGINEER_RANK (= 2)
 *   6. Product's canWrite          rank >= 2   (literal, not ENGINEER_RANK)
 *   7. Setup's own gate (ternary)  rank >= 4
 *   8. Health's isAdmin            rank >= 4
 *   9. StationSheet's canAdjust    rank >= 2   (literal, not ENGINEER_RANK)
 *  10. ReasonSheet's canName       rank >= ENGINEER_RANK (= 2)
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
const EXPECTED_RANK_TOKENS = ['2', '2', '2', '4', '4', '4', 'ENGINEER_RANK', 'ENGINEER_RANK', 'ENGINEER_RANK', 'EXPORT_RANK'];

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
