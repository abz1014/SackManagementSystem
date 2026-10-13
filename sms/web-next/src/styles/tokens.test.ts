import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const tokens = read('tokens.css');
const dark = read('wall-dark.css');
const base = read('base.css');

const defined = (css: string) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
const used = (css: string) => [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);

describe('styles', () => {
  it('every var used in base.css and wall-dark.css is defined', () => {
    // --fg/--tint/--edge/--glyph/--word are local to .state; --card-bg/--card-shadow are defined in wall-dark.css
    const all = new Set([...defined(tokens), ...defined(dark), ...defined(base)]);
    const missing = [...used(base), ...used(dark)].filter((v) => !all.has(v));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('base.css vars resolve from tokens.css or local state definitions', () => {
    const tokenSet = new Set([...defined(tokens), ...defined(dark)]);
    const local = new Set(['--fg', '--tint', '--edge', '--glyph', '--word']);
    const missing = used(base).filter((v) => !tokenSet.has(v) && !local.has(v));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('ships no remote font or stylesheet', () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
      const css = read(f);
      expect(css, f).not.toMatch(/googleapis/i);
      expect(css, f).not.toMatch(/@import\s+url\(\s*['"]?https?:/i);
      expect(css, f).not.toMatch(/url\(\s*['"]?https?:/i);
    }
  });

  it.each(['ok', 'watch', 'act', 'nodata'])('state %s has fg, tint and edge in light and dark', (s) => {
    for (const k of ['fg', 'tint', 'edge']) {
      expect(defined(tokens).has(`--${s}-${k}`), `light --${s}-${k}`).toBe(true);
      expect(defined(dark).has(`--${s}-${k}`), `dark --${s}-${k}`).toBe(true);
    }
    for (const k of ['glyph', 'word']) expect(defined(tokens).has(`--${s}-${k}`)).toBe(true);
  });

  it('wall dark block is scoped to .wall.dark', () => {
    expect(dark).toContain('.wall.dark{');
    expect(dark).not.toMatch(/html body/);
  });

  it('keeps accessibility floors', () => {
    expect(base).toContain('prefers-reduced-motion');
    expect(base).toContain('forced-colors');
    expect(base).toMatch(/tabular-nums/);
  });
});
