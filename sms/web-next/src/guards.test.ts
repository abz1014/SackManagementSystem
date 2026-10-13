/**
 * Source guards that only apply to the redesign (sms/web-next). The older
 * guards in sms/web/src (api callers, polling errors, targets, ranks, print)
 * already scan web-next too; these five are new rules from the redesign
 * contract (design/redesign-2026-10/TRACE.md section B6 and E).
 *
 * Deliberately dumb, in the older guards' idiom: read source off disk with
 * node:fs, strip comments, regex. Each rule is a pure function over source
 * text, so a canary can prove it fires on a synthetic violation and stays
 * quiet on the sanctioned shape. A hit is a decision for a human: fix the
 * code, never loosen the regex to make a run green.
 *
 *  1. No `?? 0` / `|| 0` on fetched data (a failed or missing fetch must not
 *     read as a confident zero).
 *  2. No StatusPill / state prop decided by a numeric comparison in the view
 *     (the server or lib/ decides a state; a screen must not invent one).
 *  3. No "Assumed" wording written into a screen (it lives in copy.ts RESERVED
 *     and is referenced, so the owner-reserved sentence never forks).
 *  4. A server `disabledReason` is shown verbatim: no replace, case change,
 *     trim, slice, concatenation or template wrapping.
 *  5. The 14-day detector fields `flagged` / `projection` never decide a
 *     period or state (detectors ignore the period; THE DETECTORS IGNORE THE
 *     PERIOD, CLAUDE.md redesign rule 3).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/');

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
/** Source with comment-only lines blanked (line numbers preserved). */
function stripComments(src: string): string {
  const lines = src.split('\n');
  const mask = commentMask(lines);
  return lines.map((l, i) => (mask[i] ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === 'bridge' || e.name === 'testkit' || e.name === 'node_modules') continue;
      out.push(...listFiles(full));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = listFiles(SRC.replace(/\/$/, ''));
const rel = (f: string) => f.replace(SRC, '');

/* ---- rule functions: source text -> offending line descriptions ---------- */

const USES_FETCHED_DATA_RE = /\b(?:useData|usePolling|useMulti|usePeriod)\b|from\s+['"][./]*data(?:\/[^'"]*)?['"]/;
function rule1(code: string): string[] {
  if (!USES_FETCHED_DATA_RE.test(code)) return [];
  const hits: string[] = [];
  code.split('\n').forEach((l, i) => {
    if (/(?:\?\?|\|\|)\s*0(?![\w.])/.test(l)) hits.push(`line ${i + 1}: ${l.trim()}`);
  });
  return hits;
}

function rule2(code: string): string[] {
  const hits: string[] = [];
  code.split('\n').forEach((l, i) => {
    const flat = l.replace(/=>/g, '  ');
    const cmp = /(?:>=|<=|(?<![<])>(?![>])|<(?![/A-Za-z]))/;
    const attr = /\bstate=\{([^}]*)\}/.exec(flat);
    if (attr && cmp.test(attr[1]!) && attr[1]!.includes('?')) {
      hits.push(`line ${i + 1}: ${l.trim()}`);
      return;
    }
    const prop = /\b(?:state|[a-z]+State)\s*[:=]\s*([^;,\n]*\?[^;\n]*)/.exec(flat);
    if (prop && cmp.test(prop[1]!.split('?')[0]!)) hits.push(`line ${i + 1}: ${l.trim()}`);
  });
  return hits;
}

function rule3(code: string): string[] {
  const hits: string[] = [];
  code.split('\n').forEach((l, i) => {
    if (/\bAssumed\b/.test(l)) hits.push(`line ${i + 1}: ${l.trim()}`);
  });
  return hits;
}

const DR_MANGLE_RE = new RegExp(
  [
    String.raw`disabledReason\s*(?:\?\.|\.)\s*(?:replace|replaceAll|toLowerCase|toUpperCase|trim|slice|substring|substr|split|concat|padStart|padEnd|charAt)\b`,
    String.raw`disabledReason\s*\+`,
    String.raw`\+\s*[\w.?]*disabledReason`,
    String.raw`\$\{[^}]*disabledReason`,
  ].join('|'),
);
function rule4(code: string): string[] {
  const hits: string[] = [];
  code.split('\n').forEach((l, i) => {
    if (DR_MANGLE_RE.test(l)) hits.push(`line ${i + 1}: ${l.trim()}`);
  });
  return hits;
}

function rule5(code: string, file: string): string[] {
  const hits: string[] = [];
  const inData = /(^|\/)data\//.test(file) || /Period/.test(file.split('/').pop()!);
  code.split('\n').forEach((l, i) => {
    if (!/(?:\.|\b)(?:flagged|projection)\b/.test(l)) return;
    if (inData || /period|state/i.test(l)) hits.push(`line ${i + 1}: ${l.trim()}`);
  });
  return hits;
}

/* ---- the scan ------------------------------------------------------------ */

function scan(rule: (code: string, file: string) => string[]): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    for (const h of rule(stripComments(readFileSync(f, 'utf8')), rel(f))) out.push(`${rel(f)} ${h}`);
  }
  return out;
}

describe('web-next guards', () => {
  it('canary: web-next/src was scanned', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.map(rel)).toContain('App.tsx');
    expect(FILES.map(rel)).toContain('copy.ts');
  });

  describe('1. no ?? 0 / || 0 on fetched data', () => {
    it('canary: fires on a fetched-data zero default, quiet without a fetch hook and on a non-zero default', () => {
      expect(rule1('const d = useData(x);\nconst n = d.data?.count ?? 0;')).toHaveLength(1);
      expect(rule1('const d = useData(x);\nconst n = a || 0;')).toHaveLength(1);
      expect(rule1("import { x } from './data';\nconst n = a ?? 0;")).toHaveLength(1);
      expect(rule1('const n = a ?? 0;')).toEqual([]);
      expect(rule1('const d = useData(x);\nconst n = a ?? 0.5;\nconst m = b ?? null;')).toEqual([]);
    });
    it('no file that fetches data defaults a value to zero', () => {
      expect(scan(rule1)).toEqual([]);
    });
  });

  describe('2. no state computed from a numeric comparison', () => {
    it('canary: fires on state={x > y ? ...}, a state const and a state: property; quiet on a passed-through state', () => {
      expect(rule2("<StatusPill state={n > 3 ? 'bad' : 'ok'} />")).toHaveLength(1);
      expect(rule2("const state = rate >= limit ? 'warn' : 'ok';")).toHaveLength(1);
      expect(rule2("return { state: a < b ? 'x' : 'y' };")).toHaveLength(1);
      expect(rule2('<StatusPill state={it.state} />')).toEqual([]);
      expect(rule2("const state = row.status === 'x' ? 'warn' : 'ok';")).toEqual([]);
      expect(rule2('const f = useCallback((a) => a, []); <StatusPill state={s} />')).toEqual([]);
    });
    it('no StatusPill / state prop is decided by <, >, <= or >=', () => {
      expect(scan(rule2)).toEqual([]);
    });
  });

  describe('3. no "Assumed" wording outside copy.ts (RESERVED)', () => {
    it('canary: fires on a hard-coded Assumed sentence', () => {
      expect(rule3("<h2>Assumed until IFL confirms</h2>")).toHaveLength(1);
      expect(rule3('<h2>{C.assumed}</h2>')).toEqual([]);
    });
    it('copy.ts still holds the RESERVED wording this rule protects', () => {
      expect(/Assumed/.test(readFileSync(`${SRC}copy.ts`, 'utf8'))).toBe(true);
    });
    it('no other file writes "Assumed" itself', () => {
      const hits: string[] = [];
      for (const f of FILES) {
        if (rel(f) === 'copy.ts') continue;
        for (const h of rule3(stripComments(readFileSync(f, 'utf8')))) hits.push(`${rel(f)} ${h}`);
      }
      expect(hits).toEqual([]);
    });
  });

  describe('4. disabledReason is rendered unmodified', () => {
    it('canary: fires on replace, toLowerCase, concatenation and template wrapping; quiet on verbatim use', () => {
      expect(rule4('<span>{disabledReason.toLowerCase()}</span>')).toHaveLength(1);
      expect(rule4("<span>{o.disabledReason?.replace('a', 'b')}</span>")).toHaveLength(1);
      expect(rule4("<span>{'Note: ' + disabledReason}</span>")).toHaveLength(1);
      expect(rule4('<span>{`Off: ${disabledReason}`}</span>')).toHaveLength(1);
      expect(rule4('<span>{disabledReason}</span>')).toEqual([]);
      expect(rule4('title={o.disabledReason} disabled={!!o.disabledReason}')).toEqual([]);
    });
    it('no file rewrites a disabledReason', () => {
      expect(scan(rule4)).toEqual([]);
    });
    it('canary: the scan reaches the file that renders it', () => {
      expect(FILES.map(rel)).toContain('ui/WriteGate.tsx');
      expect(/disabledReason/.test(readFileSync(`${SRC}ui/WriteGate.tsx`, 'utf8'))).toBe(true);
    });
  });

  describe('5. flagged / projection do not decide period or state', () => {
    it('canary: fires inside data/ and on a line that also names period or state; quiet elsewhere', () => {
      expect(rule5('const p = r.flagged;', 'data/usePeriod.ts')).toHaveLength(1);
      expect(rule5("const state = r.projection ? 'a' : 'b';", 'screens/X.tsx')).toHaveLength(1);
      expect(rule5("if (r.flagged) setPeriod('today');", 'screens/X.tsx')).toHaveLength(1);
      expect(rule5('rows.filter((r) => r.flagged)', 'screens/X.tsx')).toEqual([]);
      expect(rule5('const p = r.projection;', 'screens/X.tsx')).toEqual([]);
    });
    it('no web-next file lets flagged / projection decide a period or state', () => {
      expect(scan(rule5)).toEqual([]);
    });
  });
});
