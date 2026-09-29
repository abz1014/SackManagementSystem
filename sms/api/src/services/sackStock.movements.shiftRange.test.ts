/**
 * Chart overhaul wave 2, Task TD (29 Sep 2026) — gap 3.
 *
 * `GET /api/sacks/movements` (routes/sacks.ts → services/sackStock.ts's
 * `listMovements`) was period-scoped (`from`/`to`) but ignored a shift-range
 * request entirely — `fromShift`/`toShift` were accepted by zod (unknown
 * keys are stripped, so the route did not even 400) and then silently
 * dropped, unlike `/api/sacks/summary` (getSackSummary), which already
 * honoured one.
 *
 * `sms.sack_stock_movement` (migration 033) carries no `shift_code` column —
 * only `occurred_at_plant` (an instant, the plant wall clock labelled UTC —
 * this file's own TWO CLOCKS header confirms "production convention") and
 * `production_day` (the calendar-day axis) — so this cannot be a
 * `shiftRangeClause` AND on `(shift_date, shift_code)` the way
 * weights.ts/production.ts narrow their queries; it is an edges-based
 * window instead, `shiftRangeEdgesUtc(shiftRange, rule.boundaries)`
 * compared directly against `occurred_at_plant` — no `plantClock`
 * conversion, because both sides are already on the production convention.
 *
 * `/api/sacks/stock` (getStockLedger) is deliberately NOT touched — it is a
 * running-balance SNAPSHOT as of `to`, which a shift range has no meaning
 * for.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import type { ShiftRange } from '../shiftRange.js';

vi.mock('./live.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./live.js')>();
  return { ...actual, loadShiftRule: vi.fn() };
});

import { loadShiftRule } from './live.js';
import { listMovements } from './sackStock.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function recordingPool(responses: unknown[][] = []) {
  const statements: Stmt[] = [];
  let i = 0;
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => { inputs.set(name, value); return req; },
        query: async (sql: string) => {
          // Same generation-probe interception sackStock.test.ts's own
          // `recordingPool` uses — this listing runs one for the weighed
          // side (`resolveGenerationScope`), unrelated to what this file tests.
          if (/GROUP BY source_epoch/.test(sql) || /FROM sms\.source_epoch/.test(sql)) {
            return { recordset: [], rowsAffected: [0] };
          }
          statements.push({ sql, inputs: new Map(inputs) });
          return { recordset: responses[i++] ?? [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

const BOUNDARIES = { morningStart: 360, eveningStart: 840, nightStart: 1320 }; // 06:00 / 14:00 / 22:00

beforeEach(() => {
  vi.mocked(loadShiftRule).mockReset().mockResolvedValue({ boundaries: BOUNDARIES, nightBelongsTo: 'start_day' });
});

describe('listMovements — with no shiftRange, behaviour is unchanged', () => {
  it('binds no instant-window params at all', async () => {
    const { pool, statements } = recordingPool([[], []]);
    await listMovements(pool, 1, { from: '2026-09-01', to: '2026-09-07' });
    const listQuery = statements.find((s) => s.sql.includes('sms.sack_stock_movement m'))!;
    expect(listQuery.inputs.has('srFromTs')).toBe(false);
    expect(listQuery.inputs.has('srToTs')).toBe(false);
    expect(listQuery.sql).not.toMatch(/occurred_at_plant BETWEEN/);
    expect(loadShiftRule).not.toHaveBeenCalled();
  });
});

describe('listMovements — a shiftRange narrows the movements list by instant, not by shift_code', () => {
  it('binds occurred_at_plant BETWEEN the shift range’s own edges, resolved against the line’s shift rule', async () => {
    const { pool, statements } = recordingPool([[], []]);
    const shiftRange: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' };
    await listMovements(pool, 1, { from: '2026-09-01', to: '2026-09-07', shiftRange });

    expect(loadShiftRule).toHaveBeenCalledWith(pool, 1);
    const listQuery = statements.find((s) => s.sql.includes('sms.sack_stock_movement m'))!;
    expect(listQuery.sql).toMatch(/AND m\.occurred_at_plant BETWEEN @srFromTs AND @srToTs/);

    // Evening = 14:00-22:00 plant time on 2026-09-02, production convention
    // (no UTC offset applied — occurred_at_plant is already plant time).
    const fromTs = listQuery.inputs.get('srFromTs') as Date;
    const toTs = listQuery.inputs.get('srToTs') as Date;
    expect(fromTs.toISOString()).toBe('2026-09-02T14:00:00.000Z');
    expect(toTs.toISOString()).toBe('2026-09-02T22:00:00.000Z');

    // Still bound alongside the ordinary production_day range, never in place of it.
    expect(listQuery.inputs.get('from')).toBe('2026-09-01');
    expect(listQuery.inputs.get('to')).toBe('2026-09-07');
  });

  it('a night shift’s edges cross midnight correctly (production convention, no plantClock conversion)', async () => {
    const { pool, statements } = recordingPool([[], []]);
    const shiftRange: ShiftRange = { from: '2026-09-02', fromShift: 'night', to: '2026-09-02', toShift: 'night' };
    await listMovements(pool, 1, { from: '2026-09-01', to: '2026-09-07', shiftRange });
    const listQuery = statements.find((s) => s.sql.includes('sms.sack_stock_movement m'))!;
    const fromTs = listQuery.inputs.get('srFromTs') as Date;
    const toTs = listQuery.inputs.get('srToTs') as Date;
    // Night starts 22:00 on the 2nd and ends 06:00 the FOLLOWING day (the 3rd) — the end
    // instant rolls to the next calendar day even though the shift belongs to the 2nd.
    expect(fromTs.toISOString()).toBe('2026-09-02T22:00:00.000Z');
    expect(toTs.toISOString()).toBe('2026-09-03T06:00:00.000Z');
  });

  it('still binds the product filter alongside the shift-range window when both are given', async () => {
    const { pool, statements } = recordingPool([[], []]);
    const shiftRange: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-02', toShift: 'morning' };
    await listMovements(pool, 1, { from: '2026-09-01', to: '2026-09-07', product: 21, shiftRange });
    const listQuery = statements.find((s) => s.sql.includes('sms.sack_stock_movement m'))!;
    expect(listQuery.sql).toMatch(/m\.material_id = @product/);
    expect(listQuery.inputs.get('product')).toBe(21);
    expect(listQuery.sql).toMatch(/m\.occurred_at_plant BETWEEN/);
  });
});
