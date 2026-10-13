import { describe, expect, it } from 'vitest';
import { PC } from './productsCopy';

/** Same banned words and shape rules as copy.test.ts applies to C (GLOSSARY 1.7 and section 2). */
function collect(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    const f = node as (...a: unknown[]) => unknown;
    for (const args of [['Aa', 'Bb', 'Cc', 'Dd'], [3, 4, 5], [1, 1, 1], [0, 0, 0], ['day'], [1], [2, 1]]) {
      try {
        const v = f(...args);
        if (typeof v === 'string') out.push(v);
      } catch {
        /* wrong argument shape for this probe */
      }
    }
  } else if (node && typeof node === 'object') Object.values(node).forEach((v) => collect(v, out));
  return out;
}
const strings = collect(PC);
const banned = [
  /\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /\b\w+1_TP1U2\b/i, /in-range bit/i,
  /\brejected\b/i, /\bquality reject/i, /\bwinder\b/i, /\bmachine\b/i, /\blifter\b/i, /plant link/i, /\bsync pass\b/i,
  /\bmerge key\b/i, /\bwatermark\b/i, /\bAI\b/, /\b(steady|degraded|stale|silent|quiet)\b/i, /\bAssumed\b/,
];
const ACRONYMS = new Set(['OK', 'PDAS', 'SMS', 'IFL']);

describe('Products copy', () => {
  it('has strings', () => expect(strings.length).toBeGreaterThan(100));
  it('uses no banned word, no ellipsis', () => {
    for (const s of strings) {
      for (const re of banned) expect(s, `${s} ~ ${re}`).not.toMatch(re);
      expect(s).not.toContain('…');
      expect(s).not.toContain('...');
    }
  });
  it('sentence case: no all-caps word but the acronyms, no two capitalised words in a row', () => {
    for (const s of strings) {
      for (const w of s.match(/[A-Za-z]{2,}/g) ?? []) {
        if (w === w.toUpperCase()) expect(ACRONYMS.has(w), `${w} in ${s}`).toBe(true);
      }
      const stripped = s.replace(/\b(Aa|Bb|Cc|Dd)\b/g, 'x');
      expect(stripped, s).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/);
    }
  });
  it('headlines read well at one and many', () => {
    expect(PC.board.headlineRunning(1, 1, 0)).toBe('1 station is running 1 product. None are idle.');
    expect(PC.board.headlineRunning(6, 3, 8)).toBe('6 stations are running 3 products. 8 are idle.');
    expect(PC.catalogue.headline(1, 1)).toBe('1 product is active in PDAS. 1 is retired.');
  });
});
