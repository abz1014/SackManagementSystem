/**
 * Roadmap Phase 4 services (14 Sep 2026), over recording fake pools:
 *  - production.ts: `classification` — counts per state from the shared CASE
 *  - spc.ts: the station filter binds only for cones
 *  - machinesRunning.ts: the newest cone's material per station, anchored on the newest reading
 *  - shiftCheck.ts: plant-stored versus SMS-derived shift, per day and by hour
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';
import { getWeightSpc, type SpecLimits } from './spc.js';
import { getMachinesRunning, RUNNING_WINDOW_MS } from './machinesRunning.js';
import { getShiftCheck } from './shiftCheck.js';
import type { StateContext } from './coneState.js';

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(answer: (sql: string, params: Map<string, unknown>) => Record<string, unknown>[]): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          // The source-generation probe (generation.ts `resolveGenerationScope`,
          // 23 Sep 2026) runs before the service's own queries. Answered as
          // "no epoch-tagged rows" — the UNSCOPED no-op — and intercepted
          // BEFORE `calls` is appended to, so the positional assertions below
          // still describe the queries they were written about. The predicate
          // itself is covered by generation.test.ts.
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) return { recordset: [] };
          calls.push({ sql, params });
          return { recordset: answer(sql, params) };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const CTX: StateContext = {
  plausibility: { loG: 1500, hiG: 2100 },
  windows: [{ materialId: 14, fromMs: null, toMs: null, loG: 1930, hiG: 1990, assumedStart: false }],
};

describe('getProduction — classification', () => {
  it('counts cones per state with the shared CASE over the same filters, and reports the implausible count', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('GROUP BY CASE')) {
        return [
          { state: 'within', n: 90, implausible: 0 },
          { state: 'low', n: 5, implausible: 0 },
          { state: 'rejected', n: 3, implausible: 0 },
          { state: 'unknown', n: 2, implausible: 2 },
        ];
      }
      return [];
    });
    const r = await getProduction(pool, 1, { from: '2026-09-01', to: '2026-09-07', shift: 'morning', station: 7, groupBy: 'none', withStates: true, stateContext: CTX });
    expect(r.states).toEqual({ within: 90, low: 5, high: 0, rejected: 3, unknown: 2 });
    expect(r.implausible).toBe(2);
    const st = calls.find((c) => c.sql.includes('GROUP BY CASE'))!;
    // The same filters as the cones count: line, days, shift, station.
    expect(st.sql).toContain('shift_code = @shift');
    expect(st.sql).toContain('source_station = @station');
    expect(st.params.get('station')).toBe(7);
    expect(st.params.get('csMat0')).toBe(14);
    expect(st.sql).toContain("WHEN in_range = 0 THEN 'rejected'");
  });

  it('is null unless asked for, so the report\'s two grouped calls do not pay for it', async () => {
    const { pool, calls } = fakePool(() => []);
    const r = await getProduction(pool, 1, { groupBy: 'day' });
    expect(r.states).toBeNull();
    expect(r.implausible).toBeNull();
    expect(calls.some((c) => c.sql.includes('GROUP BY CASE'))).toBe(false);
  });
});

describe('getWeightSpc — station', () => {
  const SPEC: SpecLimits = { usl: null, lsl: null, nominal: null, source: 'none' };
  const PLAUS = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };
  const answer = (sql: string) => (sql.includes(') excluded') ? [{ n: 0, mean: null, sd: null, excluded: 0 }] : []);

  it('binds source_station on every cone query when a station is given, and reports it', async () => {
    const { pool, calls } = fakePool(answer);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-01', SPEC, PLAUS, null, 7);
    expect(d.station).toBe(7);
    for (const c of calls) {
      expect(c.sql).toContain('source_station=@station');
      expect(c.params.get('station')).toBe(7);
    }
  });

  it('ignores a station on sacks — sack_event has no station column', async () => {
    const { pool, calls } = fakePool(answer);
    const d = await getWeightSpc(pool, 1, 'sack', '2026-09-01', '2026-09-01', SPEC, PLAUS, null, 7);
    expect(d.station).toBeNull();
    for (const c of calls) expect(c.sql).not.toContain('@station');
  });
});

describe('getMachinesRunning', () => {
  const NEWEST = Date.parse('2026-09-07T10:00:00Z');
  const roster = [
    { station_id: 1, name: 'W1', machine_name: 'Winder 1', is_active: true },
    { station_id: 2, name: null, machine_name: null, is_active: true },
    { station_id: 3, name: 'retired', machine_name: null, is_active: false },
  ];
  const running = [
    { st: 1, material_id: 14, product_name: 'Blend A', cones: 40, on_material: 40, newest_ms: NEWEST, since_ms: NEWEST - 7_000_000, since_is_window_start: 1 },
    { st: 9, material_id: 15, product_name: null, cones: 3, on_material: 2, newest_ms: NEWEST - 60_000, since_ms: NEWEST - 120_000, since_is_window_start: 0 },
  ];
  const answer = (sql: string) => {
    if (sql.includes('MAX(production_ts_utc_ms)')) return [{ ms: String(NEWEST) }];
    if (sql.includes('FROM sms.station s')) return roster;
    if (sql.includes('WITH w AS')) return running;
    return [];
  };

  it('anchors the two-hour window on the newest reading, never the clock', async () => {
    const { pool, calls } = fakePool(answer);
    const d = await getMachinesRunning(pool, 1);
    expect(d.asOfUtc).toBe(new Date(NEWEST).toISOString());
    expect(d.windowStartUtc).toBe(new Date(NEWEST - RUNNING_WINDOW_MS).toISOString());
    const w = calls.find((c) => c.sql.includes('WITH w AS'))!;
    expect(w.params.get('start')).toBe(NEWEST - RUNNING_WINDOW_MS);
    expect(w.params.get('end')).toBe(NEWEST);
  });

  it('lists active stations, names the product on each, and keeps quiet ones quiet with no product', async () => {
    const { pool } = fakePool(answer);
    const d = await getMachinesRunning(pool, 1);
    const s1 = d.machines.find((m) => m.station === 1)!;
    expect(s1).toMatchObject({ productName: 'Blend A', materialId: 14, cones: 40, quiet: false, sinceIsWindowStart: true, machineName: 'Winder 1' });
    const s2 = d.machines.find((m) => m.station === 2)!;
    expect(s2).toMatchObject({ quiet: true, productName: null, materialId: null, cones: 0 });
    // The retired station is not listed; a station with readings that Setup does not list still is.
    expect(d.machines.some((m) => m.station === 3)).toBe(false);
    const s9 = d.machines.find((m) => m.station === 9)!;
    expect(s9).toMatchObject({ productName: 'Product 15', quiet: false, sinceIsWindowStart: false, conesOnMaterial: 2 });
    expect(d.materialsRunning).toBe(2);
  });

  it('caps the anchor at the replay instant when given', async () => {
    const { pool, calls } = fakePool(answer);
    await getMachinesRunning(pool, 1, { asOfMs: 123 });
    expect(calls[0]!.sql).toContain('production_ts_utc_ms <= @asOf');
    expect(calls[0]!.params.get('asOf')).toBe(123);
  });

  it('with no readings at all, says so rather than inventing a window', async () => {
    const { pool } = fakePool((sql) => (sql.includes('MAX(') ? [{ ms: null }] : sql.includes('sms.station') ? roster : []));
    const d = await getMachinesRunning(pool, 1);
    expect(d.asOfUtc).toBeNull();
    expect(d.machines.every((m) => m.quiet)).toBe(true);
  });
});

describe('getShiftCheck', () => {
  it('reports the disagreement per day, the total percentage over comparable rows, and the top hours', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('GROUP BY shift_date')) {
        return [
          { day: '2026-09-01', n: 100, mm: 10, nolegacy: 0 },
          { day: '2026-09-02', n: 50, mm: 5, nolegacy: 10 },
        ];
      }
      if (sql.includes('DATEPART(HOUR')) return [{ h: 13, mm: 9 }, { h: 21, mm: 4 }, { h: 5, mm: 2 }, { h: 12, mm: 0 }];
      return [];
    });
    const d = await getShiftCheck(pool, 1, '2026-09-01', '2026-09-02');
    expect(d.cones).toBe(150);
    expect(d.mismatched).toBe(15);
    expect(d.noLegacyShift).toBe(10);
    // 15 of the 140 rows that carried a plant shift: 10.7 %.
    expect(d.mismatchPct).toBe(10.7);
    expect(d.byDay[1]).toEqual({ day: '2026-09-02', cones: 50, mismatched: 5, mismatchPct: 12.5 });
    expect(d.topHours).toEqual([{ hour: 13, mismatched: 9 }, { hour: 21, mismatched: 4 }, { hour: 5, mismatched: 2 }]);
    // Compares the two stored codes directly — both are normalised to the same three words.
    expect(calls[0]!.sql).toContain('shift_code_legacy <> shift_code');
  });
});
