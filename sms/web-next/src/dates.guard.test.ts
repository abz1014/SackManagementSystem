/**
 * One date format (fix-wave T6, defect D15 / VERIFY-V2-VISUAL "dates in six formats").
 *
 * Every date or clock the new app prints comes from `src/lib/fmt.ts` ("1 Sep 2026", "1 Sep 2026, 21:33",
 * "21:33", 24-hour, plant clock UTC-pinned, app instants in the viewer's zone). This guard fails when code
 * outside `src/lib/` formats a date another way:
 *  - toLocaleDateString / toLocaleTimeString / Intl.DateTimeFormat / toDateString / toUTCString,
 *  - toLocaleString with date or time options,
 *  - a month table or getMonth/getUTCMonth used to build text (a second formatter),
 *  - the old app's formatters reached through the bridge namespace (`fmt.fmtClock`, `fmt.fmtAppInstant`,
 *    `fmt.fmtDay...`) or imported by name (fmtClock, fmtAppInstant, fmtDay, fmtDayLong).
 * Number formatting through toLocaleString('en-GB') with digit options is NOT a date and is allowed.
 *
 * STATUS AT HEAD (13 Oct 2026): EXPECTED RED until T2-T5 (and the copy.ts fold) land; T7 confirms green.
 * The failure message lists every offender, which is the work list. Do not loosen a regex to make it pass.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/');
const EXTRA = process.env.SMS_GUARD_EXTRA_ROOT ? toPosix(process.env.SMS_GUARD_EXTRA_ROOT).replace(/\/*$/, '/') : null;

function stripComments(src: string): string {
  let inBlock = false;
  return src
    .split('\n')
    .map((l) => {
      const t = l.trimStart();
      if (inBlock) {
        if (t.includes('*/')) inBlock = false;
        return '';
      }
      if (t.startsWith('/*')) {
        if (!t.includes('*/')) inBlock = true;
        return '';
      }
      return t.startsWith('*') || t.startsWith('//') ? '' : l.replace(/\s\/\/\s.*$/, '');
    })
    .join('\n');
}
function list(dir: string, skip: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir.replace(/\/$/, '')}/${e.name}`;
    if (e.isDirectory()) return skip.includes(e.name) ? [] : list(full, skip);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const DATE_OPTION = /\b(?:hour|minute|second|month|day|year|weekday|era|dateStyle|timeStyle|timeZone|hour12|hourCycle|timeZoneName)\s*:/;

/** Offending lines of one source file, as "line N: text (why)". */
export function dateViolations(code: string): string[] {
  const out: string[] = [];
  code.split('\n').forEach((l, i) => {
    const at = (why: string) => out.push(`line ${i + 1}: ${l.trim().slice(0, 110)} (${why})`);
    if (/\.toLocale(?:Date|Time)String\b/.test(l)) at('toLocaleDateString/toLocaleTimeString');
    if (/\bIntl\.DateTimeFormat\b/.test(l)) at('Intl.DateTimeFormat');
    if (/\.(?:toDateString|toTimeString|toUTCString|toGMTString)\s*\(/.test(l)) at('Date to-string method');
    if (/\.toLocaleString\s*\(/.test(l) && DATE_OPTION.test(l)) at('toLocaleString with date options');
    if (/\.get(?:UTC)?Month\s*\(/.test(l)) at('month read to build text');
    if (/['"]Jan['"]\s*,\s*['"]Feb['"]/.test(l)) at('month-name table');
    if (/\bfmt\.fmt(?:Clock|AppInstant|Day\w*|Date\w*|Time\w*|Instant|Month\w*|Weekday\w*)\b/.test(l)) at('old date formatter through the bridge namespace');
    if (/(?<![.\w])(?:fmtClock|fmtAppInstant|fmtDayLong|fmtDay)\b/.test(l)) at('old date formatter by name');
  });
  return out;
}

function offenders(): Array<{ file: string; hits: string[] }> {
  const roots: Array<[string, string]> = [[SRC, '']];
  if (EXTRA) roots.push([EXTRA, 'extra/']);
  const out: Array<{ file: string; hits: string[] }> = [];
  for (const [root, prefix] of roots) {
    for (const f of list(root, ['bridge', 'lib', 'testkit', 'node_modules'])) {
      const rel = prefix + f.replace(root, '');
      if (/^Gallery/.test(rel)) continue;
      const hits = dateViolations(stripComments(readFileSync(f, 'utf8')));
      if (hits.length) out.push({ file: rel, hits });
    }
  }
  return out;
}

describe('dates: only src/lib/fmt.ts formats a date or a clock', () => {
  it('canary on the rule: every forbidden shape fires on a synthetic file, the sanctioned shapes stay quiet', () => {
    const bad = [
      'x = d.toLocaleDateString("en-GB");',
      'x = d.toLocaleTimeString();',
      'x = new Intl.DateTimeFormat("en-GB").format(d);',
      'x = d.toLocaleString("en-GB", { hour: "2-digit" });',
      'x = d.toUTCString();',
      'const m = d.getUTCMonth();',
      "const M = ['Jan', 'Feb', 'Mar'];",
      'x = fmt.fmtClock(ts);',
      'x = fmt.fmtAppInstant(ts);',
      'x = fmt.fmtDayLong(ts);',
      "import { fmtClock } from '../x'; x = fmtClock(t);",
    ].join('\n');
    const hits = dateViolations(bad);
    expect(hits.length).toBe(11);
    const ok = [
      "import { fmtDate, fmtTime, fmtDayShort, fmtAppDateTime } from '../../lib/fmt';",
      'x = n.toLocaleString("en-GB", { maximumFractionDigits: 2 });',
      'x = n.toLocaleString("en-US");',
      'x = fmt.fmtInt(3) + fmt.fmtG(4);',
      'x = d.getUTCDate() + 1;',
    ].join('\n');
    expect(dateViolations(ok)).toEqual([]);
  });

  it('canary: the scan reads the web-next screens (not lib/, bridge/ or tests)', () => {
    const files = list(SRC, ['bridge', 'lib', 'testkit', 'node_modules']);
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.endsWith('/lib/fmt.ts'))).toBe(false);
    expect(files.some((f) => f.includes('/bridge/'))).toBe(false);
  });

  it('no file outside src/lib/ formats a date or a clock by itself', () => {
    const bad = offenders();
    const text = bad.map((b) => `${b.file}\n    ${b.hits.join('\n    ')}`).join('\n');
    expect(
      bad.length,
      `${bad.length} file(s) format dates outside src/lib/fmt.ts (use fmtDate, fmtDateTime, fmtTime, fmtTimeSec, fmtDayShort, fmtRange or the fmtApp* variants):\n${text}`,
    ).toBe(0);
  });
});
