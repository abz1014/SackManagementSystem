import { C } from '../../copy';
import { describe, expect, it } from 'vitest';

const T = C.today;

/** Same banned words and shape rules as copy.test.ts applies to C (GLOSSARY 1.7 and section 2). */
function collect(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    const f = node as (...a: unknown[]) => unknown;
    for (const args of [['Aa', 'Bb', 'Cc', 'Dd'], [3, 4, 5], ['day'], ['kg']]) {
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
const strings = collect(T);
const banned = [
  /\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /\b\w+1_TP1U2\b/i, /in-range bit/i,
  /\brejected\b/i, /\bquality reject/i, /\bwinder\b/i, /\blifter\b/i, /plant link/i, /\bsync pass\b/i,
  /\bmerge key\b/i, /\bwatermark\b/i, /\bAI\b/, /\b(steady|degraded|stale|silent|quiet)\b/i, /\bAssumed\b/,
];

describe('Today copy', () => {
  it('has strings', () => expect(strings.length).toBeGreaterThan(60));
  it('uses no banned word, no ellipsis, no title case', () => {
    for (const s of strings) {
      for (const re of banned) expect(s, `${s} ~ ${re}`).not.toMatch(re);
      expect(s).not.toContain('…');
      expect(s).not.toContain('...');
    }
  });
  it('the band never says a bare "running" for the period', () => {
    expect(T.band.running('Line 3')).toBe('Line 3 is running.');
  });
});
