import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { isolatedDayFindingsFor, checkIsolatedProductionDay, type DayCount } from './isolatedDay.js';

describe('isolatedDayFindingsFor — a fixture with a gap containing one row', () => {
  it('fires, naming the offending id, for a single row inside a generation-wide gap', () => {
    // Mirrors RT24-09: generation 9 has a dense run in August, then one lone
    // row on 2026-07-12 — inside the documented 10 Jul -> 5 Aug "no data" gap
    // for this generation — then nothing again until August.
    const counts: DayCount[] = [
      { source_epoch: 9, shift_date: '2026-07-12', n: 1, first_raw_id: 4130 },
      { source_epoch: 9, shift_date: '2026-08-05', n: 800 },
      { source_epoch: 9, shift_date: '2026-08-06', n: 750 },
      { source_epoch: 9, shift_date: '2026-08-07', n: 790 },
    ] as DayCount[];
    const findings = isolatedDayFindingsFor(counts);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.check_name).toBe('isolated_production_day');
    expect(findings[0]!.severity).toBe('WARNING');
    expect(findings[0]!.subject_table).toBe('cone_event');
    expect(findings[0]!.count).toBe(1);
    expect(findings[0]!.subject_ref).toBe(4130);
    expect(findings[0]!.detail).toMatch(/2026-07-12/);
    expect(findings[0]!.detail).toMatch(/generation 9/);
    expect(findings[0]!.detail).toMatch(/4130/);
  });

  it('is a no-op for normal dense data with no gaps', () => {
    const counts: DayCount[] = [
      { source_epoch: 9, shift_date: '2026-08-05', n: 800, first_raw_id: 1 },
      { source_epoch: 9, shift_date: '2026-08-06', n: 750, first_raw_id: 2 },
      { source_epoch: 9, shift_date: '2026-08-07', n: 790, first_raw_id: 3 },
      { source_epoch: 9, shift_date: '2026-08-08', n: 810, first_raw_id: 4 },
    ] as DayCount[];
    expect(isolatedDayFindingsFor(counts)).toEqual([]);
  });

  it('does not flag a low-count day that has a real neighbour within the window (ramp-up/down day)', () => {
    const counts: DayCount[] = [
      { source_epoch: 9, shift_date: '2026-08-05', n: 3, first_raw_id: 1 }, // first day of the generation, ramping up
      { source_epoch: 9, shift_date: '2026-08-06', n: 750, first_raw_id: 2 },
      { source_epoch: 9, shift_date: '2026-08-07', n: 790, first_raw_id: 3 },
    ] as DayCount[];
    expect(isolatedDayFindingsFor(counts)).toEqual([]);
  });

  it('never re-flags the known clock-fault sentinel dates', () => {
    const counts: DayCount[] = [
      { source_epoch: 1, shift_date: '1969-12-31', n: 1, first_raw_id: 99 },
      { source_epoch: 5, shift_date: '2026-06-21', n: 2, first_raw_id: 100 },
      { source_epoch: 9, shift_date: '2026-08-05', n: 800, first_raw_id: 1 },
    ] as DayCount[];
    expect(isolatedDayFindingsFor(counts)).toEqual([]);
  });

  it('keeps generations independent — a day isolated in one epoch does not borrow neighbours from another', () => {
    const counts: DayCount[] = [
      { source_epoch: 1, shift_date: '2026-07-11', n: 700, first_raw_id: 1 },
      { source_epoch: 1, shift_date: '2026-07-12', n: 1, first_raw_id: 2 }, // dense in epoch 1
      { source_epoch: 9, shift_date: '2026-07-12', n: 1, first_raw_id: 4130 }, // isolated in epoch 9
      { source_epoch: 9, shift_date: '2026-08-05', n: 800, first_raw_id: 3 },
    ] as DayCount[];
    const findings = isolatedDayFindingsFor(counts);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.subject_ref).toBe(4130);
  });
});

describe('checkIsolatedProductionDay — DB wrapper', () => {
  it('groups by source_epoch/shift_date over sms.cone_event and delegates to the pure function', async () => {
    let queriedSql = '';
    const pool = {
      request() {
        return {
          input() {
            return this;
          },
          query: async (sql: string) => {
            queriedSql = sql;
            return {
              recordset: [
                { source_epoch: 9, shift_date: new Date('2026-07-12T00:00:00Z'), n: 1, first_raw_id: 4130 },
                { source_epoch: 9, shift_date: new Date('2026-08-05T00:00:00Z'), n: 800, first_raw_id: 1 },
                { source_epoch: 9, shift_date: new Date('2026-08-06T00:00:00Z'), n: 750, first_raw_id: 2 },
                { source_epoch: 9, shift_date: new Date('2026-08-07T00:00:00Z'), n: 790, first_raw_id: 3 },
              ],
            };
          },
        };
      },
    } as unknown as ConnectionPool;

    const findings = await checkIsolatedProductionDay(pool, 1);
    expect(queriedSql).toMatch(/GROUP BY source_epoch, shift_date/);
    expect(queriedSql).toMatch(/sms\.cone_event/);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.subject_ref).toBe(4130);
  });
});
