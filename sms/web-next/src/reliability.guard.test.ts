/**
 * Port of sms/web/src/reliability.guard.test.ts to the redesign (fix-wave T6,
 * TRACE B6-03). Deliberately dumb, in the older guards' idiom: read source off
 * disk with node:fs, strip comment-only lines (line numbers preserved), regex.
 * Every rule is a pure function over source text so a canary can prove it
 * fires on a synthetic violation. A hit is a decision for a human: fix the
 * code or write an evidenced ALLOW_LIST entry; never loosen a regex to go green.
 *
 *  GUARD 1  every useData / useMulti / usePeriod result (and every hook that
 *           returns one) has its error or status read in the file that
 *           declares it. A failed fetch must not fall through to the empty or
 *           zero branch.
 *  GUARD 1B no `a.error ?? b.error` blur: two different results' failures are
 *           not folded into one message unless the pair is an evidenced,
 *           indivisible block.
 *  GUARD 2A the exact list of rank comparisons and WriteGate minRank tokens
 *           across web-next src (ONE AUDIENCE: roles gate WRITES, plus the
 *           admin-only Setup). A new read-tier gate changes the list.
 *
 * SMS_GUARD_EXTRA_ROOT (test hook, unset in normal runs) adds one more
 * directory to the scan so a red-proof can use a scratch file outside the repo.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/');
const EXTRA = process.env.SMS_GUARD_EXTRA_ROOT ? toPosix(process.env.SMS_GUARD_EXTRA_ROOT).replace(/\/*$/, '/') : null;

/* ---- shared plumbing ------------------------------------------------------ */

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
function stripComments(src: string): string {
  const lines = src.split('\n');
  const mask = commentMask(lines);
  return lines.map((l, i) => (mask[i] ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');
}
function listFiles(dir: string, skip: string[] = ['bridge', 'testkit', 'node_modules']): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir.replace(/\/$/, '')}/${e.name}`;
    if (e.isDirectory()) {
      if (!skip.includes(e.name)) out.push(...listFiles(full, skip));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}
interface Src { rel: string; code: string }
function loadSources(): Src[] {
  const roots: Array<[string, string]> = [[SRC, '']];
  if (EXTRA && existsSync(EXTRA)) roots.push([EXTRA, 'extra/']);
  const out: Src[] = [];
  for (const [root, prefix] of roots) {
    for (const f of listFiles(root)) out.push({ rel: prefix + f.replace(root, ''), code: stripComments(readFileSync(f, 'utf8')) });
  }
  return out;
}
const SOURCES = loadSources();

/* =========================================================================
 * GUARD 1: every data result's failure is read
 * ========================================================================= */

/** Hooks that hand back a DataState / PeriodState / MultiState. Others are discovered below. */
const BASE_DATA_HOOKS = ['useData', 'useMulti', 'usePeriod', 'usePolling'];

/** Names of exported hooks that themselves return a useData result (useProduction, useStationCounts ...). */
export function discoverDataHooks(sources: Src[]): string[] {
  const names = new Set(BASE_DATA_HOOKS);
  for (const s of sources) {
    const parts = s.code.split(/\nexport (?:async )?function /);
    for (const part of parts.slice(1)) {
      const m = /^(use[A-Z]\w*)/.exec(part);
      if (m && /return\s+useData\b/.test(part.split(/\nexport /)[0]!)) names.add(m[1]!);
    }
  }
  return [...names];
}

export interface Decl { name: string; kind: 'name' | 'destructure'; reads: string }

/** `const x = useFoo(` and `const { a, status: b } = useFoo(` declarations. */
export function declsIn(code: string, hooks: string[]): Decl[] {
  const alt = hooks.join('|');
  const out: Decl[] = [];
  const named = new RegExp(String.raw`\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:[A-Za-z_$][\w$]*\.)?(?:${alt})\b\s*(?:<[^>(]*>)?\s*\(`, 'g');
  for (const m of code.matchAll(named)) out.push({ name: m[1]!, kind: 'name', reads: '' });
  const destr = new RegExp(String.raw`\bconst\s+\{([^}]*)\}\s*=\s*(?:[A-Za-z_$][\w$]*\.)?(?:${alt})\b\s*(?:<[^>(]*>)?\s*\(`, 'g');
  for (const m of code.matchAll(destr)) out.push({ name: '{' + m[1]!.trim() + '}', kind: 'destructure', reads: m[1]! });
  return out;
}

const FAILURE_FIELDS = 'error|status|staleError|failed';
/** Is this declaration's failure read? Named: `x.error|status|staleError|failed`. Destructured: one of those keys pulled out. */
export function surfaces(code: string, d: Decl): boolean {
  if (d.kind === 'destructure') return new RegExp(String.raw`\b(?:${FAILURE_FIELDS})\b`).test(d.reads);
  const n = d.name.replace(/\$/g, '\\$');
  if (new RegExp(String.raw`\b${n}\s*\??\.(?:${FAILURE_FIELDS})\b`).test(code)) return true;
  // `const { period, status } = state;` is a read of state's failure field too.
  return new RegExp(String.raw`\{[^}]*\b(?:${FAILURE_FIELDS})\b[^}]*\}\s*=\s*${n}\s*;`).test(code);
}

/**
 * Written exceptions. Keyed `${path under web-next/src}:${name}`. Each was read
 * at the site; a failure here degrades to an omission or to a value the screen
 * does not print as a fact. Seeded 13 Oct 2026 from a run at HEAD; each entry below
 * says what it reads and why the gap is cosmetic.
 */
const PDAS_CARD =
  'usePdasWriteStatus() result. Its failure is shown by PdasStatusCard (screens/Products/PdasStatusCard.tsx: status.status === error renders ErrorState with status.error), which this screen mounts with the whole result; the remaining reads here only choose between "on", "off" and "unknown" wording, never a count.';
const RANGE_OMITS =
  'useRange() result (first and last production day held). Only read as `range.data?.maxDate` / `minDate`; on failure the value is null and the sentence or limit that uses it is omitted (no date range clamp, no "newest reading is ..." line). It never prints a number or a state.';
const ALLOW_LIST: Record<string, string> = {
  'screens/Products/Board/ProductsBoard.tsx:status': PDAS_CARD,
  'screens/Products/Changeover/ChangeoverScreen.tsx:pdas': PDAS_CARD,
  'screens/Products/Limits/LimitsScreen.tsx:status': PDAS_CARD + ' LimitsScreen passes it on as statusState and reads statusState.status there.',
  'screens/Quality/Stations/QualityStations.tsx:range': RANGE_OMITS,
  'screens/Reports/ReportsScreen.tsx:range': RANGE_OMITS,
  'screens/Today/Today.tsx:range': RANGE_OMITS + ' Today falls back to line.dataAsOfUtc.',
  'ui/PeriodChip.tsx:range': RANGE_OMITS,
  'App.tsx:{period}':
    'only used to mount the simulator banner when a period exists (`period && <SimulatorBanner/>`); a failed plant clock means no banner, and PeriodChip (same shell) names the failure.',
  'screens/Reports/ReportsScreen.tsx:periodState':
    'the whole PeriodState is handed to Builder and PeriodChip names a failed plant clock ("unavailable"). OBSERVATION for the owner of Reports: with no period the preview stays on its loading skeleton and does not itself say why.',
  'sheets/ReasonSheet/ReasonSheet.tsx:{period}':
    'OBSERVATION for the owner of sheets: when the plant clock fails, the "days for this reason" part waits forever on a skeleton (the request is a never-settling promise) and the sheet does not say why; the shell PeriodChip behind the sheet names the failure. Degrades to a perpetual skeleton, never to a false figure.',
};

describe('GUARD 1: every useData/useMulti/usePeriod result has its failure read', () => {
  const hooks = discoverDataHooks(SOURCES);
  const uses = SOURCES.flatMap((s) => declsIn(s.code, hooks).map((d) => ({ ...d, rel: s.rel, code: s.code })));

  it('canary on the scan: web-next sources were found and the data hooks discovered', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES.some((s) => s.rel.includes('/bridge/'))).toBe(false);
    expect(hooks).toEqual(expect.arrayContaining(['useData', 'usePeriod', 'useProduction', 'useStationStatus', 'useMachinesRunning', 'useRange']));
    expect(uses.length).toBeGreaterThan(40);
  });

  it('canary on the rule: a synthetic result with no failure read fires, a read one stays quiet, a destructure is judged by its keys', () => {
    const bad = declsIn("const rows = useData('p', () => get(), 'k');\nconst t = rows.data?.total;", hooks);
    expect(bad.map((d) => surfaces("const t = rows.data?.total;", d))).toEqual([false]);
    const good = declsIn("const rows = useData<T>('p', () => get(), 'k');\nif (rows.status === 'error') return null;", hooks);
    expect(good.map((d) => surfaces("if (rows.status === 'error') return null;", d))).toEqual([true]);
    const dBad = declsIn('const { period } = usePeriod();', hooks);
    expect(dBad.map((d) => surfaces('', d))).toEqual([false]);
    const dGood = declsIn('const { period, status: ps } = usePeriod();', hooks);
    expect(dGood.map((d) => surfaces('', d))).toEqual([true]);
    const wrapped = declsIn('const prod = useProduction(period);', hooks);
    expect(wrapped).toHaveLength(1);
  });

  it('every result has its error/status read in its own file, or a written ALLOW_LIST entry', () => {
    const violations = uses
      .filter((u) => !surfaces(u.code, u) && ALLOW_LIST[`${u.rel}:${u.name}`] === undefined)
      .map((u) => `${u.rel}:${u.name}`);
    expect(
      violations,
      `these results never read .error / .status / .staleError / .failed in their file: ${violations.join(', ')}. A failed fetch would fall through to the empty or zero branch. Read it (see ErrorState usage in screens/Quality/Weight) or add an evidenced ALLOW_LIST entry.`,
    ).toEqual([]);
  });

  it('ALLOW_LIST names only declarations that still exist and still lack a read', () => {
    const stale = Object.keys(ALLOW_LIST).filter((k) => {
      const u = uses.find((x) => `${x.rel}:${x.name}` === k);
      return !u || surfaces(u.code, u);
    });
    expect(stale, `stale ALLOW_LIST entries: ${stale.join(', ')}`).toEqual([]);
  });
});

/* =========================================================================
 * GUARD 1B: no a.error ?? b.error blur
 * ========================================================================= */

const JOINT_RE = /\b([A-Za-z_$][\w$]*)\s*\??\.\s*(?:error|staleError)\s*(?:\?\?|\|\|)\s*([A-Za-z_$][\w$]*)\s*\??\.\s*(?:error|staleError)\b/g;
export function jointPairs(code: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of code.matchAll(JOINT_RE)) if (m[1] !== m[2]) out.push([m[1]!, m[2]!]);
  return out;
}

/**
 * Evidenced exceptions, keyed `${path}:${a}+${b}` (either order). Read at the
 * site (13 Oct 2026): in both cases the PART is named separately by the
 * surrounding code; only the technical cause string is shared.
 */
const ALLOW_LIST_JOINT: Record<string, string> = {
  'screens/Quality/Rejects/QualityRejects.tsx:periodQ+periodW':
    'figError for the headline rate tile: the two series (quality, weight) are one indivisible fact, and the tile status comes from kpiStatus(periodQ, periodW), so there is no partial figure to keep. Only the cause text is shared.',
  'screens/Quality/Rejects/QualityRejects.tsx:stations+products':
    'the filter-chip row ErrorState: part is chosen by which of the two has status error; the shared cause string is secondary, and a failure only degrades the toolbar, never a printed count.',
};

describe('GUARD 1B: two different results\' errors are not OR-combined into one message', () => {
  const found = SOURCES.flatMap((s) => jointPairs(s.code).map(([a, b]) => ({ rel: s.rel, a, b })));

  it('canary on the rule: it fires on a synthetic blur and ignores the same variable twice', () => {
    expect(jointPairs('cause={a.error ?? b.error}')).toEqual([['a', 'b']]);
    expect(jointPairs('x = a.error || b?.staleError')).toEqual([['a', 'b']]);
    expect(jointPairs('x = a.error ?? a.staleError')).toEqual([]);
  });

  it('every pair has a written ALLOW_LIST_JOINT entry', () => {
    const violations = found
      .filter((u) => ALLOW_LIST_JOINT[`${u.rel}:${u.a}+${u.b}`] === undefined && ALLOW_LIST_JOINT[`${u.rel}:${u.b}+${u.a}`] === undefined)
      .map((u) => `${u.rel}:${u.a}+${u.b}`);
    expect(violations, `these pairs blur two failures into one message: ${violations.join(', ')}. Name the failed part separately, or write an evidenced ALLOW_LIST_JOINT entry.`).toEqual([]);
  });

  it('ALLOW_LIST_JOINT names only pairs still in the source', () => {
    const stale = Object.keys(ALLOW_LIST_JOINT).filter((k) => {
      const [rel, pair] = k.split(':') as [string, string];
      const [a, b] = pair.split('+');
      return !found.some((u) => u.rel === rel && ((u.a === a && u.b === b) || (u.a === b && u.b === a)));
    });
    expect(stale, `stale ALLOW_LIST_JOINT entries: ${stale.join(', ')}`).toEqual([]);
  });
});

/* =========================================================================
 * GUARD 2A: the exact set of rank gates
 * ========================================================================= */

const RANK_CMP_RE = /\brank\s*(>=|<=|>|<|===|!==)\s*([A-Za-z0-9_$.]+(?:\[[^\]]*\])?)/g;
const MIN_RANK_RE = /\bminRank=\{([A-Za-z0-9_$.]+)\}/g;
/** Every `rank <op> TOKEN` and `minRank={TOKEN}` as `${file}: ${text}`, sorted. Gallery (dev-only) is excluded. */
export function rankTokens(rel: string, code: string): string[] {
  if (/^Gallery/.test(rel)) return [];
  const out: string[] = [];
  for (const m of code.matchAll(RANK_CMP_RE)) out.push(`${rel}: rank ${m[1]} ${m[2]}`);
  for (const m of code.matchAll(MIN_RANK_RE)) out.push(`${rel}: minRank=${m[1]}`);
  return out;
}

/**
 * The written list (13 Oct 2026, HEAD after T1 start; read from the source, not
 * from a brief). Reads are open to every signed-in account (ONE AUDIENCE); the
 * only read-tier gates are ADMIN_RANK on Setup (nav, tab bar, system tabs, the
 * Setup screen's own sentence) and the per-report minimum (REPORT_MIN_RANK,
 * the same table the server enforces). Everything else is a WRITE gate on
 * ENGINEER_RANK or EXPORT_MIN_RANK. A new gate changes this list: review it
 * against CLAUDE.md "The user base is ONE audience" and update it deliberately.
 */
const EXPECTED_RANK_TOKENS = [
  'screens/Products/Catalogue/ProductsCatalogue.tsx: rank >= ENGINEER_RANK',
  'screens/Products/Catalogue/ProductsCatalogue.tsx: rank >= ENGINEER_RANK',
  'screens/Products/Catalogue/ProductsCatalogue.tsx: rank >= ENGINEER_RANK',
  'screens/Products/Catalogue/ProductsCatalogue.tsx: minRank=ENGINEER_RANK',
  'screens/Products/Board/ProductsBoard.tsx: minRank=ENGINEER_RANK',
  'screens/Products/Changeover/ChangeoverScreen.tsx: rank < ENGINEER_RANK',
  'screens/Products/Changeover/ChangeoverScreen.tsx: rank >= ENGINEER_RANK',
  'screens/Products/Changeover/ChangeoverScreen.tsx: minRank=ENGINEER_RANK',
  'screens/Products/Limits/LimitsScreen.tsx: rank >= ENGINEER_RANK',
  'screens/Quality/Register/StockLedger.tsx: rank >= ENGINEER_RANK',
  'screens/Quality/Register/StockLedger.tsx: minRank=ENGINEER_RANK',
  'screens/Quality/Register/QualityRegister.tsx: minRank=EXPORT_MIN_RANK',
  'screens/Reports/Builder.tsx: rank < EXPORT_MIN_RANK',
  'screens/Reports/Builder.tsx: minRank=EXPORT_MIN_RANK',
  'screens/Reports/model.ts: rank >= REPORT_MIN_RANK[\'management-summary\']',
  'screens/Reports/model.ts: rank >= REPORT_MIN_RANK[type]',
  'screens/System/Diagnostics/DqFindings.tsx: minRank=ENGINEER_RANK',
  'screens/System/Setup/SetupScreen.tsx: rank >= ADMIN_RANK',
  'screens/System/Setup/SetupScreen.tsx: minRank=ADMIN_RANK',
  'screens/System/SystemTabs.tsx: rank >= ADMIN_RANK',
  'sheets/ReasonSheet/NameIt.tsx: rank >= ENGINEER_RANK',
  'sheets/ReasonSheet/NameIt.tsx: minRank=ENGINEER_RANK',
  'sheets/StationSheet/AdjustmentForm.tsx: minRank=ENGINEER_RANK',
  'ui/TabBar.tsx: rank >= ADMIN_RANK',
  'ui/WriteGate.tsx: rank < minRank',
  'ui/nav.ts: rank >= i.minRank',
].sort();

describe('GUARD 2A: the set of rank gates in web-next is exactly the written list', () => {
  it('canary on the scan: it sees both comparison shapes and skips Gallery', () => {
    expect(rankTokens('x.tsx', 'if (rank >= 4 && rank < ENGINEER_RANK) <WriteGate minRank={ADMIN_RANK}/>')).toEqual([
      'x.tsx: rank >= 4',
      'x.tsx: rank < ENGINEER_RANK',
      'x.tsx: minRank=ADMIN_RANK',
    ]);
    expect(rankTokens('Gallery.tsx', 'rank >= 9')).toEqual([]);
  });

  it('the rank comparisons and minRank tokens across web-next/src equal the written list', () => {
    const found = SOURCES.filter((s) => !s.rel.startsWith('extra/') || true).flatMap((s) => rankTokens(s.rel, s.code)).sort();
    expect(
      found,
      'The set of rank gates changed. A NEW read-tier gate (a screen or drilldown hidden behind a rank check) breaks ONE AUDIENCE (CLAUDE.md): roles gate writes only, plus the admin-only Setup. If the change is deliberate and reviewed, update EXPECTED_RANK_TOKENS with the reason.',
    ).toEqual(EXPECTED_RANK_TOKENS);
  });

  it('the ADMIN_RANK and ENGINEER_RANK constants still have the values this list assumes (4 and 2)', () => {
    const nav = readFileSync(`${SRC}ui/nav.ts`, 'utf8');
    const ranks = readFileSync(`${SRC}ranks.ts`, 'utf8');
    expect(/export const ADMIN_RANK\s*=\s*4\b/.test(nav)).toBe(true);
    expect(/export const ENGINEER_RANK\s*=\s*2\b/.test(ranks)).toBe(true);
  });
});
