import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { W } from './bridge/words';
import { stationLabel } from './bridge/api';
import { C, RESERVED, RESERVED_SOURCES, formatClock, formatDate } from './copy';

const dig = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root);

/** Every string C can produce; functions are called with sample arguments. */
function collect(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') out.push((node as (...a: unknown[]) => string)('Aa', 'Bb', 'Cc', 'Dd'));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => collect(v, out));
  return out;
}
const strings = collect(C);

describe('RESERVED is the live wording, by reference', () => {
  for (const [key, path] of Object.entries(RESERVED_SOURCES)) {
    it(key, () => {
      const got = dig(RESERVED, key);
      expect(got).toBeDefined();
      expect(got).toBe(dig(W, path));
    });
  }
  it('stationLabel is the api function', () => {
    expect(RESERVED.stationLabel).toBe(stationLabel);
  });
  it('the eight IFL titles are all present', () => {
    expect(Object.keys(RESERVED.iflReportTitles)).toHaveLength(8);
  });
});

describe('C wording rules', () => {
  /* Banned list: GLOSSARY.md 1.7 and section 2. "rejected" is banned as a bare label. */
  const banned = [
    /\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /\b\w+1_TP1U2\b/i,
    /in-range bit/i, /\bgen \d/i, /\brejected\b/i, /\bquality reject/i, /\bwinder\b/i, /\bmachine\b/i,
    /\blifter\b/i, /plant link/i, /\bsync pass\b/i, /\bmerge key\b/i, /\bwatermark\b/i, /\bAI\b/,
    /\b(steady|degraded|stale|silent|quiet)\b/i,
  ];
  it('GLOSSARY still lists the pipeline words this test bans', () => {
    const g = readFileSync(resolve(__dirname, '../../../design/redesign-2026-10/GLOSSARY.md'), 'utf8');
    for (const w of ['batch', 'epoch', 'generation', 'simulator', 'in-range bit']) expect(g).toContain(w);
  });
  it('has strings', () => expect(strings.length).toBeGreaterThan(40));
  it('no banned term', () => {
    for (const s of strings) for (const re of banned) expect(s, `${s} ~ ${re}`).not.toMatch(re);
  });
  const ACRONYMS = new Set(['OK', 'PDAS', 'SMS', 'IFL', 'CSV', 'PDF', 'PLC']);
  it('sentence case, no all-caps words, no ellipsis', () => {
    for (const s of strings) {
      expect(s, s).toMatch(/^[A-Z]/);
      expect(s, s).not.toContain('…');
      expect(s, s).not.toContain('...');
      for (const w of s.match(/[A-Za-z]{2,}/g) ?? []) {
        if (w === w.toUpperCase()) expect(ACRONYMS.has(w), `${w} in ${s}`).toBe(true);
      }
      // Title Case: two capitalised words in a row (samples above are Aa..Dd, so allow them).
      const stripped = s.replace(/\b(Aa|Bb|Cc|Dd)\b/g, 'x');
      expect(stripped, s).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/);
    }
  });
});

describe('date and clock helpers', () => {
  it('formats 1 Sep 2026 and 24-hour time', () => {
    expect(formatDate('2026-09-01T14:30:05Z')).toBe('1 Sep 2026');
    expect(formatClock('2026-09-01T14:30:05Z')).toBe('14:30');
    expect(formatClock('2026-09-01T14:30:05Z', true)).toBe('14:30:05');
  });
});
