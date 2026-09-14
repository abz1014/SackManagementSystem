/**
 * Regression test for the stack-overflow class of bug fixed in e86357f: a
 * fresh app database hands the transform its whole history in one batch
 * (142,511 cone rows on the real July copy), and `Math.min(...spread)` over
 * that many arguments overflows the call stack. This file's minRawId (was
 * minSourceRowId until the source-epoch work moved canonical dedupe onto our
 * own raw_id) — the exact site of that bug — shipped with zero test coverage
 * even after the fix (finding H11, Sep 2026 audit).
 */
import { describe, expect, it } from 'vitest';
import { __minRawIdForTest as minRawId } from './runTransform.js';

describe('minRawId — the stack-overflow guard (finding H11)', () => {
  it('does not overflow the call stack on a batch the size of a real backfill', () => {
    const rows = Array.from({ length: 150_000 }, (_, i) => ({ raw_id: i + 1 }));
    expect(() => minRawId(rows)).not.toThrow();
    expect(minRawId(rows)).toBe(1);
  });

  it('finds the true minimum regardless of ordering', () => {
    const rows = [{ raw_id: 50 }, { raw_id: 3 }, { raw_id: 999 }];
    expect(minRawId(rows)).toBe(3);
  });

  it('returns +Infinity for an empty batch, as callers already guard for', () => {
    expect(minRawId([])).toBe(Number.POSITIVE_INFINITY);
  });
});
