/**
 * likePattern.ts against the actual PDAS proc bodies' semantics, verified by
 * direct `sqlcmd -E` reads of `AddBlend`/`AddCount`/`AddTubeType` on
 * `PDAS_TP1U2_SEP07` (read-only) — see likePattern.ts's own header for the
 * proc text and the collation query this pass ran.
 */
import { describe, expect, it } from 'vitest';
import { likeMatches, likePatternToRegExp } from './likePattern.js';

describe('likeMatches', () => {
  it('matches an exact literal, case-insensitively (Latin1_General_CI_AS)', () => {
    expect(likeMatches('RED', 'RED')).toBe(true);
    expect(likeMatches('RED', 'red')).toBe(true);
    expect(likeMatches('red', 'RED')).toBe(true);
  });

  it('does not match a different literal', () => {
    expect(likeMatches('RED', 'BLUE')).toBe(false);
    expect(likeMatches('RED', 'REDDER')).toBe(false);
    expect(likeMatches('RE', 'RED')).toBe(false);
  });

  it('"_" matches exactly one character — the B4 defect case: R_D matches RED', () => {
    expect(likeMatches('RED', 'R_D')).toBe(true);
    expect(likeMatches('READ', 'R_D')).toBe(false); // wrong length
    expect(likeMatches('RXD', 'R_D')).toBe(true);
  });

  it('"%" matches any run, including none', () => {
    expect(likeMatches('RED', 'R%')).toBe(true);
    expect(likeMatches('RED', '%D')).toBe(true);
    expect(likeMatches('RED', '%')).toBe(true);
    expect(likeMatches('RED', 'R%D')).toBe(true);
    expect(likeMatches('RD', 'R%D')).toBe(true); // % can match zero characters
    expect(likeMatches('BLUE', 'R%')).toBe(false);
  });

  it('"[...]" matches one character from the class, including ranges', () => {
    expect(likeMatches('RED', '[R]ED')).toBe(true);
    expect(likeMatches('RED', '[QRS]ED')).toBe(true);
    expect(likeMatches('RED', '[A-M]ED')).toBe(false);
    expect(likeMatches('RED', '[N-Z]ED')).toBe(true);
  });

  it('"[^...]" excludes a character class', () => {
    expect(likeMatches('RED', '[^Q]ED')).toBe(true);
    expect(likeMatches('RED', '[^R]ED')).toBe(false);
  });

  it('a literal "]" as the first class member does not close the class early', () => {
    expect(likeMatches(']ED', '[]R]ED')).toBe(true);
  });

  it('an unmatched "[" is treated as a literal character, not a regex error', () => {
    expect(() => likePatternToRegExp('RED[')).not.toThrow();
    expect(likeMatches('RED[', 'RED[')).toBe(true);
    expect(likeMatches('RED', 'RED[')).toBe(false);
  });

  it('escapes regex metacharacters in the literal part of a pattern', () => {
    expect(likeMatches('R.D', 'R.D')).toBe(true);
    expect(likeMatches('RXD', 'R.D')).toBe(false); // '.' is literal in LIKE, not "any char" (that's '_')
    expect(likeMatches('R(D)', 'R(D)')).toBe(true);
    expect(likeMatches('R+D', 'R+D')).toBe(true);
    expect(likeMatches('R$D', 'R$D')).toBe(true);
  });

  it('mixed wildcards compose', () => {
    expect(likeMatches('POLYBLEND', 'P%_N_')).toBe(true);
  });
});
