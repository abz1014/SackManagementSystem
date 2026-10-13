import { describe, expect, it } from 'vitest';
import { R } from './registerCopy';

/** Every string R can produce; functions are called with sample arguments. */
function collect(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    out.push((node as (...a: unknown[]) => string)('Aa', 'Bb', 'Cc', 'Dd'));
  } else if (node && typeof node === 'object') Object.values(node).forEach((v) => collect(v, out));
  return out;
}
/** A bare unit label is lower case by convention. */
const strings = collect(R).filter((s) => s !== 'kg');

/* The same banned list copy.test.ts holds C to (GLOSSARY 1.7 and section 2). */
const banned = [
  /\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /\b\w+1_TP1U2\b/i,
  /in-range bit/i, /\bgen \d/i, /\brejected\b/i, /\bquality reject/i, /\bwinder\b/i, /\bmachine\b/i,
  /\blifter\b/i, /plant link/i, /\bsync pass\b/i, /\bmerge key\b/i, /\bwatermark\b/i, /\bAI\b/,
  /\b(steady|degraded|stale|silent|quiet)\b/i,
];

describe('registerCopy follows the copy.ts rules', () => {
  it('has strings', () => expect(strings.length).toBeGreaterThan(80));
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
    }
  });
  it('writes no reserved sack-stock wording of its own', () => {
    for (const s of strings) {
      expect(s).not.toMatch(/^(Opening|Receipts|Issues|Consumption|Adjustments|Closing)$/);
      expect(s).not.toMatch(/^Stock ledger$/);
    }
  });
});
