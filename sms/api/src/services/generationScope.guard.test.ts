/**
 * GENERATION-SCOPE COMPLETENESS GUARD — red-team remediation, WS-RG, 23 Sep
 * 2026.
 *
 * WHY THIS FILE EXISTS. `generation.ts`'s own header records that an
 * inventory on 23 Sep 2026 found the shared epoch predicate
 * (`resolveGenerationScope` / `epochWhere` / `andEpoch` / `epochFragment`)
 * used by almost nothing: two constrained queries, one correct by
 * partitioning, and every other query touching `sms.cone_event`,
 * `sms.sack_event` or `sms.reject_event` pooling IFL's two source
 * generations (pre- and post-5-Aug-2026 rebuild) silently the moment a date
 * range spanned both. Six of the eight CRITICAL defects the same day's audit
 * found were exactly this shape. The suite passed the whole time — every
 * fixture in it was single-generation, so a pooling defect was invisible to
 * every other test in the repo.
 *
 * This guard closes the class, not the eight instances: it enumerates every
 * `sms.cone_event` / `sms.sack_event` / `sms.reject_event` reference under
 * `api/src/services/**`, attributes it to the top-level function or constant
 * that contains it, and fails unless that owner (or a function it calls
 * directly, one hop — see ONE HOP below) also references the epoch
 * mechanism, or carries a written, dated EXEMPTION.
 *
 * Same dumb-but-effective idiom as `web/src/reliability.guard.test.ts` —
 * node:fs + regex, no imports of the real modules, no AST, no type
 * information. A violation found here is not automatically a bug — see
 * EXEMPTIONS — but every entry must be a written, evidenced decision, read at
 * its site, never a silent hole added just to make the guard pass. Every
 * EXEMPTIONS/KNOWN_DEFECTS entry has its own staleness test, in
 * `reliability.guard.test.ts`'s own idiom: an entry naming a query that no
 * longer exists, or that NOW carries an epoch token, must fail.
 *
 * ONE HOP. Several real, correctly-scoped functions build their WHERE clause
 * through a local helper (`rejects.ts`'s `bindRejectFilters` /
 * `bindConeFilters`, both of which call `andEpoch` internally) rather than
 * calling `epochWhere`/`andEpoch` themselves. A purely per-function text scan
 * would misreport every one of them as unscoped. So the check is: does the
 * owner's OWN body contain an epoch token, OR does it call another top-level
 * function/const declared in the SAME FILE whose OWN body contains one. One
 * hop only — deliberately, in `reliability.guard.test.ts` GUARD 1C's own
 * "one hop is followed, not a chain" idiom. A two-hop indirection is invisible
 * to this guard; none is known to exist as of 23 Sep 2026 (verified by
 * reading, not merely by this guard passing).
 *
 * WHAT THIS CANNOT CATCH, stated plainly rather than left to look like it
 * does:
 *  - A table reference built entirely from interpolation with no literal
 *    `sms.cone_event`/`sms.sack_event`/`sms.reject_event` substring anywhere
 *    in the file (e.g. a table name assembled from two separately-declared
 *    string constants neither of which contains the sequence
 *    `sms.cone_event`). None is known to exist; this is a text scan, not a
 *    SQL parser, and cannot prove otherwise.
 *  - A helper the owner calls that itself is a passthrough to a THIRD
 *    function containing the epoch token (a two-hop chain). See ONE HOP.
 *  - A `WHERE` clause that references the epoch mechanism SYNTACTICALLY but
 *    binds the wrong table's epoch ids to it, or omits an `AND` so the
 *    predicate is dead. This is a text scan for the tokens' PRESENCE, not a
 *    proof the SQL they produce is correct — `epochWhere`/`andEpoch`'s own
 *    unit tests, and `bindConeFilters`'s comment on why it must re-derive
 *    cone_event's own epoch rather than reuse reject_event's, are what proves
 *    that.
 *  - `sync-worker/`, `cli/`, and anything outside `api/src/services/**` are
 *    out of scope for this guard by design (the task that produced it named
 *    that directory only).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');

const SERVICES_DIR = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/'); // .../sms/api/src/services/
const REPO_ROOT = toPosix(fileURLToPath(new URL('../../..', import.meta.url))).replace(/\/*$/, '/'); // .../sms/
const relPath = (f: string) => toPosix(f).replace(REPO_ROOT, '').replace(/\/{2,}/g, '/');

const TABLE_RE = /\bsms\.(cone_event|sack_event|reject_event)\b/g;
const EPOCH_TOKEN_RE = /\b(epochWhere|andEpoch|epochFragment|resolveGenerationScope)\b/;
/** Top-level (column-0) `function NAME` or `const NAME` — a declaration boundary. */
const DECL_RE = /^(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)|^(export\s+)?const\s+([A-Za-z_$][\w$]*)/;
/** A call to another top-level name declared in the same file: `name(`. */
const callRe = (name: string) => new RegExp(`\\b${name}\\s*\\(`);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = toPosix(`${dir}/${entry}`);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Per-line comment mask: `//`, `*` (block-comment continuation) and `/* … * /` starts. Crude, matches reliability.guard.test.ts's own "prose, not code" idiom. */
function commentMask(lines: string[]): boolean[] {
  let inBlock = false;
  return lines.map((l) => {
    const t = l.trimStart();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return true;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return true;
    }
    return t.startsWith('*') || t.startsWith('//');
  });
}

/** Strips comment lines (by the same commentMask idiom) before a token check, so a
 *  PROSE mention of andEpoch/epochWhere/etc. (e.g. explaining a SIBLING function's
 *  pattern, as weightStations.ts's rejectRatesByStation doc comment does for
 *  bindRejectFilters/epochWhere) can never be mistaken for a real call. */
function codeOnly(bodyLines: string[]): string {
  const mask = commentMask(bodyLines);
  return bodyLines.filter((_, i) => !mask[i]).join('\n');
}

interface Decl { line: number; name: string }

interface Owner {
  file: string;
  rel: string;
  name: string;
  /** 1-based line numbers of the table references attributed to this owner. */
  refLines: number[];
  ownHasToken: boolean;
  /** Names this owner's body calls that are also top-level decls in the same file. */
  calls: string[];
}

function scanFile(file: string): Owner[] {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const isComment = commentMask(lines);

  const decls: Decl[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isComment[i]) continue;
    if (!/^\S/.test(lines[i]!)) continue; // top-level only
    const m = lines[i]!.match(DECL_RE);
    if (m) decls.push({ line: i, name: (m[3] ?? m[5])! });
  }

  const refLines: number[] = [];
  lines.forEach((l, i) => {
    if (isComment[i]) return;
    TABLE_RE.lastIndex = 0;
    if (TABLE_RE.test(l)) refLines.push(i);
  });
  if (refLines.length === 0) return [];

  const byOwner = new Map<string, Owner>();
  for (const rl of refLines) {
    let owner: Decl | null = null;
    for (const d of decls) {
      if (d.line <= rl) owner = d;
      else break;
    }
    const ownerName = owner ? owner.name : '(module scope, before any declaration)';
    const nextIdx = owner ? decls.indexOf(owner) + 1 : 0;
    const endLine = nextIdx < decls.length ? decls[nextIdx]!.line : lines.length;
    const bodyLines = lines.slice(owner ? owner.line : 0, endLine);
    const body = bodyLines.join('\n');

    let o = byOwner.get(ownerName);
    if (!o) {
      const calls = decls
        .map((d) => d.name)
        .filter((n) => n !== ownerName && callRe(n).test(body));
      o = { file, rel: relPath(file), name: ownerName, refLines: [], ownHasToken: EPOCH_TOKEN_RE.test(codeOnly(bodyLines)), calls };
      byOwner.set(ownerName, o);
    }
    o.refLines.push(rl + 1);
  }
  return [...byOwner.values()];
}

/** All bodies by (file, name), for the one-hop resolution below. */
function bodyOf(file: string, name: string): string {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const isComment = commentMask(lines);
  const decls: Decl[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isComment[i]) continue;
    if (!/^\S/.test(lines[i]!)) continue;
    const m = lines[i]!.match(DECL_RE);
    if (m) decls.push({ line: i, name: (m[3] ?? m[5])! });
  }
  const idx = decls.findIndex((d) => d.name === name);
  if (idx === -1) return '';
  const end = idx + 1 < decls.length ? decls[idx + 1]!.line : lines.length;
  return codeOnly(lines.slice(decls[idx]!.line, end));
}

function isScoped(o: Owner): { scoped: boolean; via: string | null } {
  if (o.ownHasToken) return { scoped: true, via: null };
  for (const callee of o.calls) {
    const calleeBody = bodyOf(o.file, callee);
    if (EPOCH_TOKEN_RE.test(calleeBody)) return { scoped: true, via: callee };
  }
  return { scoped: false, via: null };
}

function allOwners(): Owner[] {
  const out: Owner[] = [];
  for (const file of listSourceFiles(SERVICES_DIR)) out.push(...scanFile(file));
  return out;
}

/**
 * EXEMPTIONS — every entry read at its site on the date given, not assumed
 * from its shape. Keyed `${path relative to sms/}::${owner name}`.
 */
const EXEMPTIONS: Record<string, string> = {
  'api/src/services/register.ts::fromFor':
    "The register's own shared FROM builder, consumed by listEvents, getEventDetail and exportEventsCsv — a helper " +
    'that builds a FROM clause, not a query, so it carries no epoch token itself. UNSCOPED BY DESIGN, updated for ' +
    "owner decision 28 Sep: one batch by default (superseding the 23 Sep 2026 design this exemption used to describe, " +
    'which kept the register deliberately pooled). `listEvents` and `exportEventsCsv` are no longer unscoped: both ' +
    'now REQUIRE a `GenerationScope` argument and apply it via `andEpoch` directly in their OWN bodies — the guard ' +
    'sees the epoch token on the owner function itself for both, with no exemption needed there. This entry stays ' +
    'only because `fromFor` itself is a helper with no query and no epoch token to carry; every row it feeds still ' +
    'joins `sms.source_epoch` via EPOCH_JOIN and is labelled, and the scoping now happens one level up, in the ' +
    "callers that consume it. getEventDetail's own TOP 1 is addressed by the canonical PK (cone_event_id/" +
    'sack_event_id/reject_event_id, globally unique across all generations since 5 Aug 2026 — see this file\'s own ' +
    'IDENTITY comment), never by a range, so there is no pooling to guard against there either.',
  // rejectSpc.ts::getRejectSpc removed 25 Sep 2026: it now accepts an optional
  // generation scope (the reject report passes one), so the guard sees epoch scoping.
  'api/src/services/live.ts::findNewerElsewhere':
    'Deliberately queries OUTSIDE the chosen generation — that is its entire job. Its own doc comment: "The newest ' +
    'reading on record that the chosen generation does NOT contain, and which generation owns it," keyed on ' +
    '`production_ts_utc_ms > @tip` (the newest instant already inside the chosen generation) rather than on excluding ' +
    'source_epoch values. Scoping this query TO one generation would make it structurally unable to answer the ' +
    'question it exists to answer. Checked 23 Sep 2026.',
  'api/src/services/operations.ts::DQ_DESTINATION_MAP':
    'A literal table-name map, not a query — read by resolveDqDestination (operations.ts:473-492) to resolve ONE row ' +
    'by `raw_id` (the canonical table\'s own FK back to the raw layer, unique per row per line — see the map\'s own ' +
    'preceding doc comment: "a single indexed equality against the canonical table"). A point lookup by a unique key ' +
    'has no generation to pool across, the same reasoning as register.ts\'s getEventDetail above. Checked 23 Sep 2026.',
};

/**
 * KNOWN_DEFECTS — a genuine, unfixed instance of the exact defect this guard
 * exists to catch, found while building it and left for another worker to
 * fix (WS-RG writes no production code). Deleting the entry once fixed is
 * this canary's own instruction, exactly as reliability.guard.test.ts's own
 * KNOWN_DEFECTS map documents.
 */
// WS-GF (23 Sep 2026): report.ts::getReport's coverageReq is now scoped
// (resolveGenerationScope + andEpoch, resolved by getReport itself over the
// same (lineId, from, to) key its sibling queries use — see report.ts's own
// comment at the call site and report.generations.test.ts's four-window
// regression proof). The KNOWN_DEFECTS entry that named this gap is
// deleted, not left standing, per this canary's own instruction above.
const KNOWN_DEFECTS: Record<string, string> = {};

describe('GENERATION-SCOPE COMPLETENESS GUARD — every cone_event/sack_event/reject_event reference is epoch-scoped, one hop, or a written exemption', () => {
  const owners = allOwners();

  it('sanity: the scan actually found table references under api/src/services (canary on the scan itself)', () => {
    expect(owners.length).toBeGreaterThan(15);
  });

  it('sanity: the scan attributes calibration.ts\'s getStationDrift as directly scoped (canary: a known-good direct case)', () => {
    const o = owners.find((x) => x.rel === 'api/src/services/calibration.ts' && x.name === 'getStationDrift');
    expect(o, 'getStationDrift not found by the scan').toBeTruthy();
    expect(o!.ownHasToken).toBe(true);
  });

  it('sanity: the scan resolves rejects.ts\'s getRejectPareto as scoped via ONE HOP through bindRejectFilters (canary on the hop logic)', () => {
    const o = owners.find((x) => x.rel === 'api/src/services/rejects.ts' && x.name === 'getRejectPareto');
    expect(o, 'getRejectPareto not found by the scan').toBeTruthy();
    expect(o!.ownHasToken, 'getRejectPareto should NOT carry the token directly — it delegates').toBe(false);
    expect(o!.calls).toContain('bindRejectFilters');
    // Either hop is a legitimate resolution: getRejectPareto calls both `scoped()`
    // (which itself calls resolveGenerationScope directly) and `bindRejectFilters`
    // (which calls andEpoch) — whichever this function's `calls` list resolves
    // first is fine; what matters is that ONE of them is found.
    const result = isScoped(o!);
    expect(result.scoped).toBe(true);
    expect(['scoped', 'bindRejectFilters']).toContain(result.via);
  });

  it('every cone_event/sack_event/reject_event reference is epoch-scoped (directly, one hop, or a written EXEMPTIONS/KNOWN_DEFECTS entry)', () => {
    const violations: string[] = [];
    for (const o of owners) {
      const { scoped } = isScoped(o);
      if (scoped) continue;
      const key = `${o.rel}::${o.name}`;
      if (EXEMPTIONS[key] !== undefined) continue;
      if (KNOWN_DEFECTS[key] !== undefined) continue;
      violations.push(`${key} (line ${o.refLines.join(', ')})`);
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these owners reference sms.cone_event/sack_event/reject_event with no epoch scoping in their own body or ` +
            `one call away, and no EXEMPTIONS/KNOWN_DEFECTS entry: ${violations.join('; ')}. IFL dropped and ` +
            `recreated these tables on 2026-08-05, restarting every identity at 1 — an unscoped query that spans the ` +
            `boundary pools two physically distinct populations into one figure (generation.ts's file header has the ` +
            `full history). Either scope it (epochWhere/andEpoch/epochFragment/resolveGenerationScope — see ` +
            `weightStations.ts's rejectRatesByStation for the direct pattern, or rejects.ts's bindRejectFilters for ` +
            `the one-hop-helper pattern), or add a reviewed EXEMPTIONS['<path>::<name>'] entry naming why it is ` +
            `genuinely safe to pool (a point lookup by unique key, a partition-and-report chart, a deliberate ` +
            `cross-generation probe), or a KNOWN_DEFECTS['<path>::<name>'] entry if it is a real gap you are not ` +
            `fixing here.`,
    ).toEqual([]);
  });

  it('EXEMPTIONS names only owners that still exist and still lack epoch scoping (staleness canary)', () => {
    const stale: string[] = [];
    for (const key of Object.keys(EXEMPTIONS)) {
      const [rel, name] = key.split('::');
      const o = owners.find((x) => x.rel === rel && x.name === name);
      if (!o) {
        stale.push(`${key} (no such owner found any more — the query moved, was removed, or was renamed; remove or update this entry)`);
        continue;
      }
      if (isScoped(o).scoped) stale.push(`${key} (now HAS epoch scoping — the gap is closed, remove this entry)`);
    }
    expect(stale, `EXEMPTIONS entries that no longer match reality: ${stale.join('; ')}`).toEqual([]);
  });

  it('KNOWN_DEFECTS names only owners that STILL genuinely lack epoch scoping (delete the entry once fixed)', () => {
    const stale: string[] = [];
    for (const key of Object.keys(KNOWN_DEFECTS)) {
      const [rel, name] = key.split('::');
      const o = owners.find((x) => x.rel === rel && x.name === name);
      if (!o) {
        stale.push(`${key} (no such owner found any more — was it removed/renamed/fixed away?)`);
        continue;
      }
      if (isScoped(o).scoped) stale.push(`${key} (now HAS epoch scoping — the defect is fixed, delete this KNOWN_DEFECTS entry)`);
    }
    expect(stale, `KNOWN_DEFECTS entries that no longer match reality: ${stale.join('; ')}`).toEqual([]);
  });
});
