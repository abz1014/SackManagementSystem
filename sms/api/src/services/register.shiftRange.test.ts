/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): the register applies a
 * shift-bounded period through `tsFrom`/`tsTo` INSTANT edges
 * (`withShiftRangeEdges`), not `shiftRangeClause` on `shift_date`/
 * `shift_code` — see that function's own doc for why (the register's
 * `tsFrom`/`tsTo` is the "compares instants rather than shift columns" case
 * `shiftRange.ts`'s file header calls out). Both edges must be on the
 * PRODUCTION convention: the plant wall clock labelled UTC, the same
 * convention `production_ts_utc` is stored in — no plantClock conversion.
 *
 * Task W1-B (29 Sep 2026): `withShiftRangeEdges` now resolves the shift-rule
 * HISTORY (`ruleAsOf.ts`'s `loadShiftRuleHistory`), not `live.ts`'s single
 * "in force right now" row — so this file's mock moved with it. A
 * single-version history answers every anchor with that one version,
 * matching the old mocked behaviour exactly.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { withShiftRangeEdges, type RegisterFilters } from './register.js';
import type { ShiftRange } from '../shiftRange.js';

vi.mock('./ruleAsOf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ruleAsOf.js')>();
  return {
    ...actual,
    loadShiftRuleHistory: vi.fn(async () => [
      {
        effectiveFromMs: -Infinity,
        value: {
          boundaries: { morningStart: 6 * 60, eveningStart: 14 * 60, nightStart: 22 * 60 },
          nightBelongsTo: 'start_day',
        },
      },
    ]),
  };
});

const pool = {} as ConnectionPool; // never touched directly; loadShiftRuleHistory is mocked

const RANGE: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };

describe('register.ts — withShiftRangeEdges (the register edges, production convention)', () => {
  it('with a shiftRange and no explicit tsFrom/tsTo: fills them from the shift edges, in the production convention', async () => {
    const f: RegisterFilters = { from: '2026-09-01', to: '2026-09-05', shiftRange: RANGE };
    const out = await withShiftRangeEdges(pool, 1, f);
    // Morning starts at 06:00 plant time on 2026-09-02; night ends at 06:00
    // the FOLLOWING day (2026-09-04), both stated as a UTC-labelled instant —
    // the production convention, never converted through plantClock.
    expect(out.tsFrom).toBe(new Date('2026-09-02T06:00:00.000Z').toISOString());
    expect(out.tsTo).toBe(new Date('2026-09-04T06:00:00.000Z').toISOString());
    // The day-level from/to and every other field are carried through unchanged.
    expect(out.from).toBe('2026-09-01');
    expect(out.to).toBe('2026-09-05');
  });

  it('an explicit tsFrom/tsTo wins over the shift-range edges — the deep-link window is always the tighter, more specific ask', async () => {
    const f: RegisterFilters = {
      from: '2026-09-01', to: '2026-09-05', shiftRange: RANGE,
      tsFrom: '2026-09-02T10:00:00.000Z', tsTo: '2026-09-02T12:00:00.000Z',
    };
    const out = await withShiftRangeEdges(pool, 1, f);
    expect(out.tsFrom).toBe('2026-09-02T10:00:00.000Z');
    expect(out.tsTo).toBe('2026-09-02T12:00:00.000Z');
  });

  it('without a shiftRange: a no-op, returning the same filters unchanged', async () => {
    const f: RegisterFilters = { from: '2026-09-01', to: '2026-09-05' };
    const out = await withShiftRangeEdges(pool, 1, f);
    expect(out).toEqual(f);
    expect(out.tsFrom).toBeUndefined();
    expect(out.tsTo).toBeUndefined();
  });

  it('a same-shift, same-day range: one shift, edges bracket exactly that shift', async () => {
    const oneShift: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' };
    const out = await withShiftRangeEdges(pool, 1, { from: '2026-09-02', to: '2026-09-02', shiftRange: oneShift });
    expect(out.tsFrom).toBe(new Date('2026-09-02T14:00:00.000Z').toISOString());
    expect(out.tsTo).toBe(new Date('2026-09-02T22:00:00.000Z').toISOString());
  });
});
