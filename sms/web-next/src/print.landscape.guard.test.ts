/**
 * Port of sms/web/src/print.landscape.guard.test.ts to the redesign (fix-wave T6, TRACE B6-04).
 *
 * `@page` is a document-level at-rule: it cannot be scoped by an ordinary selector, so the Reports print
 * stylesheet binds the NAMED pages to a stable class hook on the shell's <main> (decision E-6), never to a
 * translatable aria-label. This guard fails when:
 *  - either named page (report-landscape A4 landscape, report-portrait A4 portrait) disappears,
 *  - a named page loses its "Page X of Y" footer,
 *  - `main.report-print` no longer selects `page: report-landscape`, or the portrait override stops winning,
 *  - the Reports screen stops putting the hook class on <main>,
 *  - the binding is moved onto a text-dependent selector (aria-label).
 *
 * Reads files off disk (node:fs); no DOM. Resolves the real values rather than hard-coding a second copy.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/');
const REPORTS_DIR = `${SRC}screens/Reports`;

export function pageRule(css: string, name: string): string | null {
  const m = new RegExp(String.raw`@page\s+${name}\s*\{`).exec(css);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(start, i - 1);
}
export const hasSize = (rule: string | null, size: RegExp) => !!rule && size.test(rule);
export const hasPageFooter = (rule: string | null) => !!rule && /counter\(page\)/.test(rule) && /counter\(pages\)/.test(rule);
export const bindsPage = (css: string, selectorRe: RegExp, page: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((m) => selectorRe.test(m[1]!.trim()) && new RegExp(String.raw`page:\s*${page}\b`).test(m[2]!));

/** SMS_GUARD_CSS_DIR (test hook, unset normally): read the stylesheets from this directory instead, for the red-proof. */
const CSS_DIR = process.env.SMS_GUARD_CSS_DIR ? process.env.SMS_GUARD_CSS_DIR.split(String.fromCharCode(92)).join('/') : null;
const readCssIn = (dir: string, only?: string[]) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.css') && (!only || only.includes(f)))
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
    .join('\n');
const CSS = CSS_DIR ? readCssIn(CSS_DIR) : readCssIn(REPORTS_DIR, ['print.css', 'reports.css']) + readCssIn(`${SRC}styles`);
const SCREEN = readFileSync(`${REPORTS_DIR}/ReportsScreen.tsx`, 'utf8');

describe('web-next report print: named pages and the stable class hook', () => {
  it('canary on the rule helpers: they find a synthetic page rule and judge it', () => {
    const fake = '@page foo { size: A4 landscape; @bottom-left { content: counter(page) " of " counter(pages); } }\nmain.x { page: foo; }';
    expect(hasSize(pageRule(fake, 'foo'), /A4\s+landscape/)).toBe(true);
    expect(hasPageFooter(pageRule(fake, 'foo'))).toBe(true);
    expect(bindsPage(fake, /^main\.x$/, 'foo')).toBe(true);
    expect(pageRule(fake, 'missing')).toBeNull();
    expect(hasPageFooter('size: A4;')).toBe(false);
    expect(bindsPage('main.x { color: red; }', /^main\.x$/, 'foo')).toBe(false);
  });

  it('canary: the stylesheets were read', () => {
    expect(CSS.length).toBeGreaterThan(1000);
    expect(SCREEN.length).toBeGreaterThan(1000);
  });

  it('@page report-landscape is A4 landscape and carries "Page X of Y"', () => {
    const r = pageRule(CSS, 'report-landscape');
    expect(hasSize(r, /size:\s*A4\s+landscape/), 'no @page report-landscape { size: A4 landscape }').toBe(true);
    expect(hasPageFooter(r), 'report-landscape lost its "Page X of Y" margin box').toBe(true);
  });

  it('@page report-portrait is A4 portrait and carries "Page X of Y"', () => {
    const r = pageRule(CSS, 'report-portrait');
    expect(hasSize(r, /size:\s*A4\s+portrait/), 'no @page report-portrait { size: A4 portrait }').toBe(true);
    expect(hasPageFooter(r), 'report-portrait lost its "Page X of Y" margin box').toBe(true);
  });

  it('main.report-print selects report-landscape; the portrait hook overrides it and comes later in source', () => {
    expect(bindsPage(CSS, /^main\.report-print$/, 'report-landscape'), 'main.report-print { page: report-landscape } is missing').toBe(true);
    expect(bindsPage(CSS, /^main\.report-print:has\(\[data-report-orientation="portrait"\]\)$/, 'report-portrait'), 'the portrait override is missing').toBe(true);
    expect(CSS.indexOf('main.report-print { page: report-landscape')).toBeLessThan(CSS.indexOf('main.report-print:has([data-report-orientation="portrait"])'));
  });

  it('the page binding does not depend on a label a copy edit could change', () => {
    const bound = [...CSS.matchAll(/([^{}]+)\{([^{}]*page:\s*report-(?:landscape|portrait)[^{}]*)\}/g)].map((m) => m[1]!);
    expect(bound.length).toBeGreaterThan(1);
    expect(
      bound.some((s) => /aria-label|\[role=/.test(s)),
      `page binding keyed to text or role: ${bound.join(' | ')}`,
    ).toBe(false);
  });

  it('ReportsScreen puts the hook class on <main> while mounted and removes it on leave', () => {
    expect(/classList\.add\('report-print'\)/.test(SCREEN), 'ReportsScreen no longer adds report-print').toBe(true);
    expect(/classList\.remove\('report-print'\)/.test(SCREEN), 'ReportsScreen no longer removes report-print on unmount').toBe(true);
    expect(/closest\('main'\)/.test(SCREEN)).toBe(true);
  });
});
