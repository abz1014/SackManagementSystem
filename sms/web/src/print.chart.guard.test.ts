/**
 * Guard for the chart overhaul's print rule (Task T3, 28 Sep 2026; the
 * brush itself was removed in wave 4, Task W1, 29 Sep 2026 — click-to-zoom
 * replaced drag-to-select, so there is no `.chart-brush` left to guard): the
 * owner decision is that print gets no tooltip and no resize handle —
 * fixed width, default height, exactly `useChartSize.ts`'s own
 * `print` branch already gives it. `ChartFrame.tsx` also skips rendering
 * these elements in React when `size.print` is true, but that is a
 * behavioural belt; this is the CSS suspenders — if a future edit ever
 * mounts one of these nodes unconditionally (a regression this file exists
 * to catch even then), `@media print` must still hide it.
 *
 * Same idiom as `print.landscape.guard.test.ts`: reads `app.css` straight
 * off disk with node:fs and asserts on the text, no DOM, no import of the
 * real stylesheet (`vitest.config.ts`'s default `environment: 'node'`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_SRC = fileURLToPath(new URL('.', import.meta.url));
const APP_CSS = `${WEB_SRC}app.css`;
const WEB_NEXT_STYLES = fileURLToPath(new URL('../../web-next/src/styles', import.meta.url));
const WEB_NEXT_REPORTS = fileURLToPath(new URL('../../web-next/src/screens/Reports', import.meta.url));
const WEB_NEXT_CSS = [WEB_NEXT_STYLES, WEB_NEXT_REPORTS].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => `${dir}/${f}`),
);

const CHART_PRINT_CLASSES = ['.chart-tip', '.chart-resize'];

function printBlocksOf(cssSrc: string): string[] {
  return [...cssSrc.matchAll(/@media print\s*\{/g)].map((m) => {
    const start = m.index! + m[0].length;
    // Balance braces from `start` to find this @media block's own closing `}`.
    let depth = 1;
    let i = start;
    for (; i < cssSrc.length && depth > 0; i++) {
      if (cssSrc[i] === '{') depth++;
      else if (cssSrc[i] === '}') depth--;
    }
    return cssSrc.slice(start, i);
  });
}

function checkChartPrint(label: string, printBlocks: string[]) {
  it.each(CHART_PRINT_CLASSES)(`${label}: %s is hidden ("display: none") somewhere inside @media print`, (cls) => {
    const escaped = cls.replace('.', '\\.');
    const hiddenRe = new RegExp(`${escaped}[^{]*\\{[^}]*display:\\s*none`);
    const hiddenInAnyBlock = printBlocks.some((block) => hiddenRe.test(block));
    expect(
      hiddenInAnyBlock,
      `no @media print rule in ${label} sets "${cls} { display: none ... }" — a printed page would show the ` +
        `on-screen tooltip/handle/brush the owner decided print should never carry (Task T3, 28 Sep 2026).`,
    ).toBe(true);
  });
}

describe('chart overlay classes are hidden under @media print (web/src/app.css)', () => {
  const printBlocks = printBlocksOf(readFileSync(APP_CSS, 'utf8'));

  it('sanity: app.css has at least one @media print block (canary on the scan itself)', () => {
    expect(printBlocks.length, 'no @media print block found in app.css at all').toBeGreaterThan(0);
  });

  checkChartPrint('app.css', printBlocks);
});

describe('chart overlay classes are hidden under @media print (web-next/src/styles/*.css, screens/Reports/*.css)', () => {
  it('canary: web-next stylesheets were found', () => {
    expect(WEB_NEXT_CSS.length).toBeGreaterThan(0);
  });

  const printBlocks = WEB_NEXT_CSS.flatMap((f) => printBlocksOf(readFileSync(f, 'utf8')));
  it('canary: web-next has at least one @media print block (the Reports print stylesheet)', () => {
    expect(printBlocks.length, 'no @media print block in web-next at all').toBeGreaterThan(0);
  });
  checkChartPrint('web-next', printBlocks);
});
