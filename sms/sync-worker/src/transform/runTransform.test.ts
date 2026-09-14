/**
 * Regression test for the stack-overflow class of bug fixed in e86357f: a
 * fresh app database hands the transform its whole history in one batch
 * (142,511 cone rows on the real July copy), and `Math.min(...spread)` over
 * that many arguments overflows the call stack. This file's minRawId (was
 * minSourceRowId until the source-epoch work moved canonical dedupe onto our
 * own raw_id) — the exact site of that bug — shipped with zero test coverage
 * even after the fix (finding H11, Sep 2026 audit).
 *
 * Also pins `resolveShiftRule` (roadmap Phase 1, 14 Sep 2026): the whole
 * sms.shift_rule row is the rule — boundaries, night rule and mode — read
 * fresh every pass. The first H5 fix read only the night half and left the
 * boundaries a shared constant.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { __minRawIdForTest as minRawId, resolveShiftRule } from './runTransform.js';

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

/** A pool whose one query answers with the given shift_rule rows; records the SQL and its inputs. */
function rulePool(rows: Record<string, unknown>[]) {
  const seen = { sql: '', inputs: new Map<string, unknown>() };
  const pool = {
    request() {
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          seen.inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          seen.sql = sql;
          return { recordset: rows };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, seen };
}
const fallback = { nightBelongsTo: 'start_day' as const, mode: 'corrected' as const };

describe('resolveShiftRule — the newest sms.shift_rule row is the whole rule', () => {
  it('turns the TIME columns into minutes and carries the night rule and mode', async () => {
    const { pool, seen } = rulePool([{ ms: '08:00', es: '16:00', ns: '23:30', nb: 'calendar_day', mode: 'legacy' }]);
    const rule = await resolveShiftRule(pool, 1, fallback);
    expect(rule.boundaries).toEqual({ morningStart: 480, eveningStart: 960, nightStart: 23 * 60 + 30 });
    expect(rule.nightBelongsTo).toBe('calendar_day');
    expect(rule.mode).toBe('legacy');
    // newest row for THIS line, TIME → 'HH:MM' on the SQL side
    expect(seen.sql).toMatch(/SELECT TOP 1 CONVERT\(varchar\(5\), morning_start, 108\)/);
    expect(seen.sql).toMatch(/WHERE line_id=@line ORDER BY effective_from DESC/);
    expect(seen.inputs.get('line')).toBe(1);
  });

  it('falls back to the seed boundaries and the env defaults only when the line has no rule row', async () => {
    const { pool } = rulePool([]);
    const rule = await resolveShiftRule(pool, 1, fallback);
    expect(rule.boundaries).toEqual({ morningStart: 360, eveningStart: 840, nightStart: 1320 });
    expect(rule.nightBelongsTo).toBe('start_day');
    expect(rule.mode).toBe('corrected');
  });

  it('refuses a row whose times are not in increasing order, naming where to fix it', async () => {
    // Impossible through the API (shiftBoundariesFrom gates the write);
    // possible by hand in SSMS. Stamping rows under it would give a day no
    // night shift, so the pass stops instead.
    const { pool } = rulePool([{ ms: '14:00', es: '06:00', ns: '22:00', nb: 'start_day', mode: 'corrected' }]);
    await expect(resolveShiftRule(pool, 1, fallback)).rejects.toThrow(/Setup › Rules/);
  });
});
