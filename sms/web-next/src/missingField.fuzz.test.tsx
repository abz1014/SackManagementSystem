/**
 * MISSING-FIELD FUZZ for the redesign (fix-wave T6, TRACE B6-11). Port of sms/web/src/missingField.fuzz.test.tsx.
 *
 * The text guards (reliability.guard.test.ts) cannot see the defect that shipped twice in the old app: a 200 OK
 * response with a hole in ONE field, where a comparison reads `undefined` the wrong way and the screen prints a
 * zero as if it had been measured. This test mounts the real <App/> over recorded fixtures
 * (layout-tests/next/support/fixtures/api.json), deletes ONE field at a time from every API body the screen asked
 * for (the field is removed from every row when it sits inside an array), and reads what lands on screen.
 *
 * THE ORACLE ("a confident zero"): the mutated page must not contain a zero figure that the unmutated page did
 * not already contain. A zero figure is the digit 0 (or 0.0) standing as a number before "%", a unit or a count
 * noun ("0 cones", "0%", "0 g"). Safe outcomes are a loading state, a named "could not load", a dash, or the
 * figure simply absent. Zero figures the baseline already shows are not counted (a quiet station is legitimately 0).
 *
 * Also asserted: when a missing field DOES make the page throw, the shell survives (TRACE G-30: the page boundary
 * says "couldn't load", the navigation stays). How many fields throw is logged per screen, not failed: a page that
 * cannot draw without a figure's container is a robustness note, while a printed zero is a false fact.
 * The zero outcome keeps a written allow-list (KNOWN_ZERO), each entry evidenced; an entry whose case no longer
 * fails is reported as stale (SMS_FUZZ_ALL=1 run) so it is deleted, never left to rot.
 *
 * COVERAGE, as numbers: screens fuzzed are listed in SCREENS below; per screen the fuzz is capped (MAX_PER_SCREEN
 * mutations) and covers figure-bearing fields (numbers, and objects or arrays holding numbers) to depth 4.
 * NOT covered: report bodies (old renderers, bridged), sheets, Wall, write forms, text/boolean-only fields.
 * jsdom computes no layout, so this says nothing about how a stripped field LOOKS, only about its text.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installDomStubs } from '../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type RouteRequest, type Routes } from '../../web/src/testkit/fetchRouter';
import { App } from './App';

installDomStubs();

type Fx = Record<string, { status: number; body: any }>;
const SMS_ROOT = typeof __dirname === 'string' ? resolve(__dirname, '../..') : process.cwd();
const FX: Fx = JSON.parse(readFileSync(resolve(SMS_ROOT, 'layout-tests/next/support/fixtures/api.json'), 'utf8'));

const PERIOD_KEYS = new Set(['from', 'to', 'tsTo', 'asOf', 'at', 'fromShift', 'toShift', 'shift', 'periodFrom', 'periodTo', 'p', 'cmp', 'compare']);
const keyOf = (pathname: string, search: URLSearchParams) => {
  const kept = [...search.entries()].filter(([k]) => !PERIOD_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return pathname + (kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '');
};
const lookup = (req: RouteRequest): { key: string; body: any } => {
  const k = keyOf(req.pathname, req.search);
  if (FX[k]) return { key: k, body: FX[k]!.body };
  if (FX[req.pathname]) return { key: req.pathname, body: FX[req.pathname]!.body };
  const hit = Object.entries(FX).find(([x]) => x.startsWith(req.pathname + '?'));
  if (hit) return { key: hit[0], body: hit[1].body };
  throw new Error(`no fixture for ${k}`);
};

/* ---- field enumeration and deletion (pure; the canaries below prove them) ---- */

export type Path = string[]; // '[]' means "every element of this array"
const hasNumber = (v: unknown, depth = 3): boolean =>
  typeof v === 'number' || (depth > 0 && v !== null && typeof v === 'object' && Object.values(v as object).some((x) => hasNumber(x, depth - 1)));

/** Figure-bearing field paths of a body, depth <= 4. Arrays are entered through their first element. */
export function fieldPaths(body: unknown, max = 60): Path[] {
  const out: Path[] = [];
  const walk = (v: unknown, path: Path, depth: number) => {
    if (out.length >= max || depth > 4 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (v.length > 0) walk(v[0], [...path, '[]'], depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (hasNumber(x)) out.push([...path, k]);
      walk(x, [...path, k], depth + 1);
    }
  };
  walk(body, [], 0);
  return out;
}

/** A deep copy with the field at `path` deleted (from every element when the path crosses an array). */
export function without(body: unknown, path: Path): unknown {
  const copy = JSON.parse(JSON.stringify(body));
  const go = (v: any, rest: Path): void => {
    if (v === null || typeof v !== 'object' || rest.length === 0) return;
    const [head, ...tail] = rest;
    if (head === '[]') {
      if (Array.isArray(v)) v.forEach((x) => go(x, tail));
      return;
    }
    if (tail.length === 0) delete v[head!];
    else go(v[head!], tail);
  };
  go(copy, path);
  return copy;
}

/**
 * Zero figures as they would read on screen: "0 cones", "0%", "0.0 g". Compared as bare tokens, with no surrounding text:
 * a neighbouring cell that turns into a dash or "No data" (correctly) must not make an unchanged legitimate zero look new
 * (13 Oct 2026: both former KNOWN_ZERO entries and a third candidate were exactly that, a baseline "0.0 %" failed-weight
 * share beside a cell that changed). A missing field that prints a zero where a figure stood still raises the count of that token.
 */
export const ZERO_RE = /(?<![\w.,\d-])0(?:\.0+)?(?:\s?%|\s(?:cones?|sacks?|weighed|rejected|rejects?|readings?|stations?|machines?|products?|g|kg|days?|failed|checked|inspected)\b)/g;
export function zeroFigures(text: string): string[] {
  return [...text.matchAll(ZERO_RE)].map((m) => m[0].replace(/\s+/g, ' ').trim());
}
/** Zero figures in `after` that `before` does not have (multiset difference). */
export function newZeroes(before: string[], after: string[]): string[] {
  const pool = [...before];
  const extra: string[] = [];
  for (const z of after) {
    const i = pool.indexOf(z);
    if (i >= 0) pool.splice(i, 1);
    else extra.push(z);
  }
  return extra;
}

/* ---- mounting ---- */

const textOf = (el: Element): string => {
  const parts: string[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.textContent?.trim();
    if (t && !(n.parentElement && /^(script|style)$/i.test(n.parentElement.tagName))) parts.push(t);
  }
  return parts.join(' ');
};
const LOADING = '.ui-skel, .kpi-skel, .ui-dt__skel, .ui-skel-chart, .ui-skel-kpis, .ck-skel, .skel';

interface Snapshot { text: string; crashed: boolean; shellAlive: boolean; requested: string[]; error: string }
let thrown: string[] = [];
let fake: FakeFetch | null = null;
async function mountAndRead(url: string, rank: string, mutate?: { key: string; path: Path }): Promise<Snapshot> {
  thrown = [];
  window.history.replaceState(null, '', url);
  const routes: Routes = {};
  for (const key of Object.keys(FX)) {
    const pathname = key.split('?')[0]!;
    routes[pathname] ??= (req: RouteRequest) => {
      const hit = lookup(req);
      return mutate && hit.key === mutate.key ? without(hit.body, mutate.path) : hit.body;
    };
  }
  routes['/api/auth/me'] = { user: { username: 'tester', displayName: 'Test User', role: rank } };
  routes['/api/auth/logout'] = { ok: true };
  fake = installFakeFetch(routes);
  const { container } = render(<App />);
  // settle: no loading placeholder and no new request for 200 ms, at most 5 s
  const t0 = Date.now();
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 40));
    const n = fake.requests.length;
    if (n !== lastCount) {
      lastCount = n;
      stableSince = Date.now();
    }
    if (Date.now() - stableSince > 140 && !container.querySelector(LOADING) && container.querySelector('main')) break;
  }
  const main = container.querySelector('main');
  const snap: Snapshot = {
    text: main ? textOf(main) : '',
    crashed: !!container.querySelector('.sh-page-error'),
    error: thrown[0] ?? '',
    shellAlive: !!container.querySelector('.sh-side, .sh-tabbar, .sh-top'),
    requested: [...new Set(fake.requests.map((r) => r.split('?')[0]!))],
  };
  const keys = new Set<string>();
  for (const r of fake.requests) {
    const u = new URL(r, 'http://x');
    try {
      keys.add(lookup({ pathname: u.pathname, search: u.searchParams, url: r }).key);
    } catch { /* unmocked */ }
  }
  snap.requested = [...keys];
  cleanup();
  fake.restore();
  fake = null;
  return snap;
}

// A missing field may make a screen throw; the shell's boundary catches it and this test counts it. React and jsdom would print every such throw.
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    for (const a of args) {
      if (a instanceof Error) thrown.push(a.message);
      else if (typeof a === 'string' && /TypeError|Cannot read|is not iterable|is not a function/.test(a)) thrown.push(a.slice(0, 120));
    }
  });
});

afterEach(() => {
  cleanup();
  fake?.restore();
  fake = null;
  window.history.replaceState(null, '', '/');
});

const PD1 = '&p=pick&from=2026-09-01&to=2026-09-01';
const SCREENS: Array<{ name: string; url: string }> = [
  { name: 'Today', url: `/next/?s=today${PD1}` },
  { name: 'Quality > Weight', url: `/next/?s=quality&t=weight&wt=cone&wm=time${PD1}` },
  { name: 'Quality > Rejects', url: `/next/?s=quality&t=rejects${PD1}` },
  { name: 'Quality > Stations', url: `/next/?s=quality&t=stations${PD1}` },
  { name: 'Quality > Register (cones)', url: `/next/?s=quality&t=register&rl=cones${PD1}` },
  { name: 'Products > Board', url: `/next/?s=products&t=board${PD1}` },
];
/** The gate runs an even sample of MAX_PER_SCREEN fields per screen; SMS_FUZZ_ALL=1 tries every field (slow, for recording KNOWN_* entries). */
const ALL = process.env.SMS_FUZZ_ALL === '1';
/** Red-proof hook (unset normally): SMS_FUZZ_IGNORE_ALLOWLIST=1 makes the recorded findings count as failures, proving the oracle fires on the real app. */
const IGNORE_ALLOWLIST = process.env.SMS_FUZZ_IGNORE_ALLOWLIST === '1';
const MAX_PER_SCREEN = ALL ? 100000 : 40;

/**
 * Evidenced exceptions. Key: `${screen} | ${fixture key} | ${path}`. Found by an exhaustive run (SMS_FUZZ_ALL=1) at
 * 224df3d on 13 Oct 2026 and recorded, not fixed (this task owns tests only). Delete an entry when its screen is
 * fixed: the exhaustive run reports it stale.
 */
const KNOWN_ZERO: Record<string, string> = {};

describe('fuzz helpers', () => {
  it('canary: fieldPaths finds figure-bearing fields through arrays, and without() deletes from every row', () => {
    const body = { data: { total: 5, label: 'x', rows: [{ n: 1, name: 'a' }, { n: 2, name: 'b' }], nested: { deep: { v: 3 } } } };
    const paths = fieldPaths(body).map((p) => p.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['data', 'data.total', 'data.rows', 'data.rows.[].n', 'data.nested', 'data.nested.deep', 'data.nested.deep.v']));
    expect(paths).not.toContain('data.label');
    const cut = without(body, ['data', 'rows', '[]', 'n']) as any;
    expect(cut.data.rows.every((r: any) => !('n' in r))).toBe(true);
    expect(cut.data.total).toBe(5);
    expect(body.data.rows[0]).toHaveProperty('n');
  });

  it('canary: the zero oracle fires on a confident zero and stays quiet on dashes and baseline zeroes', () => {
    const base = zeroFigures('Rejected 0 cones today, rate 1.2%');
    expect(newZeroes(base, zeroFigures('Rejected 0 cones today, rate 1.2%'))).toEqual([]);
    expect(newZeroes(base, zeroFigures('Rejected 0 cones today, rate 0%')).length).toBe(1);
    expect(newZeroes(base, zeroFigures('Rejected - cones today, rate -'))).toEqual([]);
    expect(zeroFigures('0 weighed, 402 rejected (0%)').length).toBe(2);
    expect(zeroFigures('100 cones, 1.05 g, 20%, 2026')).toEqual([]);
    // a changed neighbour cell does not make an unchanged zero new
    expect(newZeroes(zeroFigures('1.2 % 12 cones 0.0 % 4.2 g'), zeroFigures('No data 0.0 % 4.2 g'))).toEqual([]);
    // but a zero standing where a figure was does
    expect(newZeroes(zeroFigures('1.2 % 12 cones 4.2 g'), zeroFigures('0.0 % 12 cones 4.2 g')).length).toBe(1);
    expect(newZeroes(zeroFigures('0.0 % x'), zeroFigures('0.0 % x 0.0 % y')).length).toBe(1);
  });
});

for (const screen of SCREENS.filter((x) => !process.env.SMS_FUZZ_ONLY || x.name.includes(process.env.SMS_FUZZ_ONLY))) {
  describe(`missing field: ${screen.name}`, () => {
    it('never prints a confident zero for a missing field, and never takes the page down', async () => {
      const base = await mountAndRead(screen.url, 'manager');
      expect(base.text.length, `${screen.name}: the baseline page drew nothing`).toBeGreaterThan(80);
      expect(base.crashed, `${screen.name}: the baseline page crashed`).toBe(false);
      const baseZeroes = zeroFigures(base.text);

      const cases: Array<{ key: string; path: Path }> = [];
      // The whole `data` payload missing is a malformed envelope, not a missing field; fields inside it are the subject.
      for (const key of base.requested.sort()) for (const path of fieldPaths(FX[key]!.body, 40)) if (!(path.length === 1 && (path[0] === 'data' || path[0] === 'metadata'))) cases.push({ key, path });
      const picked = cases.length > MAX_PER_SCREEN ? cases.filter((_, i) => i % Math.ceil(cases.length / MAX_PER_SCREEN) === 0) : cases;
      expect(picked.length, `${screen.name}: no fields to fuzz (fixtures or requests changed)`).toBeGreaterThan(5);

      const zeroHits: string[] = [];
      const shellLost: string[] = [];
      let crashes = 0;
      const crashIds: string[] = [];
      const seenKnown = new Set<string>();
      for (const c of picked) {
        const id = `${screen.name} | ${c.key} | ${c.path.join('.')}`;
        const snap = await mountAndRead(screen.url, 'manager', c);
        if (snap.crashed) {
          crashes++;
          crashIds.push(`${id}   ::  ${snap.error}`);
          if (!snap.shellAlive) shellLost.push(id);
        }
        const extra = newZeroes(baseZeroes, zeroFigures(snap.text));
        if (extra.length) {
          if (KNOWN_ZERO[id] !== undefined && !IGNORE_ALLOWLIST) seenKnown.add(id);
          else zeroHits.push(`${id} -> ${JSON.stringify(extra)}`);
        }
      }
      expect(zeroHits, `${zeroHits.length} field(s) whose absence prints a confident zero on ${screen.name} (${picked.length} of ${cases.length} fields tried):\n${zeroHits.join('\n')}`).toEqual([]);
      if (process.env.SMS_FUZZ_LOG) appendFileSync(process.env.SMS_FUZZ_LOG, crashIds.map((c) => `CRASH ${c}\n`).join(''));
      console.info(`[fuzz] ${screen.name}: ${picked.length} of ${cases.length} fields tried, ${crashes} made the page throw (shell kept)`);
      expect(crashIds, `${crashIds.length} missing field(s) made ${screen.name} throw (a page must name the part, never crash):\n${crashIds.join('\n')}`).toEqual([]);
      expect(shellLost, `these missing fields took the whole shell down, not just the page: ${shellLost.join(' ; ')}`).toEqual([]);
      const stale = ALL ? Object.keys(KNOWN_ZERO).filter((k) => k.startsWith(screen.name + ' |') && !seenKnown.has(k)) : [];
      expect(stale, 'allow-list entries that no longer fail (delete them)').toEqual([]);
    }, ALL ? 1_800_000 : 240_000);
  });
}
