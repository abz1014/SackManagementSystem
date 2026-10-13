/**
 * Uniformity guard (design/redesign-2026-10/DESIGN-SYSTEM.md section 7, rules 5, 11, 13).
 *
 * Scans every file under web-next/src (except the token sheets, tests and the bridge) for:
 *   1. raw colours: hex, rgb()/rgba(), hsl()/hsla()                 (rule 11)
 *   2. raw font sizes: px / rem / em literals, numeric fontSize     (rule 11)
 *   3. gradients other than the status band and the bar gradient    (rule 13)
 *   4. state-colour tokens (--ok-*, --watch-*, --act-*, --nodata-*)
 *      outside the components that may speak in state colour        (rule 5)
 *
 * Deliberately dumb, in the idiom of guards.test.ts: read source off disk, strip comments, regex. A hit is a
 * decision for a human: fix the code, or add an ALLOW entry below WITH its reason. Never loosen a regex.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '/');

const EXCLUDE = [/^styles\/tokens\.css$/, /^styles\/wall-dark\.css$/, /\.test\.tsx?$/, /^bridge\//, /^tests?\//];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = dir + name;
    if (statSync(p).isDirectory()) walk(p + '/', out);
    else if (/\.(css|tsx?)$/.test(name)) out.push(p.slice(SRC.length));
  }
  return out;
}

/** Remove block and line comments, keeping line numbers. Line comments only when `//` is not part of a URL. */
export function stripComments(src: string, css: boolean): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (!css) out = out.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_m, pre: string) => pre);
  return out;
}

export interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const RULES: Array<{ rule: string; re: RegExp; cssOnly?: boolean; tsOnly?: boolean }> = [
  { rule: 'raw-colour', re: /#[0-9a-fA-F]{3,8}\b(?![-\w])/ },
  { rule: 'raw-colour', re: /\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/i },
  { rule: 'raw-font-size', re: /font-size\s*:\s*(?!var\(|inherit|0\b)[^;}]*?\d(?:px|rem|em|pt)\b/i, cssOnly: true },
  { rule: 'raw-font-size', re: /fontSize\s*:\s*(?:\d|['"`]\s*\d)/, tsOnly: true },
  { rule: 'gradient', re: /(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(|<linearGradient|<radialGradient/ },
];

/** Sanctioned exceptions. Every entry carries its reason; keep this list short. */
export const ALLOW: Array<{ rule: string; file: RegExp; text?: RegExp; why: string }> = [
  {
    rule: 'gradient',
    file: /^styles\/base\.css$/,
    text: /\.band\b/,
    why: 'The status band: the ONE gradient (DESIGN-SYSTEM 7.13). Stops come from --band-* tokens.',
  },
  {
    rule: 'gradient',
    file: /^styles\/base\.css$/,
    text: /\.skel\b/,
    why: 'Loading shimmer built from neutral surface tokens only; carries no colour meaning (it is not a data or decoration gradient).',
  },
  {
    rule: 'raw-colour',
    file: /^styles\/base\.css$/,
    text: /\.band\b/,
    why: 'White inner hairline of the status band, a highlight not a palette colour; the band itself is the single approved gradient.',
  },
  {
    rule: 'gradient',
    file: /^ui\/components\/Skeleton\.css$/,
    why: 'Skeleton shimmer highlight; neutral white sweep, no colour meaning.',
  },
  {
    rule: 'raw-colour',
    file: /^ui\/components\/Skeleton\.css$/,
    why: 'Same shimmer: a translucent white highlight over the skeleton surface.',
  },
  {
    rule: 'gradient',
    file: /^ui\/components\/(DataTable|Tabs)\.css$/,
    why: 'Scroll-edge fade / mask that tells a reader more content is hidden (CSS-073). Transparent to a surface token; no colour of its own.',
  },
  {
    rule: 'gradient',
    file: /^charts\/(BarChart|Histogram|Pareto|Frame)\.tsx$/,
    text: /--bar-(from|to)|linearGradient/,
    why: 'The single-series bar gradient (--bar-from to --bar-to), explicitly approved by DESIGN-SYSTEM 7.13.',
  },
];

function scanSource(file: string, raw: string): Hit[] {
  const css = file.endsWith('.css');
  const lines = stripComments(raw, css).split('\n');
  const hits: Hit[] = [];
  lines.forEach((text, i) => {
    for (const r of RULES) {
      if (r.cssOnly && !css) continue;
      if (r.tsOnly && css) continue;
      if (r.re.test(text)) hits.push({ file, line: i + 1, rule: r.rule, text: text.trim() });
    }
  });
  return hits;
}

function allowed(h: Hit): boolean {
  return ALLOW.some((a) => a.rule === h.rule && a.file.test(h.file) && (!a.text || a.text.test(h.text)));
}

/** Files allowed to speak in state colour (DESIGN-SYSTEM 7.5), with the reason. */
export const STATE_COLOUR_OK: Array<{ file: RegExp; why: string }> = [
  { file: /^ui\/(StatusPill|KpiCard|StationTile|StationHeatGrid|AttentionList|HealthDot|WriteGate)\.tsx$/, why: 'The named state surfaces.' },
  { file: /^components\/state\.css$/, why: 'Stylesheet of the state surfaces (pill, KPI edge, tile, attention row, health dot).' },
  { file: /^charts\/(LimitBand|LineChart)\.tsx$/, why: 'Out-of-limit ring and limit band.' },
  { file: /^charts\/chart\.css$/, why: 'Limit band and out-of-limit ring styling.' },
  { file: /^ui\/components\/write\.css$/, why: 'WriteGate: disabled and blocked states.' },
  { file: /^styles\/base\.css$/, why: 'Defines the .state variable mapping (--fg, --tint, --edge, --glyph, --word) that the state surfaces read; the one place the four state palettes are bound.' },
  { file: /^ui\/components\/period\.css$/, why: 'Period panel: inline validation messages (Act) and the clock-unreadable notice (Watch). A form error and a data-trust notice, worded and shown with the state glyph pattern, not a decoration.' },
  { file: /^ui\/components\/shell\.css$/, why: 'Sign-out failure line in the account menu (Act): a failed action is named, not just coloured.' },
  { file: /^ui\/components\/ErrorState\.css$/, why: 'A failed load is an Act state named by part (rule 8); it uses the Act glyph and tint.' },
];

const STATE_TOKEN = /--(?:ok|watch|act|nodata)-[\w-]+/;

function scanStateColour(file: string, raw: string): Hit[] {
  if (STATE_COLOUR_OK.some((a) => a.file.test(file))) return [];
  const css = file.endsWith('.css');
  const hits: Hit[] = [];
  stripComments(raw, css)
    .split('\n')
    .forEach((text, i) => {
      if (STATE_TOKEN.test(text)) hits.push({ file, line: i + 1, rule: 'state-colour', text: text.trim() });
    });
  return hits;
}

const files = walk(SRC).filter((f) => !EXCLUDE.some((re) => re.test(f)));
const read = (f: string) => readFileSync(SRC + f, 'utf8');

describe('uniformity: DESIGN-SYSTEM section 7', () => {
  it('scans a real set of files', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).not.toContain('styles/tokens.css');
    expect(files).toContain('styles/base.css');
    expect(files.some((f) => f.startsWith('bridge/'))).toBe(false);
  });

  it('no raw colours, raw font sizes or unapproved gradients', () => {
    const bad = files.flatMap((f) => scanSource(f, read(f))).filter((h) => !allowed(h));
    expect(bad.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`)).toEqual([]);
  });

  it('state colour tokens appear only in the components that may speak in state colour', () => {
    const bad = files.flatMap((f) => scanStateColour(f, read(f)));
    expect(bad.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });

  it('every ALLOW entry still matches something (no stale exceptions)', () => {
    const hits = files.flatMap((f) => scanSource(f, read(f)));
    for (const a of ALLOW) expect(hits.some((h) => h.rule === a.rule && a.file.test(h.file) && (!a.text || a.text.test(h.text))), a.why).toBe(true);
  });
});

describe('uniformity canaries (the rules fire on a violation and stay quiet on the sanctioned shape)', () => {
  const css = (s: string) => scanSource('x/Fake.css', s).filter((h) => !allowed(h));
  const ts = (s: string) => scanSource('x/Fake.tsx', s).filter((h) => !allowed(h));

  it('raw colour', () => {
    expect(css('.a { color: #fff; }')).toHaveLength(1);
    expect(css('.a { color: #1a2b3c; }')).toHaveLength(1);
    expect(css('.a { background: rgba(0,0,0,.4); }')).toHaveLength(1);
    expect(ts("const s = { color: '#ff0000' };")).toHaveLength(1);
    expect(css('.a { color: var(--ink); }')).toHaveLength(0);
    expect(css('/* #fff */ .a { color: var(--ink); }')).toHaveLength(0);
    expect(ts("const href = '#main';")).toHaveLength(0);
  });
  it('raw font size', () => {
    expect(css('.a { font-size: 13px; }')).toHaveLength(1);
    expect(css('.a { font-size: 1.2rem; }')).toHaveLength(1);
    expect(ts('const s = { fontSize: 14 };')).toHaveLength(1);
    expect(ts("const s = { fontSize: '14px' };")).toHaveLength(1);
    expect(css('.a { font-size: var(--fs-3); }')).toHaveLength(0);
    expect(ts("const s = { fontSize: 'var(--fs-3)' };")).toHaveLength(0);
  });
  it('gradient', () => {
    expect(css('.a { background: linear-gradient(90deg, var(--a), var(--b)); }')).toHaveLength(1);
    expect(ts('<linearGradient id="g" />')).toHaveLength(1);
    expect(css('.a { background: var(--surface); }')).toHaveLength(0);
  });
  it('state colour', () => {
    expect(scanStateColour('ui/Random.tsx', 'const c = "var(--act-fg)";')).toHaveLength(1);
    expect(scanStateColour('ui/Random.css', '.x { color: var(--ok-tint); }')).toHaveLength(1);
    expect(scanStateColour('ui/StatusPill.tsx', 'const c = "var(--act-fg)";')).toHaveLength(0);
    expect(scanStateColour('ui/Random.tsx', 'const c = "var(--ink)";')).toHaveLength(0);
  });
});
