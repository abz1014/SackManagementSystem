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

/**
 * The shape actually on the dev copy (F6, 23 Sep 2026): ONE version per
 * product, a migration-027 bootstrap stamped 2026-09-11T10:03:15.957Z with
 * `effective_is_lower_bound = 1` and the reason "true start unknown". The
 * mirror's current row is answered too, on purpose: a refusal must not fall
 * through to it and restore the very band it withheld.
 */
function bootstrapPool() {
  const rows = [{
    product_id: 12, setpoint_g: '1960.00', offset_minus_g: '40.00', offset_plus_g: '40.00',
    effective_from: new Date('2026-09-11T10:03:15.957Z'), effective_is_lower_bound: true, source: 'pdas_observed',
  }];
  return {
    request() {
      return {
        input() { return this; },
        async query(sql: string) {
          if (sql.includes('FROM sms.product_limit_version')) return { recordset: rows, rowsAffected: [1] };
          if (sql.includes('FROM sms.product p')) {
            return { recordset: [{ product_id: 12, description: '201-IH0-SD', lot_code: null, active_flag: true }], rowsAffected: [1] };
          }
          if (sql.includes('FROM sms.product WHERE product_id=@id')) {
            return { recordset: [{ sp: 1960, om: 40, op: 40, d: 'mirror-now', l: null }], rowsAffected: [1] };
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

  /**
   * F6, the chart (23 Sep 2026). This case USED to assert the opposite —
   * "falls back to the oldest, flagged as a lower bound", nominal 1950 — and
   * that is precisely the defect: the oldest version here begins 2026-08-01,
   * three weeks AFTER this period ended on 2026-07-10, so those limits
   * demonstrably did not exist while the readings were taken. Flagging the
   * fallback was not enough, because the flag has no render site and the
   * band, the Cp/Cpk and the scale-against-product figure were all drawn from
   * it anyway. The chart now states no limits and says why, the same verdict
   * `71ac170` gave the report tile and `4b514b2` gave the station table.
   */
  it('a period that ENDS before the earliest version on record gets no limits, and a reason', async () => {
    const s = await getSpec(pool(), 21, null, null, 'cone', { from: '2026-07-01', to: '2026-07-10' });
    expect(s).toMatchObject({ usl: null, lsl: null, nominal: null, source: 'none' });
    // The reason is the SHARED resolver's sentence, not one composed here.
    expect(s.limitsOmittedReason).toContain('2026-08-01');
    expect(s.limitsOmittedReason).toContain('2026-07-10');
    // The product that ran is still named — that is not a claim about limits.
    expect(s.productLabel).toBe('205-IL0-SD');
    // No instant, no lower-bound flag, no change count travels with a refusal.
    expect(s.limitsEffectiveFromUtc).toBeUndefined();
    expect(s.limitsAreLowerBound).toBeUndefined();
    expect(s.limitsChangedInPeriod).toBeUndefined();
  });

  /**
   * The case actually on the dev copy, and the reason this matters at all:
   * every one of the fourteen `sms.product_limit_version` rows is a
   * migration-027 bootstrap stamped 2026-09-11T10:03:15.957Z with
   * `effective_is_lower_bound = 1` and the reason "true start unknown".
   * Before this fix, Weight over 2026-08-05..08-20 (epoch 9, real IFL data)
   * drew USL 2000 / LSL 1920 and reported Cp 1.564, Cpk 1.209 against limits
   * first recorded 22 days after the last reading on the chart.
   */
  it('the migration-027 bootstrap shape: a single lower-bound version after the period', async () => {
    const s = await getSpec(bootstrapPool(), 12, null, null, 'cone', { from: '2026-08-05', to: '2026-08-20' });
    expect(s).toMatchObject({ usl: null, lsl: null, nominal: null, source: 'none' });
    expect(s.productLabel).toBe('201-IH0-SD');
    expect(s.limitsOmittedReason).toContain('2026-08-20');
  });

  it('the SAME bootstrap version is USABLE for a period that ends after it — only its start is unproven', async () => {
    // The other half of the split `resolvePeriodTarget` makes, on the same
    // fixture: these limits DID apply during a late-September period, so the
    // band stays and `limitsAreLowerBound` qualifies it. Withholding here
    // would blank a chart over a fact that is imprecise, not absent — and
    // the pair of cases is what proves the refusal is dated, not blanket.
    const s = await getSpec(bootstrapPool(), 12, null, null, 'cone', { from: '2026-09-20', to: '2026-09-22' });
    expect(s).toMatchObject({ usl: 2000, lsl: 1920, nominal: 1960, source: 'product' });
    expect(s.limitsAreLowerBound).toBe(true);
    expect(s.limitsOmittedReason).toBeUndefined();
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

/**
 * FRICTION AUDIT F7 (23 Sep 2026), the one caller `71ac170` did not reach.
 *
 * PDAS holds SIX materials all described "205-IL0-SD" — ids 20, 21, 1021,
 * 1022, 1023, 1024 — and `blend` is PVSD8020 on every one of them, so the
 * blend discriminates nothing. `materialId` is the only guaranteed-unique
 * field; colour separates four of the six (1021 and 1023 are both ORANGE)
 * and the count ("30" against "20 Slub") separates the last pair.
 *
 * `71ac170` fixed the product, sack and management-summary exports by giving
 * `ProductCatalogue` a `distinctLabel`. `getSpec` was still on the plain
 * `.label`, and its `productLabel` travels onto the weight CHART's caption —
 * printed beside a set of control limits that belong to exactly one of the
 * six. Naming that one ambiguously on the surface whose entire job is to say
 * which tolerance these readings were judged against is the same defect on a
 * worse page than the ones already fixed.
 */
function sixWayPool() {
  const SAME = '205-IL0-SD';
  const products = [
    { product_id: 20, description: SAME, lot_code: null, active_flag: true, color: 'Star Green', blend: 'PVSD8020', count_text: '18', tube_type: 'T1' },
    { product_id: 21, description: SAME, lot_code: null, active_flag: true, color: 'Blue', blend: 'PVSD8020', count_text: '36', tube_type: 'T1' },
    { product_id: 1021, description: SAME, lot_code: null, active_flag: true, color: 'ORANGE', blend: 'PVSD8020', count_text: '30', tube_type: 'T1' },
    { product_id: 1022, description: SAME, lot_code: null, active_flag: true, color: null, blend: 'PVSD8020', count_text: '50', tube_type: 'T1' },
    { product_id: 1023, description: SAME, lot_code: null, active_flag: true, color: 'ORANGE', blend: 'PVSD8020', count_text: '20 Slub', tube_type: 'T1' },
    { product_id: 1024, description: SAME, lot_code: null, active_flag: true, color: 'YELLOW', blend: 'PVSD8020', count_text: '36 Slub', tube_type: 'T1' },
  ];
  const versions = products.map((p) => ({
    product_id: p.product_id, setpoint_g: '1960.00', offset_minus_g: '50.00', offset_plus_g: '50.00',
    effective_from: new Date('2026-08-01T00:00:00Z'), effective_is_lower_bound: false, source: 'pdas_observed',
  }));
  return {
    request() {
      return {
        input() { return this; },
        async query(sql: string) {
          if (sql.includes('FROM sms.product_limit_version')) return { recordset: versions, rowsAffected: [versions.length] };
          if (sql.includes('FROM sms.product p')) return { recordset: products, rowsAffected: [products.length] };
          return { recordset: [], rowsAffected: [0] };
        },
      };
    },
  } as unknown as ConnectionPool;
}

describe('getSpec — the chart names ONE product, not one of six', () => {
  const RANGE = { from: '2026-08-10', to: '2026-08-20' };

  it('every one of the six same-named materials gets a distinct chart label', async () => {
    const labels = await Promise.all(
      [20, 21, 1021, 1022, 1023, 1024].map(async (id) => (await getSpec(sixWayPool(), id, null, null, 'cone', RANGE)).productLabel),
    );
    expect(new Set(labels).size).toBe(6);
    // Not merely distinct — distinguished by what actually differs. The
    // plain description alone would have produced six identical strings.
    expect(labels.every((l) => l?.startsWith('205-IL0-SD'))).toBe(true);
    expect(labels).not.toEqual(Array(6).fill('205-IL0-SD'));
  });

  it('the pair colour cannot separate (both ORANGE) falls through to the count', async () => {
    const a = (await getSpec(sixWayPool(), 1021, null, null, 'cone', RANGE)).productLabel!;
    const b = (await getSpec(sixWayPool(), 1023, null, null, 'cone', RANGE)).productLabel!;
    expect(a).not.toBe(b);
    // Blend is PVSD8020 on all six and may never be the thing that separates them.
    expect(a.replace('PVSD8020', '')).not.toBe(b.replace('PVSD8020', ''));
  });

  it('a product whose name is already unique keeps it unchanged', async () => {
    // The original single-product fixture: nothing collides, nothing is added.
    const s = await getSpec(pool(), 21, null, null, 'cone', RANGE);
    expect(s.productLabel).toBe('205-IL0-SD');
  });
});
