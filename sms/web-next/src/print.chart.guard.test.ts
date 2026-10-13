/**
 * Port of sms/web/src/print.chart.guard.test.ts to the redesign (fix-wave T6, TRACE B6-05).
 *
 * Owner decision (chart overhaul): print gets no tooltip, no resize handle and no "Zoomed in - Back" control.
 * The shared chart base (web/src/ui/ChartFrame.tsx, reused through bridge/chart.ts) already skips them in React
 * when sizing for print; this is the CSS suspenders: `@media print` in web-next must still hide
 * `.chart-tip`, `.chart-resize` and `.no-print`, and the zoom Back control must sit inside a `.no-print` element.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/');
const CHART_FRAME = fileURLToPath(new URL('../../web/src/ui/ChartFrame.tsx', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir.replace(/\/$/, '')}/${e.name}`;
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : cssFiles(full)) : e.name.endsWith('.css') ? [full] : [];
  });
}

export function printBlocksOf(css: string): string[] {
  return [...css.matchAll(/@media print\s*\{/g)].map((m) => {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    return css.slice(start, i - 1);
  });
}
/** True when some rule in a print block lists `cls` in its selector and declares display:none. */
export function hiddenInPrint(blocks: string[], cls: string): boolean {
  const esc = cls.replace(/\./g, '\\.');
  return blocks.some((b) =>
    [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((m) => new RegExp(String.raw`(^|[\s,])${esc}(?![\w-])`).test(m[1]!) && /display:\s*none/.test(m[2]!)),
  );
}

/** SMS_GUARD_CSS_DIR (test hook, unset normally): read the stylesheets from this directory instead, for the red-proof. */
const CSS_ROOT = process.env.SMS_GUARD_CSS_DIR ? process.env.SMS_GUARD_CSS_DIR.split(String.fromCharCode(92)).join('/') : SRC;
const BLOCKS = cssFiles(CSS_ROOT).flatMap((f) => printBlocksOf(readFileSync(f, 'utf8')));

describe('chart overlays are hidden under @media print (web-next)', () => {
  it('canary on the helpers: a synthetic print block is judged correctly', () => {
    const css = '@media print { .a, .chart-tip { display: none !important; } .b { color: red; } }';
    const b = printBlocksOf(css);
    expect(hiddenInPrint(b, '.chart-tip')).toBe(true);
    expect(hiddenInPrint(b, '.a')).toBe(true);
    expect(hiddenInPrint(b, '.b')).toBe(false);
    expect(hiddenInPrint(b, '.chart-tip-x')).toBe(false);
    expect(hiddenInPrint(printBlocksOf('.chart-tip { display: none }'), '.chart-tip')).toBe(false);
  });

  it('canary: web-next has @media print blocks', () => {
    expect(BLOCKS.length).toBeGreaterThan(3);
  });

  it.each(['.chart-tip', '.chart-resize', '.no-print'])('%s is display:none inside @media print', (cls) => {
    expect(hiddenInPrint(BLOCKS, cls), `no @media print rule hides ${cls}; a printed page would carry the on-screen control`).toBe(true);
  });

  it('the zoom Back control is wrapped in a .no-print element in the shared ChartFrame', () => {
    const src = readFileSync(CHART_FRAME, 'utf8');
    const i = src.indexOf('W.chart.zoomedBack');
    expect(i, 'ChartFrame no longer renders W.chart.zoomedBack').toBeGreaterThan(0);
    const before = src.slice(Math.max(0, i - 700), i);
    const open = before.lastIndexOf('<p');
    expect(open, 'the Back button has no wrapping element').toBeGreaterThanOrEqual(0);
    expect(/className="no-print"/.test(before.slice(open)), 'the zoom Back control is not inside a no-print element').toBe(true);
  });
});
