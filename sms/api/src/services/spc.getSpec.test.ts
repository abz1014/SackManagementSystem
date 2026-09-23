/**
 * getSpec through the versioned limits (14 Sep 2026). Until then the chart's
 * limit lines came from sms.product — the mirror's CURRENT row — so a period
 * from before a setpoint change was drawn against the tolerance that came
 * after it. weightStations and productAt had moved to product_limit_version
 * already; this pins that the control chart now agrees with them.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getSpec } from './spc.js';
import { toPlantMs } from './plantClock.js';

/** Product 21: 1950 ± 50 from 1 Aug, then 1960 ± 50 from 5 Sep (plant time). */
function pool(versions = 2) {
  const rows = [
    { product_id: 21, setpoint_g: '1960.00', offset_minus_g: '50.00', offset_plus_g: '50.00',
      effective_from: new Date('2026-09-05T00:00:00Z'), effective_is_lower_bound: false, source: 'sms_write' },
    { product_id: 21, setpoint_g: '1950.00', offset_minus_g: '50.00', offset_plus_g: '50.00',
      effective_from: new Date('2026-08-01T00:00:00Z'), effective_is_lower_bound: false, source: 'pdas_observed' },
  ].slice(0, versions);
  return {
    request() {
      const inputs = new Map<string, unknown>();
      return {
        input(n: string, _t: unknown, v: unknown) { inputs.set(n, v); return this; },
        async query(sql: string) {
          if (sql.includes('FROM sms.product_limit_version')) return { recordset: rows, rowsAffected: [rows.length] };
          if (sql.includes('FROM sms.product p')) {
            return { recordset: [{ product_id: 21, description: '205-IL0-SD', lot_code: null, active_flag: true }], rowsAffected: [1] };
          }
          // The legacy fallback row, only reached without a catalogue hit.
          if (sql.includes('FROM sms.product WHERE product_id=@id')) {
            return { recordset: [{ sp: 1999, om: 10, op: 10, d: 'mirror-now', l: null }], rowsAffected: [1] };
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
    },
  } as unknown as ConnectionPool;
}

describe('getSpec — limits in force at the END of the period', () => {
  it('a period after the change draws the new limits and reports no change inside it', async () => {
    const s = await getSpec(pool(), 21, null, null, 'cone', { from: '2026-09-06', to: '2026-09-07' });
    expect(s).toMatchObject({ usl: 2010, lsl: 1910, nominal: 1960, source: 'product', productLabel: '205-IL0-SD' });
    expect(s.limitsChangedInPeriod).toBe(0);
    // Two clocks: the version row stores a genuine UTC instant, and the
    // catalogue reports it on the production-time convention (plant wall
    // clock labelled UTC) — five hours later on this plant. Never compared raw.
    expect(s.limitsEffectiveFromUtc).toBe(new Date(toPlantMs(new Date('2026-09-05T00:00:00Z'))).toISOString());
  });

  it("a period before the change draws the OLD limits — not the mirror's current row", async () => {
    const s = await getSpec(pool(), 21, null, null, 'cone', { from: '2026-08-10', to: '2026-08-20' });
    expect(s).toMatchObject({ usl: 2000, lsl: 1900, nominal: 1950, source: 'product' });
    expect(s.limitsChangedInPeriod).toBe(0);
  });

  it('a period spanning the change draws the end-of-period limits and counts the change', async () => {
    const s = await getSpec(pool(), 21, null, null, 'cone', { from: '2026-09-01', to: '2026-09-07' });
    expect(s.nominal).toBe(1960);
    expect(s.limitsChangedInPeriod).toBe(1);
  });

  it('a period before any version falls back to the oldest, flagged as a lower bound', async () => {
    const s = await getSpec(pool(), 21, null, null, 'cone', { from: '2026-07-01', to: '2026-07-10' });
    expect(s.nominal).toBe(1950);
    expect(s.limitsAreLowerBound).toBe(true);
  });

  it('manual limits win, and sacks never get a cone setpoint', async () => {
    expect(await getSpec(pool(), 21, 2000, 1900, 'cone', { from: '2026-09-01', to: '2026-09-07' })).toMatchObject({ source: 'manual', nominal: 1950 });
    expect(await getSpec(pool(), 21, null, null, 'sack', { from: '2026-09-01', to: '2026-09-07' })).toMatchObject({ source: 'none', usl: null });
  });

  it('without a period the legacy mirror row is used, honestly without an effective-from', async () => {
    const s = await getSpec(pool(), 21, null, null, 'cone');
    expect(s).toMatchObject({ nominal: 1999, source: 'product' });
    expect(s.limitsEffectiveFromUtc).toBeUndefined();
  });

  it('with a period but no versions at all, the same fallback applies', async () => {
    const s = await getSpec(pool(0), 21, null, null, 'cone', { from: '2026-09-01', to: '2026-09-07' });
    expect(s).toMatchObject({ nominal: 1999, source: 'product' });
    expect(s.limitsEffectiveFromUtc).toBeUndefined();
  });
});
