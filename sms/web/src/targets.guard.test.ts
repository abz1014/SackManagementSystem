/**
 * Guard against the U1 defect Wave 1 fixed (`git show be5ac3e`): the
 * cone-weight report's figure tile once took its target from weights.ts's
 * "nominal" figure — the product running NOW, backed by a hardcoded
 * `FALLBACK_CONE_SETPOINT_G = 1950` — regardless of what period the report
 * was asked to describe, while the "vs target" column right next to it
 * already used the period's own versioned resolution. The owner's §8 rule,
 * verbatim: "Do not allow the frontend to silently use a generic/current
 * product target for historical data."
 *
 * Deliberately dumb, in `api.callers.test.ts`'s own idiom: this reads source
 * files off disk with `node:fs` and greps them — no imports of the real
 * modules, no DOM (see `vitest.config.ts`'s `environment: 'node'`). Two
 * checks:
 *
 * 1. The "current product, right now" identifiers stay confined to the one
 *    place they legitimately belong — `weights.ts` and its own tests — and
 *    never leak into a report (server) or a web screen, where "now" and "the
 *    period asked for" are not the same instant.
 * 2. Any report payload type that states a `target` also states WHEN that
 *    target was in force (`inForceAtUtc`), or says plainly that none applied
 *    (a `'none'` source/discriminator) — never a bare number with no instant
 *    attached, which is what let #1 happen in the first place.
 *
 * A violation found here is not automatically a bug — it may be a
 * legitimate, already-audited exception (see ALLOW_LIST) — but it must be a
 * WRITTEN decision, never a silent hole. Do not add an ALLOW_LIST entry just
 * to make this pass; every entry below was checked against its own evidence
 * before being added.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Backslashes normalized to forward slashes throughout — `fileURLToPath` gives
 *  OS-native separators (backslashes on Windows), and mixing those with the
 *  forward slashes `listSourceFiles` joins with below breaks straight string
 *  comparisons (`file === API_SRC + HOME_FILE`) on Windows. */
const toPosix = (p: string) => p.replace(/\\/g, '/');

const WEB_SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/'); // .../sms/web/src/
const API_SRC = toPosix(fileURLToPath(new URL('../../api/src', import.meta.url))).replace(/\/*$/, '/'); // .../sms/api/src/
const REPO_ROOT = toPosix(fileURLToPath(new URL('../..', import.meta.url))).replace(/\/*$/, '/'); // .../sms/
const REPORTS_DIR = `${API_SRC}services/reports`;

/**
 * UX Phase 8 Brief A (21 Sep 2026): skips the `testkit/` directory —
 * `web/src/testkit/*.ts(x)` is test-harness plumbing (a fake fetch, typed
 * fixtures, RTL wiring), never a report or a screen, and has no business
 * being swept into check 1's "does this file use a current-product/fallback
 * identifier" scan below.
 *
 * Deliberately NOT a blanket `*.test.tsx?` exclusion, unlike
 * `reliability.guard.test.ts`'s equivalent function: THIS file's own check 1
 * already scans test files on purpose and by design — `isHomeTestFile`
 * below whitelists `weights.*.test.ts(x)` explicitly, and the ALLOW_LIST
 * entry for `api/src/services/reports/reports.test.ts` (a *.test.ts file)
 * depends on that file being present in `allFiles` at all, or the "ALLOW_LIST
 * names only identifiers that genuinely still appear" check fails with
 * "file not found". A blanket test-file exclusion here would have broken
 * that existing, passing assertion — exactly the "would weaken a guard"
 * case the brief says to stop on rather than force, so only the `testkit/`
 * skip is added.
 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = toPosix(`${dir}/${entry}`);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'testkit') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const relPath = (f: string) => toPosix(f).replace(REPO_ROOT, '').replace(/\/{2,}/g, '/');

/* ------------------------------------------------------------------ check 1 */

const FORBIDDEN_IDENTIFIERS = ['nominalSetpointG', 'nominalSource', 'FALLBACK_CONE_SETPOINT_G'] as const;

/** The identifiers' one legitimate home, and its own tests — basename-matched so `weightStations*` (a different service) is never swept in by accident. */
const HOME_FILE = 'weights.ts';
const isHomeTestFile = (basename: string) => /^weights(\.[^.]+)?\.test\.tsx?$/.test(basename);

/**
 * Written exceptions, each checked against the evidence named, not added to
 * silence a failure. Keyed by path relative to the repo's `sms/` root.
 */
const ALLOW_LIST: Record<string, { identifiers: readonly string[]; reason: string }> = {
  'web/src/api.ts': {
    identifiers: ['nominalSetpointG', 'nominalSource'],
    reason:
      "mirrors /api/weights' OWN wire type (WeightsData.cone.nominalSetpointG/nominalSource in api.ts) — the Weight " +
      "screen's CURRENT-product giveaway figure, a live 'now' stat from a non-report endpoint, not a report payload. " +
      "api.callers.test.ts (this same directory) already proves getWeights has a caller outside api.ts/*.test.ts, and " +
      'grepping web/src for these two names outside api.ts returns nothing (checked 16 Sep 2026) — no report screen ' +
      'reads them. Flagging this file made the guard red on an untouched tree, which is why it is a written exception ' +
      'rather than a silent hole, not evidence the field is misused.',
  },
  'api/src/services/reports/reports.test.ts': {
    identifiers: ['nominalSource'],
    reason:
      "a COMMENT (\"no nominalSource/nominalLabel survive into the report\") pinning that these fields must NOT reach " +
      'the report payload — a text mention proving their absence is tested, not a code usage of the identifier.',
  },
};

describe('the U1 fallback/current-product identifiers stay out of reports and the web app', () => {
  const allFiles = [...listSourceFiles(API_SRC), ...listSourceFiles(WEB_SRC)];

  it('sanity: the scan actually found the home file and its identifiers (canary on the scan itself)', () => {
    const home = allFiles.find((f) => f.endsWith(`/${HOME_FILE}`) && !f.includes('/reports/'));
    expect(home, 'weights.ts was not found by the scan — check WEB_SRC/API_SRC/listSourceFiles above').toBeTruthy();
    const src = readFileSync(home!, 'utf8');
    for (const id of FORBIDDEN_IDENTIFIERS) {
      expect(src.includes(id), `expected weights.ts to still define ${id} — if it was renamed, update this test`).toBe(true);
    }
  });

  it('no other file under api/src or web/src uses these identifiers without a written exception', () => {
    const violations: string[] = [];
    for (const file of allFiles) {
      const basename = file.split('/').pop()!;
      // The definition site itself — basename-matched (not the reports/ directory, which has no weights.ts).
      if (basename === HOME_FILE && !file.includes('/reports/')) continue;
      if (isHomeTestFile(basename)) continue; // weights.ts's OWN tests (weights.basis.test.ts, weights.median.test.ts, ...)
      if (basename === 'targets.guard.test.ts') continue; // this file — the identifiers appear here as literal strings, not usage
      const src = readFileSync(file, 'utf8');
      const rel = relPath(file);
      const allowed = ALLOW_LIST[rel];
      for (const id of FORBIDDEN_IDENTIFIERS) {
        if (!new RegExp(`\\b${id}\\b`).test(src)) continue;
        if (allowed?.identifiers.includes(id)) continue;
        violations.push(`${rel}: ${id}`);
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these files use a current-product/fallback identifier outside its home (weights.ts) with no ALLOW_LIST ` +
            `entry: ${violations.join(', ')}. This is the exact shape of the U1 defect (git show be5ac3e) — a report ` +
            `or a screen silently using "the product running now" instead of the period's own versioned target. Fix ` +
            `the report/screen to take its target from a period-resolved source (see coneWeight.ts's target field, or ` +
            `weightStations.ts), or add a reviewed ALLOW_LIST entry naming the evidence it is not a report path.`,
    ).toEqual([]);
  });

  it('ALLOW_LIST names only identifiers that genuinely still appear where it says they do', () => {
    const stale: string[] = [];
    for (const [rel, { identifiers }] of Object.entries(ALLOW_LIST)) {
      const file = allFiles.find((f) => relPath(f) === rel);
      if (!file) { stale.push(`${rel} (file not found)`); continue; }
      const src = readFileSync(file, 'utf8');
      for (const id of identifiers) {
        if (!new RegExp(`\\b${id}\\b`).test(src)) stale.push(`${rel}: ${id}`);
      }
    }
    expect(stale, `ALLOW_LIST entries that no longer match the file (remove or fix them): ${stale.join(', ')}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ check 2 */

/** A `target` property declaration — word-boundaried so `vsTargetG:` / `targetG:` never match. */
const TARGET_PROP_RE = /\btarget\s*\??\s*:/;
/**
 * A `source` field typed to include `'none'` — deliberately narrower than a
 * bare `/'none'/` scan, which also matches unrelated call sites in the SAME
 * file (e.g. `groupBy: 'none'` in coneWeight.ts's own getProduction call) and
 * would let the guard pass on a file that has no real 'none' discriminator at
 * all. Confirmed against the pre-Wave-1 coneWeight.ts (`git show be5ac3e^`):
 * a bare `/'none'/` scan false-passed on that file because of the unrelated
 * `groupBy: 'none'`, even though its `target.source` was
 * `'current_product' | 'fallback'` with no `'none'` option anywhere.
 */
const NONE_SOURCE_RE = /\bsource\s*\??\s*:[^\n;]*'none'/;

function listReportFiles(): string[] {
  return readdirSync(REPORTS_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${REPORTS_DIR}/${f}`);
}

describe('every report payload `target` field carries its own instant, never a bare number', () => {
  const files = listReportFiles();

  it('sanity: found report payload files to scan (canary on the scan itself)', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('a file declaring a `target:` property also states inForceAtUtc or a \'none\' source', () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (!TARGET_PROP_RE.test(src)) continue; // this report payload has no `target` field at all
      const statesInstant = src.includes('inForceAtUtc');
      const statesNoneSource = NONE_SOURCE_RE.test(src);
      if (!statesInstant && !statesNoneSource) violations.push(relPath(file));
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these report files declare a \`target\` property but never mention inForceAtUtc or a 'none' source ` +
            `anywhere in the file: ${violations.join(', ')}. Per the owner's §8 rule a target may never be stated ` +
            `without the instant it was in force at (see coneWeight.ts's target.inForceAtUtc / target.source, or ` +
            `product.ts's target.inForceAtUtc, for the pattern to follow).`,
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ check 3 */

/**
 * WHY THIS CHECK EXISTS, AND WHY CHECK 2 DID NOT CATCH THE DEFECT IT GUARDS
 * (friction audit F6, 23 Sep 2026).
 *
 * Check 2 asks only that a report payload declaring a `target` MENTIONS
 * `inForceAtUtc` somewhere in the file. Report › Cone weight did — and then
 * published `inForceAtUtc: '2026-09-11T15:03:15.957Z'` with
 * `source: 'in_force_at_period_end'` for a period ending 2026-09-07, under a
 * caption promising the target was the one in force at the END of the period.
 * The instant was PRESENT and WRONG, which is precisely the case a
 * presence-only check cannot see, so check 2 passed on the defect. The audit
 * says so in as many words: "The Phase 5 guard requires a `target` to state
 * an `inForceAtUtc`; it does not check that the instant precedes the period,
 * so the guard passes."
 *
 * `ProductCatalogue.versionAt` (api/src/services/productLimits.ts) is honest
 * about it: when no version began at or before the asked-for instant it
 * returns the nearest version and marks it `effectiveIsLowerBound: true`.
 * Every instance of the defect is that flag being DROPPED on the way to a
 * payload. So the mechanical form of the defect is: a report file that
 * resolves a version itself (`versionAt(`) and publishes an `inForceAtUtc`,
 * without ever naming the lower-bound case.
 *
 * The VALUE-level assertion — that a published instant never postdates the
 * period — lives where it can be executed rather than grepped:
 * `api/src/services/reports/periodTarget.test.ts` (the pure resolver) and the
 * two F6 cases in `api/src/services/reports/reports.test.ts` (the whole
 * report, end to end). This check stops the WIRING from being removed again;
 * those stop the BEHAVIOUR from changing.
 */
const RESOLVES_A_VERSION_RE = /\bversionAt\s*\(/;
/**
 * A CALL to the shared resolver — the one sanctioned way to handle it.
 * Deliberately a call, not a mention: an earlier draft of this check accepted
 * the identifier `effectiveIsLowerBound` appearing anywhere in the file, and
 * passed on a deliberately broken product.ts because the name survived in a
 * DOC COMMENT. A guard that a comment can satisfy is not a guard.
 */
const HANDLES_LOWER_BOUND_RE = /\bresolvePeriodTarget\s*\(/;

describe('a report that resolves its own limits version may not drop the lower-bound qualifier', () => {
  const files = listReportFiles();

  it('sanity: at least one report file really does resolve a version itself (canary on the scan)', () => {
    const resolvers = files.filter((f) => RESOLVES_A_VERSION_RE.test(readFileSync(f, 'utf8')));
    expect(
      resolvers.length,
      'no report file calls versionAt( any more — if the resolution moved, move this check with it',
    ).toBeGreaterThan(0);
  });

  it('every such file also names the lower-bound case', () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (!RESOLVES_A_VERSION_RE.test(src)) continue;
      if (!src.includes('inForceAtUtc')) continue; // resolves a version but publishes no instant
      if (!HANDLES_LOWER_BOUND_RE.test(src)) violations.push(relPath(file));
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these report files resolve a limits version with versionAt() and publish an inForceAtUtc without calling ` +
            `resolvePeriodTarget(): ${violations.join(', ')}. That is the F6 ` +
            `defect exactly — ProductCatalogue.versionAt returns the NEAREST version marked effectiveIsLowerBound when ` +
            `none was in force at the instant asked for, and dropping that flag publishes a date the report does not ` +
            `have. Route the resolution through reports/common.ts's resolvePeriodTarget (which refuses a version that ` +
            `begins after the period ends, and flags a lower bound as one), as coneWeight.ts and product.ts do.`,
    ).toEqual([]);
  });
});
